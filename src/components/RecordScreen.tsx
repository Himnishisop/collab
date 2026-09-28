import { useEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";
import { formatTime } from "../lib/format";
import { IconAlert, IconCameraSwitch, IconFile, IconSpinner } from "./Icons";
import {
  QUALITY_OPTIONS,
  streamResolutionLabel,
  type CameraFacing,
  type CaptureQuality,
} from "../lib/recorder";

interface RecordScreenProps {
  camState: "starting" | "live" | "error";
  camError: string;
  stream: MediaStream | null;
  isRecording: boolean;
  elapsed: number;
  analyser: AnalyserNode | null;
  importing: boolean;
  cameraFacing: CameraFacing;
  /** true = save the selfie/mirrored view, false = save the true (un-flipped) view */
  mirror: boolean;
  quality: CaptureQuality;
  /** only the modes this device's sensor can actually deliver */
  availableQualities: CaptureQuality[];
  onToggleRecord: () => void;
  onRetry: () => void;
  onImportFile: (file: File) => void;
  onFlipCamera: () => void;
  onMirrorChange: (mirror: boolean) => void;
  onQualityChange: (quality: CaptureQuality) => void;
}

/**
 * Clean full-screen viewfinder: nothing is drawn over the picture except the
 * brand, the top-bar actions and the record control. No meters, no status
 * chips — those live in the editor, after the recording stops.
 */
export default function RecordScreen({
  camState,
  camError,
  stream,
  isRecording,
  elapsed,
  importing,
  cameraFacing,
  mirror,
  quality,
  availableQualities,
  onToggleRecord,
  onRetry,
  onImportFile,
  onFlipCamera,
  onMirrorChange,
  onQualityChange,
}: RecordScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const live = camState === "live";
  // Fit = the whole sensor frame, nothing cropped or zoomed.
  // Fill = covers the screen, cropping the sides.
  const [fill, setFill] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const qualityChoices = QUALITY_OPTIONS.filter((o) => availableQualities.includes(o.id));
  const activeQuality = QUALITY_OPTIONS.find((o) => o.id === quality) ?? QUALITY_OPTIONS[0];
  const actualResolution = streamResolutionLabel(stream);

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) el.srcObject = stream;
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink-950">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={cn("absolute inset-0 h-full w-full", fill ? "object-cover" : "object-contain")}
        // The preview always shows exactly what will be saved, so the
        // recorded file can never surprise the user by being flipped.
        style={{ transform: mirror ? "scaleX(-1)" : "none" }}
      />

      {/* top bar — the only chrome over the picture */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-3 pb-8 pt-[max(0.7rem,env(safe-area-inset-top))]">
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full bg-signal", isRecording && "animate-rec-dot")} />
          <span className="hidden font-display text-base font-bold tracking-[0.04em] text-paper drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)] min-[420px]:inline">
            Echo <span className="text-signal">Voice</span> Camera
          </span>
        </div>

        <div className="echo-cam-actions flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = "";
            }}
          />
          {/* Both capture angles, always visible so the choice is obvious. */}
          <div className="echo-mirror-seg" role="group" aria-label="Recorded image angle">
            <button
              type="button"
              onClick={() => onMirrorChange(true)}
              aria-pressed={mirror}
              className={mirror ? "is-on" : undefined}
            >
              Mirror
            </button>
            <button
              type="button"
              onClick={() => onMirrorChange(false)}
              aria-pressed={!mirror}
              className={!mirror ? "is-on" : undefined}
            >
              Normal
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowQuality((s) => !s)}
            disabled={!live || isRecording}
            aria-expanded={showQuality}
            title={isRecording ? "Stop recording to change quality" : "Capture resolution"}
            className="rounded-full border border-line bg-ink-900/80 px-3 py-1.5 font-display text-[10.5px] font-bold uppercase tracking-[0.14em] text-paper backdrop-blur-sm transition hover:border-signal/60 hover:text-signal active:scale-95 disabled:opacity-40"
          >
            {activeQuality.label}
          </button>
          <button
            type="button"
            onClick={() => setFill((f) => !f)}
            aria-pressed={fill}
            className="rounded-full border border-line bg-ink-900/80 px-3 py-1.5 font-display text-[10.5px] font-bold uppercase tracking-[0.14em] text-paper backdrop-blur-sm transition hover:border-signal/60 hover:text-signal active:scale-95"
          >
            {fill ? "Fill" : "Fit"}
          </button>
          <button
            type="button"
            onClick={onFlipCamera}
            disabled={!live || isRecording}
            aria-label={cameraFacing === "user" ? "Switch to rear camera" : "Switch to front camera"}
            title={isRecording ? "Stop recording to switch cameras" : "Switch camera"}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-ink-900/80 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-paper backdrop-blur-sm transition hover:border-mint/60 hover:text-mint active:scale-95 disabled:opacity-40"
          >
            <IconCameraSwitch width={15} height={15} />
            {cameraFacing === "user" ? "Rear" : "Front"}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-ink-900/80 px-3 py-1.5 text-xs font-semibold text-paper backdrop-blur-sm transition hover:border-mint/60 hover:text-mint active:scale-95"
          >
            <IconFile width={15} height={15} />
            Import
          </button>
        </div>
      </div>

      {/* resolution picker — only the modes this sensor really supports */}
      {showQuality && live && !isRecording && (
        <>
          <button
            type="button"
            aria-label="Close resolution picker"
            onClick={() => setShowQuality(false)}
            className="absolute inset-0 z-20 cursor-default bg-ink-950/45"
          />
          <div className="echo-quality-menu">
            <p className="echo-quality-head">
              Capture resolution
              {actualResolution && <span>now {actualResolution}</span>}
            </p>
            {qualityChoices.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === quality}
                onClick={() => {
                  onQualityChange(option.id);
                  setShowQuality(false);
                }}
                className={option.id === quality ? "echo-quality-row is-on" : "echo-quality-row"}
              >
                <span className="echo-quality-name">{option.label}</span>
                <span className="echo-quality-note">{option.note}</span>
              </button>
            ))}
            <p className="echo-quality-foot">Higher resolution means larger files and slower export.</p>
          </div>
        </>
      )}

      {/* recording timer — only while recording */}
      {isRecording && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(4.2rem,calc(env(safe-area-inset-top)+3.4rem))] flex justify-center">
          <div className="flex items-center gap-2.5 rounded-full bg-ink-950/72 px-4 py-2 backdrop-blur-sm">
            <span className="animate-rec-dot h-2.5 w-2.5 rounded-full bg-signal shadow-[0_0_12px_2px_rgba(36,245,124,0.8)]" />
            <span className="tnum font-display text-3xl font-bold leading-none text-paper neon-text">
              {formatTime(elapsed)}
            </span>
          </div>
        </div>
      )}

      {/* bottom — record control only */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-ink-950/85 via-ink-950/35 to-transparent px-4 pb-[max(1.6rem,env(safe-area-inset-bottom))] pt-14">
        <button
          type="button"
          onClick={onToggleRecord}
          disabled={!live}
          aria-pressed={isRecording}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          className={cn(
            "group relative flex h-[86px] w-[86px] items-center justify-center rounded-full transition-transform duration-150 active:scale-95 disabled:opacity-40",
            isRecording && "animate-halo rounded-full",
          )}
        >
          <span className="pointer-events-none absolute inset-0 rounded-full border-[3px] border-signal/55 transition-transform duration-200 group-hover:scale-[1.07]" />
          <span
            className={cn(
              "transition-all duration-200",
              isRecording
                ? "h-9 w-9 rounded-[10px] bg-paper"
                : "h-[68px] w-[68px] rounded-full bg-signal shadow-[0_0_34px_-4px_rgba(36,245,124,0.85)] group-hover:bg-signal-soft",
            )}
          />
        </button>
        <p className="text-center text-[11.5px] font-medium text-dim">
          {isRecording
            ? "Tap again to stop — the editor opens right after"
            : mirror
              ? "Tap to record · Mirror — saved the way you see yourself"
              : "Tap to record · Normal — saved the way others see you"}
        </p>
      </div>

      {/* states */}
      {camState === "starting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-950/88">
          <IconSpinner className="animate-spin text-signal" width={30} height={30} />
          <p className="font-display text-sm uppercase tracking-[0.18em] text-dim">Starting camera…</p>
        </div>
      )}

      {importing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-950/88">
          <IconSpinner className="animate-spin text-mint" width={30} height={30} />
          <p className="font-display text-sm uppercase tracking-[0.18em] text-dim">Opening your video…</p>
        </div>
      )}

      {camState === "error" && !importing && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-950/94 p-6">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-mint/40 bg-mint/10 text-mint">
              <IconAlert width={22} height={22} />
            </span>
            <p className="text-sm leading-relaxed text-paper">{camError}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 rounded-xl bg-signal px-5 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-signal-soft active:scale-[0.97]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs font-medium text-dim underline-offset-2 transition hover:text-mint hover:underline"
            >
              or import a video from your phone
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
