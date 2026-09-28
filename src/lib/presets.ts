import type { EffectParams } from "./audio";

export interface FxPreset {
  id: string;
  name: string;
  hint: string;
  params: EffectParams;
}

/**
 * One-tap "looks" — each sets the whole chain at once (gain, delay, feedback,
 * wet mix and room size), the way a mixing console recall works.
 */
export const FX_PRESETS: FxPreset[] = [
  {
    id: "clean",
    name: "Clean",
    hint: "Straight through — no processing",
    params: { volume: 1, delayTime: 0, feedback: 0, wet: 0, reverbDecay: 1.2 },
  },
  {
    id: "podcast",
    name: "Podcast Voice",
    hint: "+35% gain, tight booth, barely-there room",
    params: { volume: 1.35, delayTime: 0, feedback: 0, wet: 0.12, reverbDecay: 0.4 },
  },
  {
    id: "vlog",
    name: "Vlog Bright",
    hint: "Punchy level with a small slap for presence",
    params: { volume: 1.25, delayTime: 0.09, feedback: 0.14, wet: 0.18, reverbDecay: 0.7 },
  },
  {
    id: "cinema",
    name: "Cinema Hall",
    hint: "Wide hall tail, dry signal kept forward",
    params: { volume: 1.15, delayTime: 0.22, feedback: 0.28, wet: 0.42, reverbDecay: 2.6 },
  },
  {
    id: "cave",
    name: "Cave Echo",
    hint: "Long feedback delay, heavy wet mix",
    params: { volume: 1.1, delayTime: 0.62, feedback: 0.62, wet: 0.66, reverbDecay: 3.4 },
  },
  {
    id: "dream",
    name: "Dream Wash",
    hint: "Cathedral space, slow wash, softened level",
    params: { volume: 0.95, delayTime: 1.15, feedback: 0.7, wet: 0.78, reverbDecay: 4.8 },
  },
];

export interface Shortcut {
  keys: string;
  action: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: "Space", action: "Play / pause" },
  { keys: "← →", action: "Nudge playhead 1s" },
  { keys: "[ ]", action: "Set trim in / out at playhead" },
  { keys: "B", action: "Hold to bypass effects (A/B)" },
  { keys: "E", action: "Export" },
];
