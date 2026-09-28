/**
 * Web Audio API engine: volume (GainNode) + reverb (ConvolverNode) + delay
 * (DelayNode + feedback GainNode) with wet/dry mix.
 *
 * The exact same graph builder is used for:
 *   1) live preview (routed to the speakers)
 *   2) offline rendering at 48 kHz for export (OfflineAudioContext)
 * Sharing one builder guarantees what you hear is what gets exported.
 */

export const EXPORT_SAMPLE_RATE = 48000;

export interface EffectParams {
  /** master gain, 1 = 100% */
  volume: number;
  /** delay time in seconds, 0..2 */
  delayTime: number;
  /** feedback amount, 0..0.95 */
  feedback: number;
  /** wet mix, 0..1 (0 = fully dry, 1 = fully wet) */
  wet: number;
  /** reverb decay / room size in seconds, 0.2..6 */
  reverbDecay: number;
}

/** True when the chain is a straight pass-through — lets export skip audio work. */
export function isNeutral(p: EffectParams): boolean {
  return Math.abs(p.volume - 1) < 0.005 && p.wet <= 0.005 && p.delayTime <= 0.005 && p.feedback <= 0.005;
}

export const DEFAULT_PARAMS: EffectParams = {
  volume: 1,
  delayTime: 0,
  feedback: 0,
  wet: 0,
  reverbDecay: 1.2,
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export interface BuiltGraph {
  input: GainNode;
  /** summed dry + wet bus (before dest) — tap this for level meters */
  output: GainNode;
  setParams: (p: EffectParams) => void;
  destroy: () => void;
}

let sharedCtx: AudioContext | null = null;

/**
 * One MediaElementAudioSourceNode per <audio>/<video>, for the life of that
 * element. Calling createMediaElementSource() a second time throws, and calling
 * it while the element is playing commonly stalls the decoder (picture freezes,
 * clock keeps running, audio dies). Always reuse.
 */
const mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

export function sourceForMedia(ctx: AudioContext, el: HTMLMediaElement): MediaElementAudioSourceNode {
  const existing = mediaSources.get(el);
  if (existing) return existing;
  const src = ctx.createMediaElementSource(el);
  mediaSources.set(el, src);
  return src;
}

/** Resumes without ever hanging: playback must not depend on this promise. */
export async function resumeContext(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === "running") return true;
  try {
    await Promise.race([
      ctx.resume(),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("resume timeout")), 1200)),
    ]);
  } catch {
    /* a suspended context must never block video playback */
  }
  return (ctx.state as string) === "running";
}

export async function getAudioContext(): Promise<AudioContext> {
  if (!sharedCtx || sharedCtx.state === "closed") {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    try {
      sharedCtx = new AC({ sampleRate: 48000, latencyHint: "interactive" });
    } catch {
      // several mobile browsers reject an explicit sample rate
      sharedCtx = new AC();
    }
  }
  await resumeContext(sharedCtx);
  return sharedCtx;
}

/** Synthesizes a stereo impulse response whose tail length = room size (decay seconds). */
export function createImpulseResponse(ctx: BaseAudioContext, decaySeconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(16, Math.floor(rate * clamp(decaySeconds, 0.05, 12)));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const white = Math.random() * 2 - 1;
      // one-pole lowpass => darker, smoother tail
      last += 0.32 * (white - last);
      data[i] = last * Math.pow(1 - t, 2.4);
    }
  }
  return buffer;
}

export function buildEffectGraph(ctx: BaseAudioContext, dest: AudioNode, initial: EffectParams): BuiltGraph {
  const input = ctx.createGain();
  const volume = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(2);
  const feedback = ctx.createGain();
  const convolver = ctx.createConvolver();

  let irDecay = -1;
  const applyIR = (decay: number) => {
    convolver.buffer = createImpulseResponse(ctx, decay);
    irDecay = decay;
  };

  const wire = (p: EffectParams) => {
    volume.gain.value = clamp(p.volume, 0, 4);
    dry.gain.value = clamp(1 - p.wet, 0, 1);
    wet.gain.value = clamp(p.wet, 0, 1);
    // min 1ms keeps the feedback loop stable at delayTime = 0
    delay.delayTime.value = Math.max(0.001, clamp(p.delayTime, 0, 2));
    feedback.gain.value = clamp(p.feedback, 0, 0.97);
    if (Math.abs(p.reverbDecay - irDecay) > 0.03) applyIR(p.reverbDecay);
  };
  wire(initial);

  // signal flow — dry and wet sum into one bus so the whole chain can be metered
  const output = ctx.createGain();
  input.connect(volume);
  volume.connect(dry);
  volume.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  volume.connect(convolver);
  convolver.connect(wet);
  dry.connect(output);
  wet.connect(output);
  output.connect(dest);

  const setParams = (p: EffectParams) => {
    const now = ctx.currentTime;
    volume.gain.setTargetAtTime(clamp(p.volume, 0, 4), now, 0.015);
    dry.gain.setTargetAtTime(clamp(1 - p.wet, 0, 1), now, 0.03);
    wet.gain.setTargetAtTime(clamp(p.wet, 0, 1), now, 0.03);
    delay.delayTime.setTargetAtTime(Math.max(0.001, clamp(p.delayTime, 0, 2)), now, 0.03);
    feedback.gain.setTargetAtTime(clamp(p.feedback, 0, 0.97), now, 0.03);
    if (Math.abs(p.reverbDecay - irDecay) > 0.03) applyIR(p.reverbDecay);
  };

  const destroy = () => {
    [input, volume, dry, wet, delay, feedback, convolver, output].forEach((n) => {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    });
  };

  return { input, output, setParams, destroy };
}

/**
 * Renders the trimmed segment of `source` through the effect chain in an
 * OfflineAudioContext locked to 48 kHz. Because BOTH the video trim (-ss/-to
 * in ffmpeg) and this audio trim use the exact same start/end values, and the
 * audio is resampled to the container rate, A/V stays perfectly in sync.
 */
export async function renderProcessedAudio(
  source: AudioBuffer,
  p: EffectParams,
  startSec: number,
  endSec: number,
): Promise<AudioBuffer> {
  const start = clamp(startSec, 0, Math.max(0, source.duration - 0.03));
  const end = clamp(endSec, start + 0.03, source.duration);
  const srcRate = source.sampleRate;
  const startFrame = Math.floor(start * srcRate);
  const frameCount = Math.max(1, Math.round((end - start) * srcRate));

  const trimmed = new AudioBuffer({
    numberOfChannels: source.numberOfChannels,
    length: frameCount,
    sampleRate: srcRate,
  });
  for (let c = 0; c < source.numberOfChannels; c++) {
    const full = source.getChannelData(c);
    trimmed.copyToChannel(full.subarray(startFrame, Math.min(full.length, startFrame + frameCount)), c);
  }

  const off = new OfflineAudioContext(2, Math.max(1, Math.ceil((end - start) * EXPORT_SAMPLE_RATE)), EXPORT_SAMPLE_RATE);
  const graph = buildEffectGraph(off, off.destination, p);
  const srcNode = off.createBufferSource();
  srcNode.buffer = trimmed;
  srcNode.connect(graph.input);
  srcNode.start(0);
  return off.startRendering();
}

/** AudioBuffer -> 16-bit PCM WAV blob (stereo, 48 kHz). */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytes = 44 + length * numCh * 2;
  const ab = new ArrayBuffer(bytes);
  const view = new DataView(ab);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, length * numCh * 2, true);

  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/** Downsamples channel 0 into `buckets` peak values for the trimmer waveform. */
export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const data = buffer.getChannelData(0);
  const peaks = new Float32Array(buckets);
  const blockSize = Math.max(1, Math.floor(data.length / buckets));
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * blockSize;
    const end = Math.min(data.length, start + blockSize);
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}
