export type ExportProfile = "fast" | "balanced" | "high";

export interface ClipItem {
  id: string;
  url: string;
  blob: Blob;
  mime: string;
  label: string;
  kind: "recording" | "import";
  seconds: number;
}

export interface RunInfo {
  command: string;
  multithread: boolean;
  threads: number;
  sampleRate: number;
  mode: string;
}

export interface ExportUIBusy {
  kind: "busy";
  stage: "audio" | "engine" | "video" | "fallback";
  pct: number;
  note?: string;
  startedAt: number;
  rangeSec: number;
  profile: ExportProfile;
}

export interface ExportUIDone {
  kind: "done";
  blob: Blob;
  ext: string;
  filename: string;
  via: "ffmpeg" | "fallback";
  ms: number;
  rangeSec: number;
  profile: ExportProfile;
  copyVideo: boolean;
  threads: number;
}

export type ExportUI =
  | { kind: "idle" }
  | ExportUIBusy
  | ExportUIDone
  | { kind: "error"; message: string };

export const PROFILE_META: Record<
  ExportProfile,
  { label: string; blurb: string; longSide: number | null; fps: number | null }
> = {
  fast: {
    label: "Fast",
    blurb: "720p-class • ultrafast preset • 30 fps cap — typically 4–8× quicker than re-encoding at source quality.",
    longSide: 1280,
    fps: 30,
  },
  balanced: {
    label: "Balanced",
    blurb: "Up to 1080p • veryfast preset • source frame rate — the default quality/speed trade-off.",
    longSide: 1920,
    fps: null,
  },
  high: {
    label: "High",
    blurb: "Full source resolution • medium preset — slowest, best detail for archival.",
    longSide: null,
    fps: null,
  },
};
