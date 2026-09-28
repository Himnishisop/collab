import { useEffect, useState } from "react";
import type { ExportUI } from "../lib/types";
import { formatTime } from "../lib/format";
import { IconAlert, IconArrowLeft, IconDownload, IconRefreshCw, IconShare, IconSpinner, IconWave } from "./Icons";
import { ProgressBar } from "./ui";

type ExportViewState = Exclude<ExportUI, { kind: "idle" }>;

interface ExportScreenProps {
  state: ExportViewState;
  inIframe: boolean;
  resultUrl: string | null;
  shareOk: boolean;
  onSave: () => void;
  onShare: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onBack: () => void;
}

export default function ExportScreen({
  state,
  inIframe,
  resultUrl,
  shareOk,
  onSave,
  onShare,
  onCancel,
  onRetry,
  onBack,
}: ExportScreenProps) {
  const [now, setNow] = useState(() => Date.now());
  const busy = state.kind === "busy";

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [busy]);

  const elapsed = busy ? Math.max(0, (now - state.startedAt) / 1000) : 0;
  const eta = busy && state.pct > 3 ? Math.max(0, elapsed * ((100 - state.pct) / state.pct)) : 0;

  return (
    <main className="app-shell fixed inset-0 z-[80] flex items-center justify-center overflow-hidden px-4 py-4 sm:px-6">
      <section className="export-screen w-full max-w-md">
        <header className="mb-5 flex items-center justify-center gap-2">
          <IconWave className="text-signal" width={19} height={19} />
          <span className="font-display text-xs font-bold uppercase tracking-[0.2em] text-paper">Echo Voice Camera</span>
        </header>

        {state.kind === "busy" ? (
          <div className="export-panel animate-rise">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-signal/35 bg-signal/8 text-signal">
                <IconSpinner width={20} height={20} className="animate-spin" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-bold uppercase tracking-[0.12em] text-paper">Exporting video</p>
                <p className="mt-0.5 truncate text-xs text-dim">{state.note ?? stageName(state.stage)}</p>
              </div>
              <span className="tnum font-mono text-xl font-bold text-signal">{Math.round(state.pct)}%</span>
            </div>

            <div className="mb-2 h-3 overflow-hidden rounded-full border border-line bg-ink-950 p-[2px]">
              <div
                className="progress-shimmer h-full rounded-full transition-[width] duration-300"
                style={{ width: `${Math.max(3, Math.min(100, state.pct))}%` }}
              />
            </div>
            <ProgressBar pct={state.pct} />

            <div className="tnum mt-4 flex items-center justify-between font-mono text-[11px] text-faint">
              <span>Elapsed {formatTime(elapsed)}</span>
              <span>{eta > 0 ? `About ${formatTime(eta)} left` : "Estimating time…"}</span>
            </div>
            <p className="mt-5 text-center text-[11px] leading-relaxed text-dim">
              {inIframe
                ? "The MP4 download will start automatically when export finishes."
                : "The MP4 will be sent to your browser's Downloads folder automatically."}
            </p>
            <button type="button" onClick={onCancel} className="export-secondary mt-4 w-full">Cancel export</button>
          </div>
        ) : state.kind === "done" ? (
          <div className="export-panel animate-rise">
            <div className="mb-4 flex flex-col items-center text-center">
              <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-signal/35 bg-signal/8 text-signal">
                <IconWave width={26} height={26} />
              </span>
              <h1 className="font-display text-xl font-bold text-paper">Video exported</h1>
              <p className="mt-1 max-w-full truncate font-mono text-xs text-dim">{state.filename}</p>
              <p className="mt-1 text-[11px] text-faint">MP4 · H.264 / AAC · {Math.round(state.blob.size / 1024 / 1024 * 10) / 10} MB</p>
            </div>
            {/* The file itself. Long-pressing this player is the one save route
                that a sandboxed preview frame cannot block. */}
            {resultUrl && (
              <video
                src={resultUrl}
                controls
                playsInline
                preload="metadata"
                className="mb-3 max-h-44 w-full rounded-xl border border-line bg-black"
              />
            )}

            <p className="mb-3 rounded-xl border border-signal/30 bg-signal/8 px-3 py-2.5 text-center text-[12px] font-semibold leading-relaxed text-paper">
              Long-press the video above → “Download video”
            </p>

            <button type="button" onClick={onSave} className="export-primary w-full">
              <IconDownload width={17} height={17} /> Save to Downloads
            </button>

            <div className="mt-2 grid grid-cols-2 gap-2">
              {resultUrl && (
                <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="export-secondary w-full">
                  Open in tab
                </a>
              )}
              {shareOk ? (
                <button type="button" onClick={onShare} className="export-secondary w-full">
                  <IconShare width={15} height={15} /> Share
                </button>
              ) : (
                resultUrl && (
                  <a
                    href={resultUrl}
                    download={state.filename}
                    type={state.blob.type || "video/mp4"}
                    className="export-secondary w-full"
                  >
                    <IconDownload width={15} height={15} /> Download
                  </a>
                )
              )}
            </div>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-dim">
              {inIframe
                ? "This app is running inside a preview frame, which blocks automatic downloads. Long-pressing the player above always works. For normal one-tap downloads, open the app in a real browser tab."
                : "If the automatic download did not appear, tap Save to Downloads."}
            </p>
            <button type="button" onClick={onBack} className="mt-4 flex w-full items-center justify-center gap-2 py-2 text-xs font-semibold text-faint transition hover:text-paper">
              <IconArrowLeft width={14} height={14} /> Back to editor
            </button>
          </div>
        ) : (
          <div className="export-panel animate-rise">
            <div className="mb-4 flex flex-col items-center text-center">
              <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-mint/35 bg-mint/8 text-mint">
                <IconAlert width={27} height={27} />
              </span>
              <h1 className="font-display text-xl font-bold text-paper">Export could not finish</h1>
              <p className="mt-2 break-words text-sm leading-relaxed text-dim">{state.message}</p>
            </div>
            <button type="button" onClick={onRetry} className="export-primary w-full">
              <IconRefreshCw width={16} height={16} /> Try again
            </button>
            <button type="button" onClick={onBack} className="mt-3 flex w-full items-center justify-center gap-2 py-2 text-xs font-semibold text-faint transition hover:text-paper">
              <IconArrowLeft width={14} height={14} /> Back to editor
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function stageName(stage: string): string {
  if (stage === "audio") return "Rendering audio effects";
  if (stage === "engine") return "Preparing the encoder";
  if (stage === "fallback") return "Finishing export";
  return "Encoding and syncing video";
}