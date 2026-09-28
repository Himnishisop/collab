export function pickMimeType(): string {
  // Safari/iOS records natively to MP4 (H.264 + AAC), which also lets the
  // exporter stream-copy the video instead of re-encoding it in WASM.
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* noop */
    }
  }
  return "";
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2,
  sampleRate: 48000,
};

export type CameraFacing = "user" | "environment";

/** `auto` keeps the device default; the rest target a long-side pixel count. */
export type CaptureQuality = "auto" | "480" | "720" | "1080" | "1440" | "2160";

export interface QualityOption {
  id: CaptureQuality;
  label: string;
  note: string;
  /** long side in pixels; null = leave it to the device */
  longSide: number | null;
}

export const QUALITY_OPTIONS: QualityOption[] = [
  { id: "auto", label: "Auto", note: "Device default", longSide: null },
  { id: "480", label: "480p", note: "Smallest files", longSide: 854 },
  { id: "720", label: "720p", note: "HD · light", longSide: 1280 },
  { id: "1080", label: "1080p", note: "Full HD", longSide: 1920 },
  { id: "1440", label: "2K", note: "Quad HD", longSide: 2560 },
  { id: "2160", label: "4K", note: "Ultra HD · heavy", longSide: 3840 },
];

/**
 * Asks the camera which of our presets it can actually deliver.
 *
 * `getCapabilities()` reports the sensor's real maximum, so we only ever offer
 * modes the hardware supports instead of letting the browser silently upscale
 * or reject a request. Falls back to the current frame size when capabilities
 * are unavailable (notably older Safari).
 */
export function supportedQualities(stream: MediaStream | null): CaptureQuality[] {
  const track = stream?.getVideoTracks()[0];
  if (!track) return ["auto"];

  let maxLong = 0;
  try {
    const caps = track.getCapabilities?.();
    const capMax = Math.max(Number(caps?.width?.max ?? 0), Number(caps?.height?.max ?? 0));
    if (Number.isFinite(capMax)) maxLong = capMax;
  } catch {
    /* capabilities not exposed on this browser */
  }
  if (maxLong <= 0) {
    const s = track.getSettings();
    maxLong = Math.max(Number(s.width ?? 0), Number(s.height ?? 0));
  }
  // Nothing reliable to go on — offer a safe, widely supported set.
  if (maxLong <= 0) return ["auto", "480", "720", "1080"];

  // 5% slack: devices often report 1920×1079-style numbers.
  return QUALITY_OPTIONS.filter((o) => o.longSide === null || o.longSide <= maxLong * 1.05).map((o) => o.id);
}

/** Actual capture size of a live stream, e.g. "1920×1080". */
export function streamResolutionLabel(stream: MediaStream | null): string {
  const track = stream?.getVideoTracks()[0];
  if (!track) return "";
  const { width, height } = track.getSettings();
  if (!width || !height) return "";
  return `${width}×${height}`;
}

/**
 * Starts the camera at the requested quality.
 *
 * The long side is mapped onto width/height according to the device's current
 * orientation: asking for a landscape frame on a portrait phone makes the
 * hardware crop the sensor, which shows up as an unwanted zoom. `ideal` (never
 * `exact`) is used so a device that cannot hit the target degrades gracefully
 * instead of throwing.
 */
export async function startCamera(
  facing: CameraFacing = "user",
  quality: CaptureQuality = "auto",
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("unsupported");
  }

  const target = QUALITY_OPTIONS.find((o) => o.id === quality)?.longSide ?? null;
  const portrait = window.innerHeight >= window.innerWidth;
  const video: MediaTrackConstraints = { facingMode: { ideal: facing } };

  if (target) {
    const shortSide = Math.round((target * 9) / 16);
    video.width = { ideal: portrait ? shortSide : target };
    video.height = { ideal: portrait ? target : shortSide };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      // Drop the size request entirely rather than failing to open the camera.
      stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: { facingMode: facing } });
    } else {
      throw e;
    }
  }
  resetZoom(stream);
  return stream;
}

/**
 * Picks a video bitrate that matches the frame size. A fixed rate would starve
 * a 4K capture and waste space on a 480p one.
 */
export function bitrateForStream(stream: MediaStream | null): number {
  const track = stream?.getVideoTracks()[0];
  const s = track?.getSettings();
  const longSide = Math.max(Number(s?.width ?? 0), Number(s?.height ?? 0));
  if (longSide >= 3400) return 45_000_000; // 4K
  if (longSide >= 2400) return 24_000_000; // 2K
  if (longSide >= 1700) return 12_000_000; // 1080p
  if (longSide >= 1100) return 6_000_000; // 720p
  return 3_000_000; // 480p and below
}

/** Undo any digital zoom the device applied on its own (best effort). */
function resetZoom(stream: MediaStream): void {
  for (const track of stream.getVideoTracks()) {
    try {
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & {
        zoom?: { min?: number; max?: number };
      };
      if (caps?.zoom && typeof caps.zoom.min === "number") {
        const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
        if ((settings.zoom ?? caps.zoom.min) !== caps.zoom.min) {
          void track
            .applyConstraints({ advanced: [{ zoom: caps.zoom.min }] } as unknown as MediaTrackConstraints)
            .catch(() => {});
        }
      }
    } catch {
      /* zoom not controllable on this device */
    }
  }
}

export function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera and microphone permission was denied. Allow access for this site in your browser settings, then try again.";
  }
  if (name === "NotFoundError") {
    return "No camera or microphone was found. Check that a device is connected.";
  }
  if (name === "NotReadableError") {
    return "The camera is already in use by another app. Close it and try again.";
  }
  if (err instanceof Error && err.message === "unsupported") {
    return "This browser cannot record from a camera (a modern browser over HTTPS is required). You can still import a video from your phone.";
  }
  return "The camera could not be started. Please try again.";
}
