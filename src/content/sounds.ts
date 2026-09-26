/**
 * Recorded sound effects. Everything else in REMNANT is synthesized, but a
 * weapon never sounds real without a real recording, so these are the one
 * exception to the "no asset files" rule.
 *
 * Files live in `public/sfx/` (served next to the game). An id may list
 * several files; one is picked at random each time so repeated shots don't
 * sound identical. Any id without files — or whose files fail to load —
 * falls back to the synthesized version in `SoundManager`, so the game
 * always has sound. Sources and licences: `public/sfx/CREDITS.md`.
 */
export type SampleId =
  | "pistolShot"
  | "shotgunShot"
  | "rivetShot"
  | "dryFire"
  | "magOut"
  | "magIn"
  | "slideRack"
  | "shellInsert"
  | "pump"
  | "casing"
  | "shellCasing"
  | "impactConcrete"
  | "impactFlesh"
  | "ricochet";

export interface SampleDef {
  /** File names inside public/sfx/. */
  files: string[];
  /** Playback level (1 = as recorded). */
  gain: number;
  /** Random pitch variation, ± this fraction (0.04 = ±4%). */
  pitchJitter: number;
}

/** Every file is CC0 (public domain); sources are listed in public/sfx/CREDITS.md. */
export const SAMPLES: Partial<Record<SampleId, SampleDef>> = {
  pistolShot: { files: ["pistolShot_1.mp3", "pistolShot_2.mp3", "pistolShot_3.mp3"], gain: 0.95, pitchJitter: 0.04 },
  shotgunShot: { files: ["shotgunShot_1.mp3", "shotgunShot_2.mp3"], gain: 1.0, pitchJitter: 0.03 },
  rivetShot: { files: ["rivetShot_1.mp3", "rivetShot_2.mp3", "rivetShot_3.mp3"], gain: 0.55, pitchJitter: 0.05 },
  dryFire: { files: ["dryFire_1.mp3", "dryFire_2.mp3"], gain: 0.4, pitchJitter: 0.03 },
  magOut: { files: ["magOut_1.mp3", "magOut_2.mp3"], gain: 0.45, pitchJitter: 0.03 },
  magIn: { files: ["magIn_1.mp3"], gain: 0.5, pitchJitter: 0.03 },
  slideRack: { files: ["slideRack_1.mp3", "slideRack_2.mp3", "slideRack_3.mp3"], gain: 0.5, pitchJitter: 0.03 },
  shellInsert: { files: ["shellInsert_1.mp3"], gain: 0.45, pitchJitter: 0.05 },
  pump: { files: ["pump_1.mp3", "pump_2.mp3", "pump_3.mp3"], gain: 0.5, pitchJitter: 0.03 },
  casing: { files: ["casing_1.mp3", "casing_2.mp3", "casing_3.mp3"], gain: 0.22, pitchJitter: 0.08 },
  shellCasing: { files: ["shellCasing_1.mp3", "shellCasing_2.mp3"], gain: 0.28, pitchJitter: 0.06 },
  impactConcrete: {
    files: ["impactConcrete_1.mp3", "impactConcrete_2.mp3", "impactConcrete_3.mp3", "impactConcrete_4.mp3", "impactConcrete_5.mp3"],
    gain: 0.7,
    pitchJitter: 0.1,
  },
  ricochet: { files: ["ricochet_1.mp3", "ricochet_2.mp3", "ricochet_3.mp3"], gain: 0.3, pitchJitter: 0.08 },
  impactFlesh: { files: ["impactFlesh_1.mp3", "impactFlesh_2.mp3", "impactFlesh_3.mp3"], gain: 0.55, pitchJitter: 0.08 },
};
