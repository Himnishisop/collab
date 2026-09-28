import { buildEffectGraph, type EffectParams } from "./audio";
import { pickMimeType } from "./recorder";

interface FallbackOptions {
  videoEl: HTMLVideoElement;
  audioCtx: AudioContext;
  elementSource: MediaElementAudioSourceNode;
  params: EffectParams;
  startSec: number;
  endSec: number;
  /** the fallback records in real time, so progress is wall-clock based */
  onProgress?: (pct: number, elapsedSec: number) => void;
}

/**
 * Last-resort export when the ffmpeg.wasm engine cannot load (offline / blocked
 * CDN): re-records the trimmed segment in real time, combining the element's
 * video track with the processed audio track. Both tracks are driven by the
 * same element clock, so short clips stay in sync.
 */
export function exportWithMediaRecorder(opts: FallbackOptions): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    void (async () => {
      let ticker = 0;
      try {
        const { videoEl, audioCtx, elementSource, params, startSec, endSec, onProgress } = opts;
        await audioCtx.resume();

        const streamDest = audioCtx.createMediaStreamDestination();
        const graph = buildEffectGraph(audioCtx, streamDest, params);
        elementSource.connect(graph.input);

        const cap = (videoEl as unknown as { captureStream?: () => MediaStream }).captureStream;
        const vStream = cap?.call(videoEl);
        const vTrack = vStream?.getVideoTracks()[0];
        if (!vTrack) {
          elementSource.disconnect(graph.input);
          graph.destroy();
          streamDest.stream.getTracks().forEach((t) => t.stop());
          throw new Error("captureStream unsupported");
        }

        const mixed = new MediaStream([vTrack, ...streamDest.stream.getAudioTracks()]);
        const mime = pickMimeType();
        const rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
        const chunks: BlobPart[] = [];
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        const range = Math.max(0.1, endSec - startSec);
        let stopped = false;
        let playStartedAt = 0;

        const cleanup = () => {
          videoEl.removeEventListener("timeupdate", onTimeUpdate);
          videoEl.removeEventListener("ended", onEnded);
          window.clearTimeout(timer);
          window.clearInterval(ticker);
        };
        const finish = () => {
          if (stopped) return;
          stopped = true;
          cleanup();
          onProgress?.(100, range);
          try {
            rec.stop();
          } catch {
            /* noop */
          }
        };
        const onTimeUpdate = () => {
          if (videoEl.currentTime >= endSec - 0.06) finish();
        };
        const onEnded = () => finish();
        const timer = window.setTimeout(finish, range * 1000 + 2500);

        // real progress: this path runs at 1× speed, so wall clock IS progress
        ticker = window.setInterval(() => {
          if (!playStartedAt) return;
          const elapsed = (performance.now() - playStartedAt) / 1000;
          onProgress?.(Math.min(99, (elapsed / range) * 100), elapsed);
        }, 220);

        rec.onerror = () => {
          cleanup();
          elementSource.disconnect(graph.input);
          graph.destroy();
          streamDest.stream.getTracks().forEach((t) => t.stop());
          reject(new Error("media recorder error"));
        };
        rec.onstop = () => {
          cleanup();
          elementSource.disconnect(graph.input);
          graph.destroy();
          streamDest.stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: rec.mimeType || "video/webm" }));
        };

        videoEl.addEventListener("timeupdate", onTimeUpdate);
        videoEl.addEventListener("ended", onEnded);

        // seek first, wait for it to land, arm the recorder, then play
        await new Promise<void>((res) => {
          if (Math.abs(videoEl.currentTime - startSec) < 0.05) return res();
          const onSeeked = () => {
            videoEl.removeEventListener("seeked", onSeeked);
            res();
          };
          videoEl.addEventListener("seeked", onSeeked);
          videoEl.currentTime = startSec;
          window.setTimeout(() => {
            videoEl.removeEventListener("seeked", onSeeked);
            res();
          }, 1200);
        });
        rec.start(100);
        await videoEl.play();
        playStartedAt = performance.now();
        onProgress?.(1, 0);
      } catch (e) {
        window.clearInterval(ticker);
        reject(e);
      }
    })();
  });
}
