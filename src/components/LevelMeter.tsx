import { useEffect, useRef } from "react";

interface LevelMeterProps {
  analyser: AnalyserNode | null;
  bars?: number;
  height?: number;
  /** animate a gentle idle wave when there is no signal yet */
  idle?: boolean;
  className?: string;
}

/**
 * Living spectrum meter driven by an AnalyserNode. When no analyser is
 * attached it draws a slow idle wave so the UI never looks frozen.
 */
export default function LevelMeter({ analyser, bars = 32, height = 40, idle = true, className }: LevelMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(analyser);
  analyserRef.current = analyser;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    let raf = 0;
    let phase = 0;
    const data = new Uint8Array(Math.max(16, bars));
    const smooth = new Float32Array(bars);

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    };

    const draw = () => {
      const { w, h } = resize();
      ctx2d.clearRect(0, 0, w, h);
      const an = analyserRef.current;
      phase += 0.045;

      if (an && an.fftSize >= bars * 2) {
        an.getByteFrequencyData(data);
      }

      const gap = 2;
      const bw = Math.max(1.5, (w - gap * (bars - 1)) / bars);

      for (let i = 0; i < bars; i++) {
        let target: number;
        if (an) {
          // log-ish bin mapping so low/mid energy is visible
          const idx = Math.floor(Math.pow(i / bars, 1.4) * (data.length * 0.72));
          target = (data[Math.min(data.length - 1, idx)] ?? 0) / 255;
        } else {
          target = idle ? (Math.sin(phase + i * 0.45) * 0.5 + 0.5) * 0.16 : 0;
        }
        smooth[i] += (target - smooth[i]) * (target > smooth[i] ? 0.55 : 0.12);
        const v = Math.max(0.03, smooth[i]);
        const bh = v * (h - 4);
        const x = i * (bw + gap);
        const y = h - bh;

        const hot = v > 0.72;
        ctx2d.fillStyle = hot ? "#57e6ff" : v > 0.42 ? "#24f57c" : "rgba(157,176,201,0.5)";
        const r = Math.min(bw / 2, 2);
        if (typeof ctx2d.roundRect === "function") {
          ctx2d.beginPath();
          ctx2d.roundRect(x, y, bw, bh, r);
          ctx2d.fill();
        } else {
          ctx2d.fillRect(x, y, bw, bh);
        }
      }
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [bars, height, idle]);

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", height }} aria-hidden="true" />;
}
