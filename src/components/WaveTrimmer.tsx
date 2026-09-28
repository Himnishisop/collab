import { useEffect, useRef, useState } from "react";
import { formatTime } from "../lib/format";

interface WaveTrimmerProps {
  duration: number;
  peaks: Float32Array | null;
  start: number;
  end: number;
  playhead: number;
  disabled?: boolean;
  onChange: (start: number, end: number) => void;
  onSeek: (t: number) => void;
}

export default function WaveTrimmer({
  duration,
  peaks,
  start,
  end,
  playhead,
  disabled,
  onChange,
  onSeek,
}: WaveTrimmerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const dragRef = useRef<"start" | "end" | "scrub" | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const h = canvas.clientHeight || 112;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(h * dpr);
    const c = canvas.getContext("2d");
    if (!c) return;
    c.scale(dpr, dpr);
    c.clearRect(0, 0, width, h);
    const mid = h / 2;

    const drawBars = (color: string) => {
      c.fillStyle = color;
      if (peaks && peaks.length > 0) {
        const n = peaks.length;
        const step = 3;
        const count = Math.floor(width / step);
        for (let i = 0; i < count; i++) {
          const idx = Math.min(n - 1, Math.floor((i / count) * n));
          const p = peaks[idx];
          const bh = Math.max(1, p * (h - 10));
          c.fillRect(i * step, mid - bh / 2, 2, bh);
        }
      } else {
        c.fillRect(0, mid - 0.5, width, 1);
      }
    };

    drawBars("#5d709a");
    // the selected range lights up in neon so the trim is obvious at a glance
    if (duration > 0 && end > start) {
      const x0 = (start / duration) * width;
      const x1 = (end / duration) * width;
      c.save();
      c.beginPath();
      c.rect(x0, 0, Math.max(1, x1 - x0), h);
      c.clip();
      drawBars("#24f57c");
      c.restore();
    }
  }, [peaks, width, start, end, duration]);

  const timeFromEvent = (e: React.PointerEvent): number => {
    const el = containerRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || duration <= 0) return;
    const t = timeFromEvent(e);
    const handle = (e.target as HTMLElement).dataset.handle;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (handle === "start") {
      dragRef.current = "start";
      onChange(Math.min(t, end - 0.3), end);
    } else if (handle === "end") {
      dragRef.current = "end";
      onChange(start, Math.max(t, start + 0.3));
    } else {
      dragRef.current = "scrub";
      onSeek(t);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || disabled) return;
    const t = timeFromEvent(e);
    if (dragRef.current === "start") onChange(Math.min(t, end - 0.3), end);
    else if (dragRef.current === "end") onChange(start, Math.max(t, start + 0.3));
    else onSeek(t);
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const startPct = duration > 0 ? (start / duration) * 100 : 0;
  const endPct = duration > 0 ? (end / duration) * 100 : 100;
  const playPct = duration > 0 ? Math.min(100, Math.max(0, (playhead / duration) * 100)) : 0;

  return (
    <div>
      <div
        ref={containerRef}
        className={
          disabled
            ? "relative h-28 overflow-hidden rounded-xl border border-line bg-ink-850 opacity-50"
            : "relative h-28 cursor-text touch-none overflow-hidden rounded-xl border border-line bg-ink-850"
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-y-0 left-0 bg-ink-950/70" style={{ width: `${startPct}%` }} />
        <div className="absolute inset-y-0 right-0 bg-ink-950/70" style={{ width: `${100 - endPct}%` }} />
        <div className="absolute inset-y-0 w-px bg-amber/70" style={{ left: `${startPct}%` }} />
        <div className="absolute inset-y-0 w-px bg-amber/70" style={{ left: `${endPct}%` }} />
        <div className="pointer-events-none absolute inset-y-0 w-px bg-paper" style={{ left: `${playPct}%` }} />
        <div
          className="absolute inset-y-0 w-6 cursor-ew-resize"
          data-handle="start"
          style={{ left: `${startPct}%`, transform: "translateX(-50%)" }}
        >
          <div className="absolute left-1/2 top-0 h-full w-1.5 -translate-x-1/2 rounded-full bg-amber" />
        </div>
        <div
          className="absolute inset-y-0 w-6 cursor-ew-resize"
          data-handle="end"
          style={{ left: `${endPct}%`, transform: "translateX(-50%)" }}
        >
          <div className="absolute left-1/2 top-0 h-full w-1.5 -translate-x-1/2 rounded-full bg-amber" />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="tnum font-mono text-dim">
          start <span className="text-paper">{formatTime(start)}</span>
        </span>
        <span className="text-faint">{(end - start).toFixed(1)}s selected</span>
        <span className="tnum font-mono text-dim">
          end <span className="text-paper">{formatTime(end)}</span>
        </span>
      </div>
    </div>
  );
}
