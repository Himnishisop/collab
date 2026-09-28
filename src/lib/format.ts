export function formatTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function stampFilename(ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `recedit-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}.${ext}`;
}

/**
 * ffmpeg.wasm `readFile()` returns `string | Uint8Array`. The Uint8Array may be
 * backed by a SharedArrayBuffer, which the Blob constructor rejects in some
 * engines — so always copy into a plain ArrayBuffer first. This was the reason
 * an "exported" file could end up empty/un-downloadable.
 */
export function dataToBlob(data: string | Uint8Array, type: string): Blob {
  if (typeof data === "string") return new Blob([data], { type });
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Blob([copy.buffer as ArrayBuffer], { type });
}

/** Are we running inside an iframe (LM Arena preview)? Downloads can be sandboxed. */
export function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Start a browser-managed download. The browser chooses its configured Downloads
 * folder; web pages cannot silently choose an arbitrary device path.
 */
export function triggerDownload(url: string, filename: string): boolean {
  const a = document.createElement("a");
  if (!("download" in a)) return false;
  a.href = url;
  a.download = filename;
  a.rel = "noopener noreferrer";
  // Keep it in the document and rendered (off-screen). Some mobile browsers
  // ignore clicks on display:none download anchors.
  a.style.position = "fixed";
  a.style.left = "-10000px";
  a.style.top = "0";
  a.style.width = "1px";
  a.style.height = "1px";
  a.style.opacity = "0.01";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 1000);
  return true;
}

export function openInNewTab(url: string): boolean {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  return !!w;
}

type ShareCapableNavigator = Navigator & {
  canShare?: (data: { files: File[] }) => boolean;
};

export function shareSupported(blob: Blob, filename: string): boolean {
  const nav = navigator as ShareCapableNavigator;
  if (typeof nav.canShare !== "function" || typeof File === "undefined") return false;
  try {
    return nav.canShare({ files: [new File([blob], filename, { type: blob.type })] });
  } catch {
    return false;
  }
}

/** Phone-first save: share sheet (Files / Drive / Photos / WhatsApp). */
export async function shareBlob(blob: Blob, filename: string): Promise<boolean> {
  const nav = navigator as ShareCapableNavigator;
  try {
    const file = new File([blob], filename, { type: blob.type });
    await nav.share?.({ files: [file], title: filename });
    return true;
  } catch {
    return false;
  }
}

interface WritableLike {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}
interface SaveHandleLike {
  createWritable: () => Promise<WritableLike>;
}
type PickerWindow = Window & {
  showSaveFilePicker?: (opts: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<SaveHandleLike>;
};

export type SaveMethod = "share" | "picker" | "download" | "savepage" | "newtab" | "failed";

export const SAVE_METHOD_HINT: Record<SaveMethod, string> = {
  share: "Choose “Save to Files” or “Download” in the share sheet",
  picker: "Saved — check the folder you selected",
  download: "Download started — look in your Downloads folder",
  savepage: "A save page opened in a new tab — tap the green button there",
  newtab: "Opened in a new tab — long-press the video and choose “Download video”",
  failed: "This browser blocked every save route. Open the app in a normal browser tab.",
};

/**
 * Opens a plain top-level page that hosts the file and a real download link.
 *
 * A sandboxed preview frame can block `<a download>` and the Web Share sheet,
 * but `window.open` creates a normal browsing context that is not sandboxed, so
 * the download inside that page is allowed.
 */
function openSavePage(blob: Blob, filename: string): boolean {
  const tab = window.open("", "_blank");
  if (!tab) return false;
  const url = URL.createObjectURL(blob);
  const size = (blob.size / 1024 / 1024).toFixed(1);
  const safeName = filename.replace(/[<>&"]/g, "");
  tab.document.write(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Save ${safeName}</title></head>` +
      `<body style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#04070f;color:#e9eef7;font-family:system-ui,sans-serif;padding:24px;text-align:center">` +
      `<div style="font-size:15px;font-weight:700">${safeName}</div>` +
      `<div style="font-size:12px;opacity:.65">MP4 · ${size} MB</div>` +
      `<video src="${url}" controls playsinline style="max-width:100%;max-height:45vh;border-radius:12px;background:#000"></video>` +
      `<a id="dl" href="${url}" download="${safeName}" style="display:block;width:100%;max-width:320px;padding:16px;border-radius:12px;background:#24f57c;color:#04070f;font-size:15px;font-weight:800;text-decoration:none">Download video</a>` +
      `<div style="font-size:12px;opacity:.6;max-width:320px;line-height:1.5">If the download does not start, long-press the video above and choose “Download video”.</div>` +
      `<script>setTimeout(function(){try{document.getElementById("dl").click()}catch(e){}},400)<\/script>` +
      `</body></html>`,
  );
  tab.document.close();
  window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  return true;
}

/**
 * Saves using the best route this device actually allows.
 *
 * Order matters: the OS share sheet is attempted first because it is the only
 * route that reliably reaches the Files/Downloads picker on phones, and it must
 * be invoked while the tap's transient activation is still valid — any `await`
 * before it (such as a file-picker attempt) can invalidate that activation.
 */
export async function saveBlobSmart(blob: Blob, filename: string): Promise<SaveMethod> {
  if (shareSupported(blob, filename)) {
    const shared = await shareBlob(blob, filename);
    if (shared) return "share";
  }

  const win = window as PickerWindow;
  if (typeof win.showSaveFilePicker === "function") {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Video", accept: { [blob.type || "video/mp4"]: [".mp4", ".webm"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "picker";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "failed";
      // otherwise fall through to the next route
    }
  }

  // An anchor click inside a sandboxed frame is discarded silently and still
  // "succeeds", so inside a frame go straight to a real top-level save page.
  if (!isInIframe()) {
    const url = URL.createObjectURL(blob);
    if (triggerDownload(url, filename)) {
      window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
      return "download";
    }
    URL.revokeObjectURL(url);
  }

  // Last resorts run outside this (possibly sandboxed) frame.
  if (openSavePage(blob, filename)) return "savepage";

  const fallbackUrl = URL.createObjectURL(blob);
  if (openInNewTab(fallbackUrl)) return "newtab";
  URL.revokeObjectURL(fallbackUrl);
  return "failed";
}
