import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RecordScreen from "./components/RecordScreen";
import EditorScreen from "./components/EditorScreen";
import StartupScreen from "./components/StartupScreen";
import ExportScreen from "./components/ExportScreen";
import ConfirmExit from "./components/ConfirmExit";
import RamyaSplash from "./components/RamyaSplash";
import PaywallScreen from "./components/PaywallScreen";
import { canExport, exportsRemaining, isSubscribed, noteExportDone } from "./lib/billing";

import {
  audioBufferToWav,
  buildEffectGraph,
  DEFAULT_PARAMS,
  EXPORT_SAMPLE_RATE,
  getAudioContext,
  isNeutral,
  renderProcessedAudio,
  sourceForMedia,
  type BuiltGraph,
  type EffectParams,
} from "./lib/audio";
import {
  assumedCodecs,
  buildMuxArgs,
  cleanupOutputs,
  engineThreads,
  EngineStalledError,
  ensureFfmpeg,
  execGuarded,
  extForMime,
  inputNameForMime,
  isEngineReady,
  isMultiThread,
  MAX_SOURCE_BYTES,
  probeCodecs,
  scaleArgFor,
  setEngineProgress,
  terminateFfmpeg,
  writeInputOnce,
  type AudioSource,
  type CodecInfo,
  type MuxMode,
} from "./lib/ffmpeg";
import { exportWithMediaRecorder } from "./lib/exporter";
import {
  bitrateForStream,
  cameraErrorMessage,
  pickMimeType,
  startCamera,
  supportedQualities,
  type CameraFacing,
  type CaptureQuality,
} from "./lib/recorder";
import {
  dataToBlob,
  formatBytes,
  isInIframe,
  SAVE_METHOD_HINT,
  saveBlobSmart,
  shareBlob,
  shareSupported,
  stampFilename,
  triggerDownload,
} from "./lib/format";
import type { ClipItem, ExportProfile, ExportUI, RunInfo } from "./lib/types";

interface RecordingData {
  url: string;
  blob: Blob;
  mime: string;
  /** the clip should be shown and exported horizontally flipped */
  mirrored: boolean;
}

export type EngineState = "idle" | "loading" | "ready" | "error";

export default function App() {
  // "echo" → "studio" → done
  const [splash, setSplash] = useState<"echo" | "studio" | "done">("echo");
  const [paywall, setPaywall] = useState(false);
  const [subscribed, setSubscribed] = useState(() => isSubscribed());
  const [freeLeft, setFreeLeft] = useState(() => exportsRemaining());
  const [mode, setMode] = useState<"record" | "editor">("record");
  const [camState, setCamState] = useState<"starting" | "live" | "error">("starting");
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("user");
  const [mirror, setMirror] = useState(true);
  const [confirmExit, setConfirmExit] = useState(false);
  const [quality, setQuality] = useState<CaptureQuality>("auto");
  const [availableQualities, setAvailableQualities] = useState<CaptureQuality[]>(["auto"]);
  const [camError, setCamError] = useState("");
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [importing, setImporting] = useState(false);
  const [sourceKind, setSourceKind] = useState<"recording" | "import">("recording");

  const [rec, setRec] = useState<RecordingData | null>(null);
  const [, setClips] = useState<ClipItem[]>([]);
  const [activeClipId, setActiveClipId] = useState("");
  const [, setBypassing] = useState(false);
  const [, setRunInfo] = useState<RunInfo | null>(null);
  const [duration, setDuration] = useState(0);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [bufferError, setBufferError] = useState(false);
  const [params, setParamsState] = useState<EffectParams>(DEFAULT_PARAMS);
  const [trim, setTrim] = useState({ start: 0, end: 0 });
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [exportUI, setExportUI] = useState<ExportUI>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [, setEngineState] = useState<EngineState>("idle");
  const [audioState, setAudioState] = useState<"off" | "suspended" | "live">("off");
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const [proxy, setProxy] = useState<{ status: "idle" | "busy" | "error"; pct: number; note: string }>({
    status: "idle",
    pct: 0,
    note: "",
  });

  const [analyserRec, setAnalyserRec] = useState<AnalyserNode | null>(null);
  const [, setAnalyserEditor] = useState<AnalyserNode | null>(null);

  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordStartRef = useRef(0);
  const recordedSecRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const elementSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const graphRef = useRef<BuiltGraph | null>(null);
  const clipUrlsRef = useRef<string[]>([]);
  const clipSeqRef = useRef(0);
  const cameraTokenRef = useRef(0);
  const cameraFacingRef = useRef<CameraFacing>("user");
  const mirrorRef = useRef(true);
  const qualityRef = useRef<CaptureQuality>("auto");
  const paramsRef = useRef<EffectParams>(DEFAULT_PARAMS);
  const audioUnlockedRef = useRef(false);
  const proxyBusyRef = useRef(false);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const durationHackRef = useRef(false);
  const durationRef = useRef(0);
  const cancelRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);
  const profileRef = useRef<ExportProfile>("fast");

  // brand bumper first, then the studio bumper, then the camera
  useEffect(() => {
    if (splash === "done") return;
    const ms = splash === "echo" ? 1250 : 3200;
    const timer = window.setTimeout(() => setSplash((s) => (s === "echo" ? "studio" : "done")), ms);
    return () => window.clearTimeout(timer);
  }, [splash]);

  const inIframe = useMemo(() => isInIframe(), []);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4200);
  }, []);

  // ---------------- camera ----------------
  const teardownCamera = useCallback(() => {
    cameraTokenRef.current += 1;
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    setCamStream(null);
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
    setAnalyserRec(null);
  }, []);

  const initCamera = useCallback(async () => {
    setCamState("starting");
    setCamError("");
    const token = ++cameraTokenRef.current;
    try {
      const stream = await startCamera(cameraFacingRef.current, qualityRef.current);
      if (token !== cameraTokenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      camStreamRef.current = stream;
      setCamStream(stream);
      if (liveVideoRef.current) liveVideoRef.current.srcObject = stream;
      setCamState("live");
      // only offer the modes this particular sensor can really deliver
      setAvailableQualities(supportedQualities(stream));
      // input meter only — an analyser never routes the mic to the speakers
      try {
        const ctx = await getAudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        an.smoothingTimeConstant = 0.72;
        src.connect(an);
        micSourceRef.current = src;
        setAnalyserRec(an);
      } catch {
        setAnalyserRec(null);
      }
    } catch (e) {
      if (token === cameraTokenRef.current) {
        setCamError(cameraErrorMessage(e));
        setCamState("error");
      }
    }
  }, []);

  const flipCamera = useCallback(() => {
    if (isRecording) {
      flash("Stop recording before switching cameras");
      return;
    }
    const next: CameraFacing = cameraFacingRef.current === "user" ? "environment" : "user";
    cameraFacingRef.current = next;
    setCameraFacing(next);
    // sensible default per camera; the user can still override it afterwards
    const defaultMirror = next === "user";
    mirrorRef.current = defaultMirror;
    setMirror(defaultMirror);
    teardownCamera();
    void initCamera();
  }, [flash, initCamera, isRecording, teardownCamera]);

  /** Re-opens the camera at a new capture size. */
  const changeQuality = useCallback(
    (next: CaptureQuality) => {
      if (isRecording) {
        flash("Stop recording before changing quality");
        return;
      }
      if (next === qualityRef.current) return;
      qualityRef.current = next;
      setQuality(next);
      teardownCamera();
      void initCamera();
    },
    [flash, initCamera, isRecording, teardownCamera],
  );

  useEffect(() => {
    void initCamera();
    return teardownCamera;
  }, [initCamera, teardownCamera]);

  // an AudioContext may only start after a gesture — resume on first input
  useEffect(() => {
    const resume = () => {
      void getAudioContext().catch(() => {});
    };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, []);

  // ---------------- recording ----------------
  const onRecorderStop = useCallback(() => {
    const mime = recorderRef.current?.mimeType || "video/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];
    recordedSecRef.current = (performance.now() - recordStartRef.current) / 1000;
    teardownCamera();
    if (blob.size === 0) {
      setCamError("The recording came back empty — please try again.");
      setCamState("error");
      return;
    }
    const url = URL.createObjectURL(blob);
    clipUrlsRef.current.push(url);
    setSourceKind("recording");
    // remember the angle chosen at capture time so preview and export agree
    setRec({ url, blob, mime, mirrored: mirrorRef.current });
    addClip({ url, blob, mime, kind: "recording", seconds: recordedSecRef.current });
    resetEditorState();
    setMode("editor");
    void decodeAudio(blob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teardownCamera]);

  const startRecording = useCallback(async () => {
    const stream = camStreamRef.current;
    if (!stream || isRecording) return;
    try {
      await getAudioContext();
    } catch {
      /* ignore */
    }
    const mime = pickMimeType();
    // bitrate follows the chosen capture size, so 4K is not starved and
    // 480p does not waste space
    const videoBitsPerSecond = bitrateForStream(stream);
    const recorder = new MediaRecorder(
      stream,
      mime ? { mimeType: mime, videoBitsPerSecond, audioBitsPerSecond: 192_000 } : undefined,
    );
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = onRecorderStop;
    recorderRef.current = recorder;
    recordStartRef.current = performance.now();
    setElapsed(0);
    recorder.start(250);
    setIsRecording(true);
  }, [isRecording, onRecorderStop]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {
      /* noop */
    }
    setIsRecording(false);
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    tickRef.current = window.setInterval(() => {
      setElapsed((performance.now() - recordStartRef.current) / 1000);
    }, 100);
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
    };
  }, [isRecording]);

  // ---------------- editor state ----------------
  function resetEditorState(keepParams = false) {
    setDuration(0);
    setTrim({ start: 0, end: 0 });
    if (!keepParams) {
      setParamsState(DEFAULT_PARAMS);
      paramsRef.current = DEFAULT_PARAMS;
    }
    setBuffer(null);
    bufferRef.current = null;
    setBufferError(false);
    setPlaying(false);
    setPlayhead(0);
    setExportUI({ kind: "idle" });
    setRunInfo(null);
    setBypassing(false);
    durationHackRef.current = false;
    // make sure the graph is back on the stored chain (a bypass could be active)
    void getAudioContext()
      .then(() => graphRef.current?.setParams(paramsRef.current))
      .catch(() => {});
  }

  /** Session library: every take and every import stays switchable. */
  const addClip = useCallback((c: Omit<ClipItem, "id" | "label">, label?: string) => {
    clipSeqRef.current += 1;
    const id = `clip-${clipSeqRef.current}`;
    const item: ClipItem = {
      ...c,
      id,
      label: label ?? (c.kind === "recording" ? `Take ${String(clipSeqRef.current).padStart(2, "0")}` : "Import"),
    };
    setClips((prev) => [...prev, item]);
    setActiveClipId(id);
  }, []);

  /** Momentary A/B: hear the original signal without losing the settings. */
  const setBypass = useCallback((on: boolean) => {
    setBypassing(on);
    const p = paramsRef.current;
    const next = on ? { ...p, wet: 0, delayTime: 0, feedback: 0 } : p;
    void getAudioContext()
      .then(() => graphRef.current?.setParams(next))
      .catch(() => {});
  }, []);

  /**
   * Merges a duration candidate with everything else we know and keeps the
   * longest credible value: a container header, the decoded audio length and
   * the wall-clock time measured while recording can each be wrong on their
   * own, but they are never all short at once.
   */
  const resolveDuration = useCallback((candidate: number) => {
    const sane = (n: number) => (Number.isFinite(n) && n > 0 && n < 36_000 ? n : 0);
    setDuration((prev) =>
      Math.max(
        sane(prev),
        sane(candidate),
        sane(bufferRef.current?.duration ?? 0),
        recordedSecRef.current > 0.2 ? sane(recordedSecRef.current) : 0,
      ) || prev,
    );
  }, []);

  const decodeAudio = useCallback(async (blob: Blob) => {
    // Decoding a whole video file on the main thread fights the video decoder:
    // picture freezes after a few seconds while currentTime keeps ticking.
    // Wait until the first frames have settled, and decode a COPY so the
    // object-URL the <video> is using is never detached.
    await new Promise((r) => window.setTimeout(r, 1200));
    try {
      const ctx = await getAudioContext();
      const copy = blob.slice(0, blob.size, blob.type);
      const ab = await copy.arrayBuffer();
      const audio = await ctx.decodeAudioData(ab);
      bufferRef.current = audio;
      setBuffer(audio);
      setBufferError(false);
      resolveDuration(audio.duration);
    } catch {
      bufferRef.current = null;
      setBuffer(null);
      setBufferError(true);
      resolveDuration(recordedSecRef.current);
    }
  }, [resolveDuration]);

  // keep the rail's durations in step with what the player actually reports
  useEffect(() => {
    if (duration <= 0 || !activeClipId) return;
    setClips((prev) =>
      prev.map((c) =>
        c.id === activeClipId && Math.abs(c.seconds - duration) > 0.05 ? { ...c, seconds: duration } : c,
      ),
    );
  }, [duration, activeClipId]);

  // ---------------- import from phone ----------------
  const handleImportFile = useCallback(
    async (file: File) => {
      if (!file) return;
      setImporting(true);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          /* noop */
        }
      }
      setIsRecording(false);
      teardownCamera();
      const url = URL.createObjectURL(file);
      clipUrlsRef.current.push(url);
      recordedSecRef.current = 0;
      const mime = file.type || "video/mp4";
      setSourceKind("import");
      // an imported file is already in its final orientation
      setRec({ url, blob: file, mime, mirrored: false });
      addClip(
        { url, blob: file, mime, kind: "import", seconds: 0 },
        file.name.replace(/\.[^.]+$/, "").slice(0, 22) || "Import",
      );
      resetEditorState();
      setMode("editor");
      setImporting(false);
      flash(`Imported “${file.name}”`);
      void decodeAudio(file);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [teardownCamera, decodeAudio, flash],
  );

  // ---------------- engine warm-up ----------------
  // The encoder core is ~32 MB, so start pulling it as soon as the camera is
  // live instead of at Export time. Hitting the fallback path (which re-records
  // in real time) is almost always caused by the engine not being ready yet.
  useEffect(() => {
    if (camState !== "live" && mode !== "editor") return;
    if (isEngineReady()) {
      setEngineState("ready");
      return;
    }
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    let alive = true;
    setEngineState((s) => (s === "error" ? "loading" : s === "idle" ? "loading" : s));
    ensureFfmpeg()
      .then(() => {
        if (alive) setEngineState("ready");
      })
      .catch(() => {
        if (alive) setEngineState("error");
      });
    return () => {
      alive = false;
    };
  }, [camState, mode, rec?.url]);

  // ---------------- unplayable imports → preview proxy ----------------
  /**
   * Phone cameras commonly record HEVC/HDR (iPhone .mov, many Android .mp4)
   * which the browser simply cannot decode: the element fires error code 4, so
   * Play does nothing and there is no audio either. ffmpeg.wasm can decode it,
   * so we convert one H.264/AAC copy and edit that — the preview, the effects,
   * the trim and the export all work again, and export becomes faster too.
   */
  const buildProxy = useCallback(async () => {
    if (!rec || proxyBusyRef.current) return;
    proxyBusyRef.current = true;
    setProxy({ status: "busy", pct: 2, note: "Loading the encoder…" });
    try {
      const ff = await ensureFfmpeg((p) => setProxy({ status: "busy", pct: 2 + p * 0.22, note: "Loading the encoder…" }));
      const bytes = new Uint8Array(await rec.blob.arrayBuffer());
      const srcName = `source-${clipSeqRef.current}.${extForMime(rec.mime)}`;
      await ff.writeFile(srcName, bytes);

      setProxy({ status: "busy", pct: 28, note: "Converting a playable preview copy…" });
      setEngineProgress((t) =>
        setProxy({
          status: "busy",
          pct: Math.min(96, 28 + t * 3),
          note: `Converting a playable preview copy… ${t.toFixed(0)}s done`,
        }),
      );
      const code = await execGuarded(ff, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        srcName,
        "-vf",
        "scale=min(1920\\,iw):-2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "preview.mp4",
      ]);
      setEngineProgress(null);
      if (code !== 0) throw new Error(`the converter exited with code ${code}`);

      const data = await ff.readFile("preview.mp4");
      const blob = dataToBlob(data, "video/mp4");
      if (blob.size < 1024) throw new Error("the converter produced an empty file");
      await cleanupOutputs(ff);
      try {
        await ff.deleteFile(srcName);
      } catch {
        /* noop */
      }

      const url = URL.createObjectURL(blob);
      clipUrlsRef.current.push(url);
      const id = activeClipId;
      setClips((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, url, blob, mime: "video/mp4", seconds: 0, label: `${c.label} · proxy` } : c,
        ),
      );
      // the proxy keeps whatever orientation the original clip had
      setRec((prev) => ({ url, blob, mime: "video/mp4", mirrored: prev?.mirrored ?? false }));
      recordedSecRef.current = 0;
      resetEditorState();
      setProxy({ status: "idle", pct: 0, note: "" });
      flash("Preview copy ready — playback, effects and export now work");
      void decodeAudio(blob);
    } catch (e) {
      setEngineProgress(null);
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("preview proxy failed", e);
      setProxy({ status: "error", pct: 0, note: msg });
    } finally {
      proxyBusyRef.current = false;
      setEngineProgress(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, activeClipId, decodeAudio, flash]);

  const handleUnplayable = useCallback(() => {
    void buildProxy();
  }, [buildProxy]);

  // watchdog: some containers fail without ever firing an error event
  useEffect(() => {
    if (mode !== "editor" || !rec) return;
    const id = window.setTimeout(() => {
      const v = videoRef.current;
      if (!v || proxyBusyRef.current) return;
      // only on definitive failure signals, never while a big file is still loading
      const noSource = v.networkState === 3 || !!v.error;
      if (noSource && v.readyState === 0 && durationRef.current <= 0) void buildProxy();
    }, 3500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, rec?.url]);

  // ---------------- audio unlock ----------------
  // Until the browser has seen a gesture the AudioContext is suspended, and on
  // iOS routing a <video> into a suspended context can stop playback entirely.
  // So the element first plays natively (with its own sound), and the effect
  // chain binds on the first tap inside the editor.
  useEffect(() => {
    if (mode !== "editor") return;
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      void getAudioContext()
        .then((ctx) => {
          const running = (ctx.state as string) === "running";
          setAudioState(running ? "live" : "suspended");
          if (running) {
            audioUnlockedRef.current = true;
            setAudioUnlocked(true);
          }
        })
        .catch(() => setAudioState("off"));
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [mode]);

  // ---------------- editor audio graph ----------------
  useEffect(() => {
    // Bind WHILE PAUSED, and only once per element. createMediaElementSource()
    // mid-playback is what froze imported clips after a few seconds: the
    // decoder stalls, currentTime keeps ticking, audio dies.
    if (mode !== "editor" || !audioUnlocked) return;
    const el = videoRef.current;
    if (!el) return;
    let graph: BuiltGraph | null = null;
    let src: MediaElementAudioSourceNode | null = null;
    let an: AnalyserNode | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await getAudioContext();
        if (cancelled || !videoRef.current) return;
        const media = videoRef.current;
        const wasPlaying = !media.paused;
        // If we somehow get here during playback, pause first — hijacking a
        // live decoder is the stall. We'll resume after the graph is wired.
        if (wasPlaying) {
          try {
            media.pause();
          } catch {
            /* noop */
          }
        }
        src = sourceForMedia(ctx, media);
        elementSrcRef.current = src;
        try {
          src.disconnect();
        } catch {
          /* first connect */
        }
        try {
          graph = buildEffectGraph(ctx, ctx.destination, paramsRef.current);
          graphRef.current = graph;
          src.connect(graph.input);
          an = ctx.createAnalyser();
          an.fftSize = 512;
          an.smoothingTimeConstant = 0.8;
          graph.output.connect(an);
          setAnalyserEditor(an);
        } catch (graphErr) {
          console.warn("effect graph failed, routing dry", graphErr);
          try {
            graph?.destroy();
          } catch {
            /* noop */
          }
          graph = null;
          graphRef.current = null;
          src.connect(ctx.destination);
        }
        if (wasPlaying && !cancelled) {
          Promise.resolve(media.play()).catch(() => {});
        }
        setAudioState((ctx.state as string) === "running" ? "live" : "suspended");
      } catch (e) {
        console.warn("audio graph init failed", e);
      }
    })();
    return () => {
      cancelled = true;
      graph?.destroy();
      if (graphRef.current === graph) graphRef.current = null;
      try {
        src?.disconnect();
      } catch {
        /* noop */
      }
      an?.disconnect();
      setAnalyserEditor(null);
      // Keep the MediaElementAudioSourceNode on the element — it cannot be
      // recreated, and destroying it is what caused the freeze/silence.
    };
  }, [mode, rec?.url, audioUnlocked]);

  const updateParams = useCallback((next: EffectParams) => {
    paramsRef.current = next;
    setParamsState(next);
    void getAudioContext()
      .then(() => graphRef.current?.setParams(next))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (duration > 0) setTrim((t) => (t.end <= 0 ? { start: 0, end: duration } : t));
  }, [duration]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = -1;
    const loop = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime;
        if (Math.abs(t - last) > 0.03) {
          setPlayhead(t);
          last = t;
        }
        // Playback is the ground truth: a header that under-reports the length
        // is exposed the moment the playhead runs past it.
        const d = v.duration;
        if (durationRef.current <= 0 && Number.isFinite(d) && d > 0) setDuration(d);
        else if (durationRef.current <= 0 && recordedSecRef.current > 0.2) setDuration(recordedSecRef.current);
        else if (t > durationRef.current + 0.15) setDuration(t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const syncAudioState = useCallback(() => {
    void getAudioContext()
      .then((ctx) => setAudioState(ctx.state === "running" ? "live" : "suspended"))
      .catch(() => setAudioState("off"));
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) {
      v.pause();
      return;
    }
    // Rewind whenever the playhead is parked at (or past) the end — otherwise
    // play() resolves straight into `ended` and the button looks dead.
    try {
      const known = durationRef.current;
      const t = v.currentTime;
      if (v.ended || !Number.isFinite(t) || t > 1e5 || (known > 0 && t >= known - 0.08)) {
        v.currentTime = 0;
        setPlayhead(0);
      }
    } catch {
      /* seek not available yet */
    }
    // NOTE: never call v.load() here — it aborts an in-flight play() promise
    // with AbortError, which is exactly the "button does nothing" symptom.

    // `play()` MUST be called synchronously inside the gesture: awaiting the
    // AudioContext first drops the user activation on iOS and the video then
    // silently refuses to start.
    const started = v.play();
    syncAudioState();
    Promise.resolve(started).catch((e: unknown) => {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError") flash("Tap Play once more to start playback");
      else if (name === "NotSupportedError") flash("This clip cannot be decoded by the browser — try importing an MP4");
      else flash(`Playback failed${name ? ` — ${name}` : ""}`);
    });
  }, [flash, syncAudioState]);

  /** Explicit gesture to un-suspend the audio graph (the "no sound" fix). */
  const enableAudio = useCallback(() => {
    void getAudioContext().then((ctx) => {
      const running = (ctx.state as string) === "running";
      setAudioState(running ? "live" : "suspended");
      if (running) {
        audioUnlockedRef.current = true;
        setAudioUnlocked(true);
      }
      const v = videoRef.current;
      if (v && v.paused) Promise.resolve(v.play()).catch(() => {});
    });
  }, []);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setPlayhead(t);
  }, []);

  /**
   * Container metadata is unreliable for MediaRecorder output: WebM often says
   * `Infinity`, and a fragmented MP4 can describe only its first fragment. The
   * duration is therefore merged from several signals rather than read once.
   */
  const handleMeta = useCallback((el: HTMLVideoElement) => {
    // Never trust a single source. Android MediaRecorder writes a FRAGMENTED
    // MP4 whose header only describes the first fragment, so `el.duration` can
    // come back as ~1s for a much longer clip — and a decodeAudioData() of the
    // same file can be just as short. Taking the longest credible signal keeps
    // a bad header from silently truncating the trim range, and the export.
    resolveDuration(el.duration);
    // Deliberately NO end-seek duration probe here. A MediaRecorder WebM reports
    // duration = Infinity, and seeking to a huge offset can leave the element
    // permanently in the `seeking` state: play() then resolves, `paused` goes
    // false, yet not a single frame is ever rendered — which looks exactly like
    // a dead Play button with no sound. The duration resolves on its own from
    // the decoded audio buffer and from the playhead once playback starts.
  }, []);

  const handleCancelExport = useCallback(() => {
    cancelRef.current = true;
    setEngineProgress(null);
    terminateFfmpeg();
    setEngineState("idle");
    setExportUI({ kind: "idle" });
    flash("Export cancelled");
  }, [flash]);

  // ---------------- export (fast, sync-accurate pipeline) ----------------
  const handleExport = useCallback(async () => {
    if (!rec || exportUI.kind === "busy") return;
    // free tier allows one export; after that the paywall takes over
    if (!canExport()) {
      setPaywall(true);
      return;
    }
    const v = videoRef.current;
    const chosenProfile = profileRef.current;
    const startedAt = performance.now();

    const mediaDur = duration > 0 ? duration : v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const start = Math.max(0, trim.start);
    let end = trim.end;
    if (end <= 0 && mediaDur > 0) end = mediaDur;
    if (end - start < 0.15) {
      setExportUI({
        kind: "error",
        message:
          mediaDur > 0
            ? "The trim range is too short — set a start and end point first."
            : "Could not read the clip duration. Press Play once, then Export again.",
      });
      return;
    }
    if (mediaDur > 0) end = Math.min(end, mediaDur);

    if (rec.blob.size > MAX_SOURCE_BYTES) {
      setExportUI({
        kind: "error",
        message: `the source clip is ${formatBytes(rec.blob.size)} — in-browser export needs it under ${formatBytes(
          MAX_SOURCE_BYTES,
        )}, so trim a shorter section`,
      });
      return;
    }

    cancelRef.current = false;
    const range = end - start;
    const ext = extForMime(rec.mime);
    const inputName = inputNameForMime(rec.mime, ext);
    const token = rec.url;
    const cancelled = () => cancelRef.current;

    // The encoder reports progress per frame. Forwarding every event re-renders
    // the whole editor and can starve the main thread until the UI looks frozen,
    // so stage changes always show while plain progress is capped at ~5 Hz.
    let lastEmitAt = 0;
    let lastEmitPct = -99;
    let currentNote: string | undefined;
    const busy = (stage: "audio" | "engine" | "video" | "fallback", pct: number, note?: string) => {
      if (note !== undefined) currentNote = note;
      const now = performance.now();
      if (note === undefined && now - lastEmitAt < 200 && Math.abs(pct - lastEmitPct) < 1) return;
      lastEmitAt = now;
      lastEmitPct = pct;
      setExportUI({
        kind: "busy",
        stage,
        pct,
        note: currentNote,
        startedAt,
        rangeSec: range,
        profile: chosenProfile,
      });
    };
    let engineOk = false;
    let ffLive: import("@ffmpeg/ffmpeg").FFmpeg | null = null;

    try {
      // one read of the source bytes, reused for every wasm write
      const sourceBytes = new Uint8Array(await rec.blob.arrayBuffer());

      // 1) engine first: warmed up in the background and cached between
      //    exports, so this is normally already done before Export is pressed
      busy("engine", isEngineReady() ? 34 : 8, "Preparing the encoder…");
      // note is passed once — repeating it would bypass the progress throttle
      const ff = await ensureFfmpeg((p) => busy("engine", 8 + p * 0.26));
      if (cancelled()) return;
      engineOk = true;
      ffLive = ff;
      setEngineState("ready");

      // writeFile structurally clones the whole clip into the worker, which can
      // take a couple of seconds on a large file — say so instead of freezing
      busy("engine", 38, "Copying the clip into the encoder…");
      await writeInputOnce(ff, token, inputName, sourceBytes);
      // assume the GPL build's encoders (libx264 + AAC) and skip a whole ffmpeg
      // run — `-encoders` alone posts hundreds of log lines to the main thread
      let codecs: CodecInfo = assumedCodecs();
      let probed = false;

      // 2) choose the cheapest path that still keeps the sync exact
      const neutral = isNeutral(params);
      // Normalize every export to H.264 Baseline + yuv420p + AAC so the output
      // is broadly playable across mobile devices, desktop players and browsers.
      // Stream-copying an imported H.264 file can preserve uncommon profiles.
      const mode: MuxMode = "encode";
      // With no effect applied the audio can be taken from the very same input
      // and the very same seek — no decode, no render, no WAV, nothing to drift
      const startAudio: AudioSource = neutral ? "input" : "wav";

      let wavWritten = false;
      const ensureWav = async (): Promise<boolean> => {
        if (wavWritten) return true;
        let b = bufferRef.current;
        // decodeAudioData() on a fragmented MP4 can return only the first
        // fragment. Feeding that short buffer to the muxer would cut the whole
        // export down to its length via -shortest, so re-decode with ffmpeg,
        // which reads the fragments properly.
        const truncated = !!b && mediaDur > 0 && b.duration < mediaDur - 0.5;
        if (!b || truncated) {
          busy("audio", 30, "Extracting the audio track…");
          const exit = await execGuarded(ff, [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            inputName,
            "-vn",
            "-c:a",
            "pcm_s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            "raw.wav",
          ]);
          if (exit === 0) {
            try {
              const raw = await ff.readFile("raw.wav");
              const ctx = await getAudioContext();
              const decoded = await ctx.decodeAudioData(await dataToBlob(raw, "audio/wav").arrayBuffer());
              // keep whichever decode actually covers the clip
              if (!b || decoded.duration > b.duration) {
                b = decoded;
                bufferRef.current = decoded;
                setBuffer(decoded);
                setBufferError(false);
              }
            } catch {
              if (!truncated) b = null;
            }
          }
        }
        if (!b) return false;
        busy("audio", 36, "Rendering audio effects offline at 48 kHz…");
        const processed = await renderProcessedAudio(b, params, start, Math.min(end, b.duration));
        await ff.writeFile("processed.wav", new Uint8Array(await audioBufferToWav(processed).arrayBuffer()));
        wavWritten = true;
        return true;
      };
      if (cancelled()) return;

      // 3) one command per attempt, cheapest first, falling back only on a
      //    real encoder rejection — never silently to a slower technique
      const ladder: { mode: MuxMode; audio: AudioSource; video?: string }[] = [
        { mode, audio: startAudio },
        { mode: "encode", audio: "wav", video: "mpeg4" },
      ];

      // Whole clip selected: run to the file's real end rather than to a
      // duration the container may have under-reported.
      const untilEnd = start <= 0.05 && (mediaDur <= 0 || end >= mediaDur - 0.25);
      const scale = scaleArgFor(chosenProfile, v?.videoWidth ?? 0, v?.videoHeight ?? 0);
      const threads = engineThreads();
      let lastError = "";
      let usedMode: MuxMode = "encode";
      let produced = false;

      for (const step of ladder) {
        if (cancelled()) return;
        let audioChoice = step.audio;
        if (audioChoice === "wav" && !(await ensureWav())) audioChoice = "none";

        const preset =
          chosenProfile === "fast" ? "ultrafast" : chosenProfile === "balanced" ? "veryfast" : "medium";
        const label =
          step.mode === "copy-all"
            ? "Remuxing without re-encode (stream copy)…"
            : step.mode === "copy-video"
              ? "Copying video, encoding audio only…"
              : `Encoding H.264 • ${preset} • ${threads} thread${threads > 1 ? "s" : ""}…`;
        busy("video", 42, label);
        setEngineProgress((t) => busy("video", Math.min(98, 42 + (t / range) * 56)));
        const args = buildMuxArgs(step.video ? { ...codecs, video: step.video } : codecs, start, {
          inputName,
          rangeSec: range,
          untilEnd,
          audio: audioChoice,
          mode: step.mode,
          profile: chosenProfile,
          scale: step.mode === "encode" ? scale : null,
          // bake the chosen selfie/normal angle into the exported file
          mirror: step.mode === "encode" ? rec.mirrored : false,
          threads,
        });
        // show the exact command — this is what a real editor wants to see
        setRunInfo({
          command: `ffmpeg ${args.join(" ")}`,
          multithread: isMultiThread(),
          threads,
          sampleRate: EXPORT_SAMPLE_RATE,
          mode:
            step.mode === "copy-all"
              ? "stream copy"
              : step.mode === "copy-video"
                ? "video copy + audio encode"
                : `H.264 ${chosenProfile}`,
        });
        try {
          const code = await execGuarded(ff, args);
          if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
          usedMode = step.mode;
          produced = true;
          break;
        } catch (e) {
          // a dead worker cannot be revived by trying another profile
          if (e instanceof EngineStalledError) throw e;
          lastError = e instanceof Error ? e.message : String(e);
          if (!probed) {
            probed = true;
            try {
              codecs = await probeCodecs(ff);
            } catch {
              /* keep the assumed encoders */
            }
          }
        } finally {
          setEngineProgress(null);
        }
      }
      setEngineProgress(null);
      if (cancelled()) return;
      if (!produced) throw new Error(lastError || "the encoder rejected every profile");

      const data = await ff.readFile("output.mp4");
      const blob = dataToBlob(data, "video/mp4");
      // free the wasm filesystem, otherwise every export piles up another WAV
      // and MP4 in memory until the worker runs out and dies mid-encode
      await cleanupOutputs(ff);
      if (blob.size < 1024) throw new Error("the encoder produced an empty file");
      const filename = stampFilename("mp4");
      const ms = performance.now() - startedAt;
      setExportUI({
        kind: "done",
        blob,
        ext: "mp4",
        filename,
        via: "ffmpeg",
        ms,
        rangeSec: range,
        profile: chosenProfile,
        copyVideo: usedMode !== "encode",
        threads,
      });
      // count it only once the file actually exists
      noteExportDone();
      setFreeLeft(exportsRemaining());
      // Start the browser's native file download as soon as encoding completes,
      // including when embedded in a preview frame. No post-export action is
      // required from the user.
      triggerDownload(resultUrlFor(blob), filename);
    } catch (err) {
      setEngineProgress(null);
      if (cancelled()) return;
      // release whatever the failed run left in the wasm filesystem
      if (ffLive && isEngineReady()) void cleanupOutputs(ffLive).catch(() => {});
      const stalled = err instanceof EngineStalledError;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("ffmpeg export failed", err);
      if (engineOk) {
        // The engine works, so this is a genuine encode problem — report it.
        // Hiding it behind a real-time re-record is what used to produce a
        // slow, badly out-of-sync file.
        if (stalled) {
          setEngineState("idle");
          setExportUI({
            kind: "error",
            message: `${msg}. Try the Fast profile or a shorter trim — the in-browser encoder ran out of memory.`,
          });
        } else {
          setExportUI({ kind: "error", message: msg });
        }
        return;
      }
      setEngineState("error");
      try {
        if (!elementSrcRef.current || !v) throw new Error(msg || "the ffmpeg engine is unavailable");
        busy(
          "fallback",
          5,
          "ffmpeg engine unavailable (offline?) — re-recording in real time, sync may drift…",
        );
        const blob = await exportWithMediaRecorder({
          videoEl: v,
          audioCtx: await getAudioContext(),
          elementSource: elementSrcRef.current,
          params,
          startSec: start,
          endSec: end,
          // this path runs at 1× speed, so the wall clock is honest progress
          onProgress: (p, s) =>
            busy(
              "fallback",
              Math.min(99, 5 + p * 0.94),
              `Re-recording in real time — ${s.toFixed(1)}s of ${range.toFixed(1)}s`,
            ),
        });
        if (cancelled()) return;
        if (blob.size < 1024) throw new Error("the fallback recorder produced an empty file");
        const ext = blob.type.toLowerCase().includes("mp4") ? "mp4" : "webm";
        const filename = stampFilename(ext);
        const ms = performance.now() - startedAt;
        setExportUI({
          kind: "done",
          blob,
          ext,
          filename,
          via: "fallback",
          ms,
          rangeSec: range,
          profile: chosenProfile,
          copyVideo: false,
          threads: 1,
        });
        noteExportDone();
        setFreeLeft(exportsRemaining());
        triggerDownload(resultUrlFor(blob), filename);
      } catch (e2) {
        if (cancelled()) return;
        setExportUI({ kind: "error", message: e2 instanceof Error ? e2.message : "unknown error" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, exportUI.kind, params, trim, duration, inIframe, flash]);

  const handleNewRecording = useCallback(() => {
    teardownCamera();
    setMode("record");
    setRec(null);
    resetEditorState();
    void initCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initCamera, teardownCamera]);

  /**
   * Throw this take away and go straight back to the viewfinder. The clip's
   * object URL is released immediately so a long session of retakes cannot
   * pile up unused video blobs in memory.
   */
  const handleRetake = useCallback(() => {
    const discarded = rec?.url;
    teardownCamera();
    setMode("record");
    setRec(null);
    setClips((prev) => prev.filter((c) => c.url !== discarded));
    resetEditorState();
    if (discarded) {
      clipUrlsRef.current = clipUrlsRef.current.filter((u) => u !== discarded);
      URL.revokeObjectURL(discarded);
    }
    recordedSecRef.current = 0;
    void initCamera();
    flash("Take discarded — ready to record again");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.url, initCamera, teardownCamera, flash]);

  const exportResultUrl = useMemo(
    () => (exportUI.kind === "done" ? URL.createObjectURL(exportUI.blob) : null),
    [exportUI],
  );
  useEffect(() => {
    return () => {
      if (exportResultUrl) URL.revokeObjectURL(exportResultUrl);
    };
  }, [exportResultUrl]);

  const exportShareOk = useMemo(
    () => (exportUI.kind === "done" ? shareSupported(exportUI.blob, exportUI.filename) : false),
    [exportUI],
  );

  /**
   * Runs inside the tap handler so the browser still sees a user gesture. The
   * automatic download fired right after encoding has no gesture behind it, so
   * some browsers — and sandboxed preview frames — silently discard it.
   */
  const handleSaveResult = useCallback(async () => {
    if (exportUI.kind !== "done") return;
    const method = await saveBlobSmart(exportUI.blob, exportUI.filename);
    flash(SAVE_METHOD_HINT[method]);
  }, [exportUI, flash]);

  const handleShareResult = useCallback(async () => {
    if (exportUI.kind !== "done") return;
    const ok = await shareBlob(exportUI.blob, exportUI.filename);
    flash(ok ? "Choose a destination in the share sheet" : "Sharing is not available in this browser");
  }, [exportUI, flash]);

  useEffect(() => {
    return () => {
      clipUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      clipUrlsRef.current = [];
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      setEngineProgress(null);
    };
  }, []);

  /**
   * Intercepts the hardware/browser Back gesture while a clip is open.
   *
   * A history entry is pushed so the first Back press pops that entry instead
   * of leaving the app; we then re-push it so the guard survives repeated
   * presses until the user actually confirms.
   */
  useEffect(() => {
    if (mode !== "editor" || !rec) return;
    window.history.pushState({ echoGuard: true }, "");
    const onPop = () => {
      // during an encode, Back should close the export view, not the clip
      if (exportUI.kind === "busy" || exportUI.kind === "error") setExportUI({ kind: "idle" });
      else setConfirmExit(true);
      window.history.pushState({ echoGuard: true }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [mode, rec, exportUI.kind]);

  /** Native "Leave site?" prompt for tab close / reload while work is open. */
  useEffect(() => {
    if (mode !== "editor" || !rec) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [mode, rec]);

  const leaveEditor = useCallback(() => {
    setConfirmExit(false);
    handleRetake();
  }, [handleRetake]);

  // ---------------- keyboard shortcuts (editor only) ----------------
  useEffect(() => {
    if (mode !== "editor") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const v = videoRef.current;
      if (e.code === "Space") {
        if (el?.tagName === "BUTTON") return; // let the focused button handle it
        e.preventDefault();
        void togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo(Math.min(durationRef.current || Infinity, (v?.currentTime ?? 0) + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo(Math.max(0, (v?.currentTime ?? 0) - 1));
      } else if (e.key === "[") {
        const t = v?.currentTime ?? 0;
        setTrim((s) => ({ start: Math.min(Math.max(0, t), s.end - 0.3), end: s.end }));
      } else if (e.key === "]") {
        const t = v?.currentTime ?? 0;
        setTrim((s) => ({ start: s.start, end: Math.max(Math.min(durationRef.current || t, t), s.start + 0.3) }));
      } else if (e.key === "b" || e.key === "B") {
        setBypass(true);
      } else if (e.key === "e" || e.key === "E") {
        void handleExport();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "b" || e.key === "B") setBypass(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, [mode, togglePlay, seekTo, setBypass, handleExport]);

  return (
    <>
      <ConfirmExit
        open={confirmExit}
        hasUnsavedWork={exportUI.kind !== "done"}
        onStay={() => setConfirmExit(false)}
        onLeave={leaveEditor}
      />

      {notice && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
          <div className="animate-rise pointer-events-auto max-w-md rounded-xl border border-line bg-ink-850/95 px-4 py-2.5 text-center text-xs font-medium text-paper shadow-lg">
            {notice}
          </div>
        </div>
      )}

      {paywall && (
        <PaywallScreen
          onClose={() => setPaywall(false)}
          onUnlocked={() => {
            setPaywall(false);
            setSubscribed(true);
            setFreeLeft(exportsRemaining());
            flash("Echo Pro is active — unlimited exports unlocked");
          }}
        />
      )}

      {splash === "echo" ? (
        <StartupScreen />
      ) : splash === "studio" ? (
        <RamyaSplash />
      ) : mode === "record" || !rec ? (
        <RecordScreen
          camState={camState}
          camError={camError}
          stream={camStream}
          isRecording={isRecording}
          elapsed={elapsed}
          analyser={analyserRec}
          importing={importing}
          cameraFacing={cameraFacing}
          mirror={mirror}
          quality={quality}
          availableQualities={availableQualities}
          onQualityChange={changeQuality}
          onToggleRecord={() => {
            if (isRecording) stopRecording();
            else void startRecording();
          }}
          onRetry={() => void initCamera()}
          onImportFile={(f) => void handleImportFile(f)}
          onFlipCamera={flipCamera}
          onMirrorChange={(next) => {
            mirrorRef.current = next;
            setMirror(next);
          }}
        />
      ) : exportUI.kind !== "idle" ? (
        <ExportScreen
          state={exportUI}
          inIframe={inIframe}
          resultUrl={exportResultUrl}
          shareOk={exportShareOk}
          onSave={() => void handleSaveResult()}
          onShare={() => void handleShareResult()}
          onCancel={handleCancelExport}
          onRetry={() => void handleExport()}
          onBack={() => setExportUI({ kind: "idle" })}
        />
      ) : (
        <EditorScreen
          rec={rec}
          sourceKind={sourceKind}
          duration={duration}
          buffer={buffer}
          bufferError={bufferError}
          params={params}
          onParams={updateParams}
          trim={trim}
          onTrim={(s, e) => setTrim({ start: s, end: e })}
          playing={playing}
          playhead={playhead}
          onSeek={seekTo}
          onPlayingChange={(b) => {
            setPlaying(b);
            if (b) syncAudioState();
          }}
          onMeta={handleMeta}
          onMediaError={flash}
          proxy={proxy}
          onUnplayable={handleUnplayable}
          onNewRecording={handleNewRecording}
          onRetake={handleRetake}
          onImportFile={(f) => void handleImportFile(f)}
          onExport={() => void handleExport()}
          videoRef={videoRef}
          audioState={audioState}
          onEnableAudio={enableAudio}
          subscribed={subscribed}
          freeExportsLeft={freeLeft}
          onOpenPaywall={() => setPaywall(true)}
        />
      )}

    </>
  );
}

/** Short-lived object URL used only for the automatic post-export download. */
function resultUrlFor(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  // Give mobile download managers plenty of time to fetch large MP4 blobs.
  window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  return url;
}
