import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import WaveTrimmer from "./WaveTrimmer";
import { ProgressBar, Slider } from "./ui";
import {
  IconAlert,
  IconArrowLeft,
  IconFile,
  IconPause,
  IconPlay,
  IconRefreshCw,
  IconScissors,
  IconSliders,
  IconSpinner,
  IconWave,
  IconZap,
} from "./Icons";
import { computePeaks, type EffectParams } from "../lib/audio";
import { formatTime } from "../lib/format";

const REVERB_PRESETS = [
  { id: "small-room", label: "Small room", decay: 0.6 },
  { id: "studio", label: "Studio", decay: 1.2 },
  { id: "large-hall", label: "Large hall", decay: 2.6 },
  { id: "cathedral", label: "Cathedral", decay: 4.8 },
  { id: "vocal-plate", label: "Vocal plate", decay: 1.6 },
];

const ECHO_PRESETS = [
  { id: "slap", label: "Slap", time: 0.09, feedback: 0.15 },
  { id: "classic", label: "Classic", time: 0.35, feedback: 0.4 },
  { id: "canyon", label: "Canyon", time: 0.75, feedback: 0.55 },
  { id: "long-wash", label: "Long", time: 1.1, feedback: 0.65 },
  { id: "ambient", label: "Ambient", time: 1.6, feedback: 0.75 },
];

type EditTab = "reverb" | "echo" | "volume" | "trim";
const TABS: { id: EditTab; label: string; icon: typeof IconWave }[] = [
  { id: "reverb", label: "Reverb", icon: IconWave },
  { id: "echo", label: "Echo", icon: IconSliders },
  { id: "volume", label: "Volume", icon: IconZap },
  { id: "trim", label: "Trim", icon: IconScissors },
];

interface EditorScreenProps {
  rec: { url: string; blob: Blob; mime: string; mirrored: boolean };
  sourceKind: "recording" | "import";
  duration: number;
  buffer: AudioBuffer | null;
  bufferError: boolean;
  params: EffectParams;
  onParams: (p: EffectParams) => void;
  trim: { start: number; end: number };
  onTrim: (start: number, end: number) => void;
  playing: boolean;
  playhead: number;
  onSeek: (t: number) => void;
  onPlayingChange: (b: boolean) => void;
  onMeta: (el: HTMLVideoElement) => void;
  onMediaError: (message: string) => void;
  proxy: { status: "idle" | "busy" | "error"; pct: number; note: string };
  onUnplayable: () => void;
  onNewRecording: () => void;
  /** discard this clip and go straight back to recording */
  onRetake: () => void;
  onImportFile: (file: File) => void;
  onExport: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  audioState: "off" | "suspended" | "live";
  onEnableAudio: () => void;
  subscribed: boolean;
  freeExportsLeft: number;
  onOpenPaywall: () => void;
}

const MEDIA_ERRORS: Record<number, string> = {
  1: "Playback was stopped",
  2: "A video decode error occurred",
  3: "This video codec is not supported",
  4: "This video format is not supported",
};

export default function EditorScreen({
  rec,
  sourceKind,
  duration,
  buffer,
  bufferError,
  params,
  onParams,
  trim,
  onTrim,
  playing,
  playhead,
  onSeek,
  onPlayingChange,
  onMeta,
  onMediaError,
  proxy,
  onUnplayable,
  onNewRecording,
  onRetake,
  onImportFile,
  onExport,
  videoRef,
  audioState,
  onEnableAudio,
  subscribed,
  freeExportsLeft,
  onOpenPaywall,
}: EditorScreenProps) {
  const [tab, setTab] = useState<EditTab>("reverb");
  const [advanced, setAdvanced] = useState(false);
  const [nativeControls, setNativeControls] = useState(false);
  const [playError, setPlayError] = useState("");
  const importRef = useRef<HTMLInputElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const peaks = useMemo(() => (buffer ? computePeaks(buffer, 600) : null), [buffer]);
  const selected = trim.end - trim.start;
  const safeDuration = duration > 0 ? duration : 0;
  const volumePct = Math.round(params.volume * 100);
  const activeReverb = REVERB_PRESETS.find((p) => Math.abs(p.decay - params.reverbDecay) < 0.05)?.id;
  const activeEcho = ECHO_PRESETS.find(
    (p) => Math.abs(p.time - params.delayTime) < 0.02 && Math.abs(p.feedback - params.feedback) < 0.02,
  )?.id;

  useEffect(() => {
    setNativeControls(false);
    setPlayError("");
  }, [rec.url]);

  const setVideoRef = (el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    (videoRef as { current: HTMLVideoElement | null }).current = el;
  };

  const togglePreview = () => {
    const video = localVideoRef.current;
    if (!video) {
      setPlayError("Preview is still loading");
      return;
    }
    setPlayError("");
    if (!video.paused) {
      video.pause();
      return;
    }
    try {
      if (video.ended || (safeDuration > 0 && video.currentTime >= safeDuration - 0.08)) {
        video.currentTime = 0;
      }
    } catch {
      /* not seekable yet */
    }
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.then(() => onPlayingChange(true)).catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "Error";
        const message =
          name === "NotAllowedError"
            ? "Tap play again to allow playback"
            : name === "NotSupportedError" || name === "AbortError"
              ? "This format needs a playable copy"
              : `Playback error: ${name}`;
        setPlayError(message);
        setNativeControls(true);
        onMediaError(message);
      });
    }
  };

  const applyReverb = (id: string) => {
    const preset = REVERB_PRESETS.find((p) => p.id === id);
    if (preset) onParams({ ...params, reverbDecay: preset.decay, wet: Math.max(params.wet, 0.3) });
  };

  const applyEcho = (id: string) => {
    const preset = ECHO_PRESETS.find((p) => p.id === id);
    if (preset) onParams({ ...params, delayTime: preset.time, feedback: preset.feedback, wet: Math.max(params.wet, 0.3) });
  };

  return (
    <main className="app-shell echo-mobile-shell fixed inset-0 flex h-dvh flex-col overflow-hidden">
      <div className="echo-mobile-preview">
        {/* The video owns exactly the upper half of the phone viewport. */}
        <section className="echo-preview flex h-full min-h-0 flex-col bg-black">
          <div className="absolute inset-0 bg-black">
            <video
              key={rec.url}
              ref={setVideoRef}
              src={rec.url}
              playsInline
              preload="metadata"
              controls={nativeControls}
              onClick={togglePreview}
              // show the same angle the exported file will have
              style={{ transform: rec.mirrored ? "scaleX(-1)" : "none" }}
              className="h-full w-full bg-black object-contain"
              onLoadedMetadata={(event) => onMeta(event.currentTarget)}
              onDurationChange={(event) => onMeta(event.currentTarget)}
              onError={(event) => {
                const code = event.currentTarget.error?.code ?? 0;
                if (code === 3 || code === 4) {
                  setPlayError("Making a playable copy of this video…");
                  onMediaError("Making a playable copy of this video…");
                  onUnplayable();
                } else {
                  const message = MEDIA_ERRORS[code] ?? "This video could not be played";
                  setPlayError(message);
                  onMediaError(message);
                }
              }}
              onPlay={() => onPlayingChange(true)}
              onPause={() => onPlayingChange(false)}
              onEnded={() => onPlayingChange(false)}
            />

            {proxy.status !== "idle" && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-950/90 p-4">
                <div className="w-full max-w-sm text-center">
                  {proxy.status === "busy" ? (
                    <>
                      <IconSpinner className="mx-auto mb-3 animate-spin text-signal" width={27} height={27} />
                      <p className="font-display text-sm font-bold text-paper">Preparing video preview</p>
                      <p className="mt-1 text-xs text-dim">{proxy.note}</p>
                      <div className="mt-4"><ProgressBar pct={proxy.pct} /></div>
                      <p className="tnum mt-1 text-right font-mono text-[11px] text-signal">{Math.round(proxy.pct)}%</p>
                    </>
                  ) : (
                    <>
                      <IconAlert className="mx-auto mb-3 text-mint" width={25} height={25} />
                      <p className="font-display text-sm font-bold text-paper">Preview conversion failed</p>
                      <p className="mt-1 text-xs text-dim">{proxy.note}</p>
                      <button type="button" onClick={onUnplayable} className="export-primary mt-4 w-full">Try again</button>
                    </>
                  )}
                </div>
              </div>
            )}
            {/* Big centre play affordance: the picture alone gives no hint
                that it can be played, so show one until playback starts. */}
            {!playing && proxy.status === "idle" && !nativeControls && (
              <button
                type="button"
                onClick={togglePreview}
                aria-label="Play preview"
                className="echo-center-play"
              >
                <span className="echo-center-play-ring">
                  <IconPlay width={30} height={30} />
                </span>
                <span className="echo-center-play-label">Tap to preview</span>
              </button>
            )}

            {playError && proxy.status === "idle" && (
              <p className="absolute left-2 right-2 top-2 rounded-lg bg-ink-950/85 px-3 py-2 text-center text-xs text-mint">{playError}</p>
            )}
          </div>

          {/* Nothing but play, time and the scrubber lives over the picture. */}
          <div className="echo-transport absolute inset-x-0 bottom-0 z-10 px-3 pb-1.5 pt-1.5 sm:px-4">
            <div className="flex items-center gap-2.5">
              <button type="button" onClick={togglePreview} aria-label={playing ? "Pause preview" : "Play preview"} className="echo-play-button">
                {playing ? <IconPause width={17} height={17} /> : <IconPlay width={17} height={17} />}
              </button>
              <span className="tnum font-mono text-xs text-paper">
                {formatTime(playhead)} <span className="text-faint">/ {formatTime(duration)}</span>
              </span>
            </div>
            <input
              aria-label="Preview position"
              type="range"
              min={0}
              max={Math.max(0.1, duration)}
              step={0.01}
              value={Math.min(playhead, Math.max(duration, 0))}
              disabled={duration <= 0}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="echo-seek mt-1.5"
              style={{ "--seek": `${duration > 0 ? (playhead / duration) * 100 : 0}%` } as React.CSSProperties}
            />
          </div>
        </section>
      </div>

        {/* Four compact tool tabs and one clean export action. */}
        <section className="echo-mobile-controls echo-editor-panel flex min-h-0 flex-col">
          {/* source actions live here, never over the picture */}
          <div className="echo-source-bar shrink-0">
            <input
              ref={importRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportFile(file);
                event.target.value = "";
              }}
            />
            <button type="button" onClick={onRetake} className="echo-retake-action">
              <IconRefreshCw width={13} height={13} /> Retake
            </button>
            <button type="button" onClick={onNewRecording} className="echo-small-action">
              <IconArrowLeft width={13} height={13} /> Camera
            </button>
            <button type="button" onClick={() => importRef.current?.click()} className="echo-small-action">
              <IconFile width={13} height={13} /> Import
            </button>
            <span className="echo-source-tag">{sourceKind === "import" ? "Imported" : "Recorded"}</span>
            {audioState !== "live" && (
              <button type="button" onClick={onEnableAudio} className="echo-sound-button ml-auto">
                Enable sound
              </button>
            )}
          </div>

          <nav className="echo-tabs grid shrink-0 grid-cols-4 gap-1 p-1.5" aria-label="Editing tools">
            {TABS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setTab(item.id);
                    setAdvanced(false);
                  }}
                  className={active ? "echo-tab is-active" : "echo-tab"}
                >
                  <Icon width={17} height={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="echo-tool-content min-h-0 flex-1 px-3 py-3 sm:px-4">
            {tab === "reverb" && (
              <div className="echo-tool-body">
                <div className="echo-panel-heading">
                  <div><h2>Reverb</h2><p>Choose a space</p></div>
                  <span className="echo-readout">{params.reverbDecay.toFixed(1)}<small>s</small></span>
                </div>
                {!advanced && (
                  <div className="echo-preset-grid">
                    {REVERB_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={activeReverb === preset.id}
                        onClick={() => applyReverb(preset.id)}
                        className={activeReverb === preset.id ? "echo-preset is-selected" : "echo-preset"}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                )}
                <AdvancedToggle open={advanced} onToggle={() => setAdvanced((v) => !v)} />
                {advanced && (
                  <div className="echo-advanced-panel echo-knobs">
                    <RotaryKnob label="Room" min={0.2} max={6} step={0.1} value={params.reverbDecay} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => onParams({ ...params, reverbDecay: v })} />
                    <RotaryKnob label="Wet / dry" min={0} max={100} step={1} value={Math.round(params.wet * 100)} format={(v) => `${v}%`} onChange={(v) => onParams({ ...params, wet: v / 100 })} />
                  </div>
                )}
              </div>
            )}

            {tab === "echo" && (
              <div className="echo-tool-body">
                <div className="echo-panel-heading">
                  <div><h2>Echo</h2><p>Pick an echo style</p></div>
                  <span className="echo-readout">{params.delayTime.toFixed(2)}<small>s</small></span>
                </div>
                {!advanced && (
                  <div className="echo-preset-grid">
                    {ECHO_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={activeEcho === preset.id}
                        onClick={() => applyEcho(preset.id)}
                        className={activeEcho === preset.id ? "echo-preset is-selected" : "echo-preset"}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                )}
                <AdvancedToggle open={advanced} onToggle={() => setAdvanced((v) => !v)} />
                {advanced && (
                  <div className="echo-advanced-panel echo-knobs">
                    <RotaryKnob label="Time" min={0} max={2} step={0.01} value={params.delayTime} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => onParams({ ...params, delayTime: v })} />
                    <RotaryKnob label="Feedback" min={0} max={95} step={1} value={Math.round(params.feedback * 100)} format={(v) => `${v}%`} onChange={(v) => onParams({ ...params, feedback: v / 100 })} />
                    <RotaryKnob label="Wet / dry" min={0} max={100} step={1} value={Math.round(params.wet * 100)} format={(v) => `${v}%`} onChange={(v) => onParams({ ...params, wet: v / 100 })} />
                  </div>
                )}
              </div>
            )}

            {tab === "volume" && (
              <div className="echo-tool-body">
                <div className="echo-panel-heading">
                  <div><h2>Volume</h2><p>Raise or lower the recording</p></div>
                  <span className="echo-readout">{volumePct}<small>%</small></span>
                </div>
                <div className="echo-volume-control">
                  <Slider label="Output level" min={0} max={250} step={1} value={volumePct} format={(v) => `${v}%`} onChange={(v) => onParams({ ...params, volume: v / 100 })} />
                </div>
                <div className="echo-volume-marks"><span>0</span><span>100</span><span>200</span><span>250%</span></div>
              </div>
            )}

            {tab === "trim" && (
              <div className="echo-tool-body echo-trim-body">
                <div className="echo-panel-heading">
                  <div><h2>Trim</h2><p>Drag the ends to choose a range</p></div>
                  <span className="echo-readout">{Math.max(0, selected).toFixed(1)}<small>s</small></span>
                </div>
                <div className="echo-wave-wrap">
                  <WaveTrimmer
                    duration={duration}
                    peaks={peaks}
                    start={trim.start}
                    end={trim.end}
                    playhead={playhead}
                    disabled={duration <= 0}
                    onChange={onTrim}
                    onSeek={onSeek}
                  />
                </div>
                <div className="echo-trim-values">
                  <span><small>IN</small>{formatTime(trim.start)}</span>
                  <span><small>OUT</small>{formatTime(trim.end)}</span>
                  <button type="button" onClick={() => onTrim(0, duration)} disabled={duration <= 0}>Full clip</button>
                </div>
                {bufferError && <p className="echo-inline-note">Audio waveform unavailable; the video can still be exported.</p>}
              </div>
            )}
          </div>

          <footer className="echo-export-footer shrink-0">
            <button type="button" onClick={onExport} disabled={duration <= 0 || selected < 0.15} className="export-primary w-full">
              <span>Export video</span>
              <span className="font-mono text-[11px] font-medium opacity-70">{selected > 0 ? `${selected.toFixed(1)}s` : "—"}</span>
            </button>
            <p className="echo-plan-line">
              {subscribed ? (
                <span className="echo-plan-pro">Echo Pro · unlimited exports</span>
              ) : freeExportsLeft > 0 ? (
                <>
                  {freeExportsLeft} free export left ·{" "}
                  <button type="button" onClick={onOpenPaywall}>
                    See plans
                  </button>
                </>
              ) : (
                <>
                  Free export used ·{" "}
                  <button type="button" onClick={onOpenPaywall}>
                    Unlock unlimited
                  </button>
                </>
              )}
            </p>
            {proxy.status === "error" && <p className="mt-1.5 text-[10px] text-mint">{proxy.note}</p>}
          </footer>
        </section>
    </main>
  );
}

/**
 * Highlighted entry point to the manual knobs. The label is split into two
 * tones so the word "Studio" reads as the accent of the phrase.
 */
function AdvancedToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={open ? "echo-pro-toggle is-open" : "echo-pro-toggle"}
    >
      <span className="echo-pro-glow" aria-hidden="true" />
      <span className="echo-pro-text">
        <span className="echo-pro-title">
          <span className="echo-pro-word-a">Studio</span>
          <span className="echo-pro-word-b">Controls</span>
        </span>
        <span className="echo-pro-sub">
          {open ? "Every turn, a finer shade of sound" : "Turn the knobs, tune your own tone"}
        </span>
      </span>
      <span className="echo-pro-chevron" aria-hidden="true">
        {open ? "−" : "+"}
      </span>
    </button>
  );
}

function RotaryKnob({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const angle = -135 + ratio * 270;
  const setFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const raw = drag.current.value + ((drag.current.y - event.clientY) / 120) * (max - min);
    const snapped = min + Math.round((raw - min) / step) * step;
    onChange(Math.max(min, Math.min(max, Number(snapped.toFixed(3)))));
  };

  return (
    <div className="echo-knob-control">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        className="echo-knob-hit"
        onPointerDown={(event) => {
          event.preventDefault();
          drag.current = { y: event.clientY, value };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={setFromPointer}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") onChange(Math.min(max, value + step));
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") onChange(Math.max(min, value - step));
        }}
      >
        <span className="echo-knob-dial" style={{ "--knob-fill": `${ratio * 75}%` } as React.CSSProperties}>
          <span className="echo-knob-face">
            <span className="echo-knob-pointer" style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-12px)` }} />
          </span>
        </span>
      </div>
      <span className="echo-knob-label">{label}</span>
      <span className="echo-knob-value">{format(value)}</span>
    </div>
  );
}