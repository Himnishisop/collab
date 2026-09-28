import { FFmpeg } from "@ffmpeg/ffmpeg";
import type { ExportProfile } from "./types";

// The library spawns a MODULE worker from `new URL("./worker.js", import.meta.url)`.
// In a single-file build that sibling chunk does not exist, so `load()` hangs
// forever and the app silently degrades to a real-time re-record (slow + out of
// sync). Fix: inline the worker source (and its two tiny dependency modules)
// into our bundle and hand the library a same-origin blob `classWorkerURL`.
// The package `exports` map only exposes its root entry, so the worker sources
// are read by path — Vite inlines them into the bundle at build time.
import workerSrc from "../../node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js?raw";
import constSrc from "../../node_modules/@ffmpeg/ffmpeg/dist/esm/const.js?raw";
import errorsSrc from "../../node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js?raw";

export interface CodecInfo {
  video: string;
  audio: string;
}

export type MuxMode = "copy-all" | "copy-video" | "encode";
export type AudioSource = "wav" | "input" | "none";

export interface MuxOptions {
  inputName: string;
  /** exact output duration, in seconds */
  rangeSec: number;
  /** encode to the real end of the file instead of trusting `rangeSec` */
  untilEnd?: boolean;
  audio: AudioSource;
  mode: MuxMode;
  profile?: ExportProfile;
  /** e.g. "1280:-2" (landscape) or "-2:1280" (portrait); null keeps source size */
  scale?: string | null;
  /** bake a horizontal flip into the file (selfie "mirror" look) */
  mirror?: boolean;
  threads?: number;
}

const CORE_VERSION = "0.12.6";
const HOSTS = ["cdn.jsdelivr.net", "unpkg.com"];

let engine: FFmpeg | null = null;
let engineLoading: Promise<FFmpeg> | null = null;
let engineMT = false;
let loadAttempts = 0;
let logLines: string[] = [];
let engineProgressCb: ((timeSeconds: number) => void) | null = null;
let cachedCodecs: CodecInfo | null = null;
let cachedInput: { token: string; name: string } | null = null;
let cachedSrcCodec: { token: string; codec: string | null } | null = null;
let inlinedWorkerUrl: string | null = null;
let lastActivityAt = Date.now();

/** Builds one self-contained ES module worker from the library's own sources. */
export function inlinedClassWorkerURL(): string | null {
  if (inlinedWorkerUrl) return inlinedWorkerUrl;
  try {
    const body = workerSrc
      .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/const\.js["'];?/g, "")
      .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/errors\.js["'];?/g, "");
    const src = `${constSrc}\n${errorsSrc}\n${body}`;
    if (!src.includes("createFFmpegCore")) return null;
    inlinedWorkerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    return inlinedWorkerUrl;
  } catch {
    return null;
  }
}

export function setEngineProgress(cb: ((timeSeconds: number) => void) | null): void {
  engineProgressCb = cb;
}

export function isEngineReady(): boolean {
  return engine !== null;
}

export function isMultiThread(): boolean {
  return engineMT;
}

export function engineThreads(): number {
  if (!engineMT) return 1;
  const hw = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4;
  return Math.max(2, Math.min(8, hw));
}

export function terminateFfmpeg(): void {
  const ff = engine;
  engine = null;
  engineLoading = null;
  engineProgressCb = null;
  engineMT = false;
  logLines = [];
  cachedCodecs = null;
  cachedInput = null;
  cachedSrcCodec = null;
  if (ff) {
    try {
      ff.terminate();
    } catch {
      /* noop */
    }
  }
}

/** Raised when the wasm worker goes silent (OOM/crash): never retry, report it. */
export class EngineStalledError extends Error {
  fatal = true;
  constructor(message: string) {
    super(message);
    this.name = "EngineStalledError";
  }
}

/** In-browser exports have a hard memory ceiling; refuse absurd inputs early. */
export const MAX_SOURCE_BYTES = 700 * 1024 * 1024;

/**
 * `exec()` resolves only when the worker answers. If the worker dies (wasm OOM
 * is the usual reason on long clips) the promise hangs forever and the UI looks
 * frozen. This wrapper adds a liveness watchdog: no progress/log activity for
 * `stallMs` means the core is gone, so the engine is torn down and the caller
 * gets a real error instead of an eternal spinner.
 */
export async function execGuarded(
  ff: FFmpeg,
  args: string[],
  opts: { stallMs?: number; absoluteMs?: number } = {},
): Promise<number> {
  const stallMs = opts.stallMs ?? 40_000;
  const absoluteMs = opts.absoluteMs ?? 20 * 60_000;
  lastActivityAt = Date.now();
  const startedAt = Date.now();

  const run = ff.exec(args, absoluteMs);
  const watchdog = new Promise<number>((_, reject) => {
    const id = window.setInterval(() => {
      const idle = Date.now() - lastActivityAt;
      const total = Date.now() - startedAt;
      if (idle > stallMs || total > absoluteMs) {
        window.clearInterval(id);
        terminateFfmpeg();
        reject(
          new EngineStalledError(
            idle > stallMs
              ? `the encoder stopped responding after ${Math.round(idle / 1000)}s (out of memory on long clips)`
              : `the encoder exceeded its ${Math.round(absoluteMs / 60000)} minute limit`,
          ),
        );
      }
    }, 1500);
    run.then(
      () => window.clearInterval(id),
      () => window.clearInterval(id),
    );
  });

  return Promise.race([run, watchdog]);
}

/** Frees the wasm FS between exports so memory never accumulates. */
export async function cleanupOutputs(ff: FFmpeg): Promise<void> {
  for (const path of ["output.mp4", "processed.wav", "raw.wav"]) {
    try {
      await ff.deleteFile(path);
    } catch {
      /* file was not there */
    }
  }
}

/**
 * The official cores are GPL builds with libx264 + native AAC, so assume them
 * and skip a whole ffmpeg run (`-encoders` also emits hundreds of log messages
 * that the worker has to post to the main thread). Probing stays as the retry
 * path if an exec is rejected.
 */
export function assumedCodecs(): CodecInfo {
  return { video: "libx264", audio: "aac" };
}

/**
 * Fetch with a stall guard: a slow-but-moving 32 MB download is allowed to
 * finish (the user sees byte progress), a dead connection is cut after 20 s of
 * zero movement instead of hanging the whole export.
 */
async function fetchToBlob(url: string, onPct?: (pct: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || !Number.isFinite(total) || total === 0) {
    onPct?.(100);
    return res.blob();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastMove = Date.now();
  for (;;) {
    const read = reader.read();
    const guard = new Promise<never>((_, reject) => {
      const id = window.setInterval(() => {
        if (Date.now() - lastMove > 20_000) {
          window.clearInterval(id);
          reject(new Error("download stalled"));
        }
      }, 2000);
      read.finally(() => window.clearInterval(id));
    });
    const { done, value } = await Promise.race([read, guard]);
    if (done) break;
    chunks.push(value);
    received += value.length;
    lastMove = Date.now();
    onPct?.(Math.min(99, Math.round((received / total) * 100)));
  }
  onPct?.(100);
  return new Blob(chunks as BlobPart[]);
}

interface Attempt {
  mt: boolean;
  host: string;
  flavor: "esm" | "umd";
  useCdnWorker: boolean;
}

/**
 * The worker runs as an ES module, where `importScripts` does not exist, so the
 * library falls back to `await import(coreURL).default` — only the ESM core
 * build provides that. UMD stays as a last resort.
 */
function buildAttempts(): Attempt[] {
  const wantMT = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated === true;
  const out: Attempt[] = [];
  const worker = inlinedClassWorkerURL();
  for (const mt of wantMT ? [true, false] : [false]) {
    for (const host of HOSTS) {
      if (!worker) out.push({ mt, host, flavor: "esm", useCdnWorker: true });
      out.push({ mt, host, flavor: "esm", useCdnWorker: false });
    }
    out.push({ mt, host: HOSTS[0], flavor: "umd", useCdnWorker: false });
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => {
      onTimeout();
      reject(new Error(`engine load timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    p.then(
      (v) => {
        window.clearTimeout(id);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(id);
        reject(e);
      },
    );
  });
}

async function attemptLoad(a: Attempt, onProgress?: (pct: number) => void): Promise<{ ff: FFmpeg; mt: boolean }> {
  const pkg = a.mt ? "@ffmpeg/core-mt" : "@ffmpeg/core";
  const base = `https://${a.host}/npm/${pkg}@${CORE_VERSION}/dist/${a.flavor}`;
  const ff = new FFmpeg();
  ff.on("log", ({ message }) => {
    lastActivityAt = Date.now();
    logLines.push(message);
    if (logLines.length > 300) logLines.splice(0, 120);
  });
  ff.on("progress", ({ time }) => {
    lastActivityAt = Date.now();
    if (typeof time === "number" && engineProgressCb) {
      try {
        engineProgressCb(time);
      } catch {
        /* noop */
      }
    }
  });

  try {
    // the 32 MB wasm is the long pole — report real byte progress
    const coreURL = URL.createObjectURL(await fetchToBlob(`${base}/ffmpeg-core.js`, (p) => onProgress?.(p * 0.06)));
    const wasmURL = URL.createObjectURL(
      await fetchToBlob(`${base}/ffmpeg-core.wasm`, (p) => onProgress?.(6 + p * 0.88)),
    );
    const config: {
      coreURL: string;
      wasmURL: string;
      workerURL?: string;
      classWorkerURL?: string;
    } = { coreURL, wasmURL };

    if (a.mt) {
      config.workerURL = URL.createObjectURL(
        await fetchToBlob(`${base}/ffmpeg-core.worker.js`, (p) => onProgress?.(94 + p * 0.04)),
      );
    }
    const inlined = inlinedClassWorkerURL();
    if (inlined && !a.useCdnWorker) config.classWorkerURL = inlined;
    else if (a.useCdnWorker)
      config.classWorkerURL = `https://${a.host}/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js`;

    await withTimeout(ff.load(config), 30_000, () => {
      try {
        ff.terminate();
      } catch {
        /* noop */
      }
    });
    onProgress?.(100);
    return { ff, mt: a.mt };
  } catch (e) {
    try {
      ff.terminate();
    } catch {
      /* noop */
    }
    throw e;
  }
}

export function ensureFfmpeg(onProgress?: (pct: number) => void): Promise<FFmpeg> {
  if (engine) return Promise.resolve(engine);
  if (engineLoading) return engineLoading;

  engineLoading = (async () => {
    let lastErr: unknown = new Error("the ffmpeg engine could not be loaded");
    // per-load budget, reset every time (a cancelled export terminates the
    // engine, and the next one must be allowed its own set of attempts)
    loadAttempts = 0;
    for (const attempt of buildAttempts()) {
      loadAttempts += 1;
      if (loadAttempts > 8) break;
      try {
        const loaded = await attemptLoad(attempt, onProgress);
        engine = loaded.ff;
        engineMT = loaded.mt;
        return loaded.ff;
      } catch (e) {
        lastErr = e;
      }
    }
    engineLoading = null;
    throw lastErr;
  })();

  return engineLoading;
}

/** Which encoders does this build really have? (official cores ship GPL x264) */
export async function probeCodecs(ff: FFmpeg): Promise<CodecInfo> {
  if (cachedCodecs) return cachedCodecs;
  const before = logLines.length;
  await execGuarded(ff, ["-hide_banner", "-encoders"], { stallMs: 20_000, absoluteMs: 60_000 });
  const out = logLines.slice(before).join("\n");
  const tokens = out.split("\n").flatMap((l) => l.trim().split(/\s+/));
  const has = (name: string) => tokens.includes(name);
  cachedCodecs = {
    video: has("libx264") ? "libx264" : "mpeg4",
    audio: has("aac") ? "aac" : has("libmp3lame") ? "libmp3lame" : "copy",
  };
  return cachedCodecs;
}

/** Source video codec, cached per clip — decides whether we can stream-copy. */
export async function probeVideoCodec(ff: FFmpeg, inputName: string, token: string): Promise<string | null> {
  if (cachedSrcCodec && cachedSrcCodec.token === token) return cachedSrcCodec.codec;
  const before = logLines.length;
  try {
    // info loglevel is required here: the probe parses the stream listing
    await execGuarded(ff, ["-hide_banner", "-i", inputName], { stallMs: 20_000, absoluteMs: 60_000 });
  } catch (e) {
    if (e instanceof EngineStalledError) throw e;
    /* ffmpeg exits non-zero with no output file; the probe logs are still written */
  }
  const out = logLines.slice(before).join("\n");
  const m = out.match(/Video:\s*([a-zA-Z0-9_-]+)/);
  const codec = m ? m[1].toLowerCase() : null;
  cachedSrcCodec = { token, codec };
  return codec;
}

/** Writes the clip into the wasm FS only once per recording/import. */
export async function writeInputOnce(
  ff: FFmpeg,
  token: string,
  name: string,
  data: Uint8Array,
): Promise<boolean> {
  if (cachedInput && cachedInput.token === token && cachedInput.name === name) return false;
  await ff.writeFile(name, data);
  cachedInput = { token, name };
  return true;
}

export function inputNameForMime(mime: string, fallbackExt = "webm"): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("mp4")) return "input.mp4";
  if (m.includes("quicktime") || m.includes("mov")) return "input.mov";
  if (m.includes("matroska") || m.includes("webm")) return "input.webm";
  if (m.includes("ogg")) return "input.ogv";
  if (m.includes("avi")) return "input.avi";
  if (m.includes("3gpp")) return "input.3gp";
  return `input.${fallbackExt}`;
}

export function extForMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  if (m.includes("webm") || m.includes("matroska")) return "webm";
  if (m.includes("ogg")) return "ogv";
  if (m.includes("avi")) return "avi";
  if (m.includes("3gpp")) return "3gp";
  return "mp4";
}

/** Caps the long side per profile; returns an ffmpeg scale argument or null. */
export function scaleArgFor(profile: ExportProfile, w: number, h: number): string | null {
  const limit = profile === "fast" ? 1280 : profile === "balanced" ? 1920 : null;
  if (!limit || !w || !h) return null;
  if (Math.max(w, h) <= limit) return null;
  return w >= h ? `${limit}:-2` : `-2:${limit}`;
}

/**
 * A/V sync contract
 *  - `-ss START` sits before `-i`, so the decoder starts exactly at the trim
 *    point and the output timeline is re-based to 0.
 *  - the processed WAV is rendered offline from the SAME [start, end] window at
 *    48 kHz, or (when no effect is applied) the source audio is taken from the
 *    very same input and the same seek — either way both streams share one
 *    origin, so no offset can appear.
 *  - `-t RANGE` is an OUTPUT duration limit. Unlike `-to` used as an input
 *    option, it is not affected by the timeline reset that `-ss` performs, so
 *    the encoded segment is exactly `end - start` long.
 *  - `-avoid_negative_ts make_zero` keeps the first packet of each stream at 0.
 *  - Stream-copy is only used when the seek lands on frame 0 (full-range trim
 *    of an H.264 source), which cannot introduce a keyframe offset.
 *  - No `-r` / fps conversion: MediaRecorder output is variable-frame-rate and
 *    forcing CFR rewrites the video timeline, which is a classic drift source.
 */
export function buildMuxArgs(codecs: CodecInfo, startSec: number, opts: MuxOptions): string[] {
  const profile: ExportProfile = opts.profile ?? "fast";
  const threads = opts.threads ?? 1;
  const audioBitrate = profile === "fast" ? "128k" : profile === "balanced" ? "160k" : "192k";

  // `-loglevel error` matters for speed: every ffmpeg status line is posted
  // from the worker to the main thread, and an encode emits hundreds per second.
  const args: string[] = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    startSec.toFixed(3),
    "-i",
    opts.inputName,
  ];
  if (opts.audio === "wav") args.push("-i", "processed.wav");

  args.push("-map", "0:v:0");
  if (opts.audio === "wav") args.push("-map", "1:a:0");
  else if (opts.audio === "input") args.push("-map", "0:a:0?");

  // `hflip` must be baked in at encode time: a browser CSS transform only
  // changes the preview, never the bytes inside the exported file.
  const filters: string[] = [];
  if (opts.mirror) filters.push("hflip");
  if (opts.scale) filters.push(`scale=${opts.scale}`);

  if (opts.mode === "copy-all") {
    args.push("-c", "copy");
  } else {
    if (opts.mode === "copy-video") {
      args.push("-c:v", "copy");
    } else if (codecs.video === "libx264") {
      args.push(
        "-c:v",
        "libx264",
        "-preset",
        profile === "fast" ? "ultrafast" : profile === "balanced" ? "veryfast" : "medium",
        "-crf",
        profile === "fast" ? "26" : profile === "balanced" ? "23" : "20",
        "-pix_fmt",
        "yuv420p",
        // H.264 Baseline + 8-bit 4:2:0 is broadly supported by mobile
        // hardware decoders, browsers and desktop video players.
        "-profile:v",
        "baseline",
        "-threads",
        String(threads),
      );
      if (filters.length) args.push("-vf", filters.join(","));
    } else {
      args.push("-c:v", "mpeg4", "-q:v", profile === "high" ? "3" : "6", "-pix_fmt", "yuv420p");
      if (filters.length) args.push("-vf", filters.join(","));
    }

    if (codecs.video === "libx264") args.push("-tag:v", "avc1");

    if (opts.audio === "none") args.push("-an");
    else if (codecs.audio === "aac") args.push("-c:a", "aac", "-b:a", audioBitrate, "-ar", "48000", "-ac", "2");
    else if (codecs.audio === "libmp3lame") args.push("-c:a", "libmp3lame", "-b:a", "160k", "-ar", "48000", "-ac", "2");
    else args.push("-c:a", "copy");
  }

  // A fragmented MP4 (Android MediaRecorder) can report a duration of ~1s for
  // a much longer clip. When the user kept the whole clip, letting the decoder
  // run to the natural end is safer than trusting that number.
  if (!opts.untilEnd) args.push("-t", opts.rangeSec.toFixed(3));

  args.push(
    "-avoid_negative_ts",
    "make_zero",
    "-shortest",
    "-movflags",
    "+faststart",
    "output.mp4",
  );
  return args;
}
