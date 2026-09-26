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
  | "ricochet"
  | "stepWalk"
  | "stepRun"
  | "splash"
  | "creatureIdle"
  | "creatureAlert"
  | "creatureWindup"
  | "creatureHurt"
  | "creatureDeath"
  | "ratVoice"
  | "door"
  | "flashlight"
  | "ammoPickup"
  | "playerHurt";

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
  stepWalk: {
    files: ["stepWalk_1.mp3", "stepWalk_2.mp3", "stepWalk_3.mp3", "stepWalk_4.mp3", "stepWalk_5.mp3", "stepWalk_6.mp3"],
    gain: 0.55,
    pitchJitter: 0.06,
  },
  stepRun: { files: ["stepRun_1.mp3", "stepRun_2.mp3", "stepRun_3.mp3", "stepRun_4.mp3", "stepRun_5.mp3"], gain: 0.7, pitchJitter: 0.06 },
  splash: { files: ["splash_1.mp3", "splash_2.mp3", "splash_3.mp3", "splash_4.mp3", "splash_5.mp3"], gain: 0.6, pitchJitter: 0.08 },
  creatureIdle: { files: ["creatureIdle_1.mp3", "creatureIdle_2.mp3", "creatureIdle_3.mp3"], gain: 0.5, pitchJitter: 0.06 },
  creatureAlert: { files: ["creatureAlert_1.mp3", "creatureAlert_2.mp3"], gain: 0.85, pitchJitter: 0.05 },
  creatureWindup: { files: ["creatureWindup_1.mp3", "creatureWindup_2.mp3"], gain: 0.7, pitchJitter: 0.05 },
  creatureHurt: {
    files: ["creatureHurt_1.mp3", "creatureHurt_2.mp3", "creatureHurt_3.mp3", "creatureHurt_4.mp3"],
    gain: 0.7,
    pitchJitter: 0.06,
  },
  creatureDeath: { files: ["creatureDeath_1.mp3", "creatureDeath_2.mp3"], gain: 0.8, pitchJitter: 0.05 },
  ratVoice: {
    files: ["ratVoice_1.mp3", "ratVoice_2.mp3", "ratVoice_3.mp3", "ratVoice_4.mp3", "ratVoice_5.mp3", "ratVoice_6.mp3"],
    gain: 0.45,
    pitchJitter: 0.1,
  },
  door: { files: ["door_1.mp3"], gain: 0.8, pitchJitter: 0.03 },
  flashlight: { files: ["flashlight_1.mp3", "flashlight_2.mp3"], gain: 0.2, pitchJitter: 0.05 },
  ammoPickup: { files: ["ammoPickup_1.mp3"], gain: 0.45, pitchJitter: 0.04 },
  playerHurt: { files: ["playerHurt_1.mp3", "playerHurt_2.mp3", "playerHurt_3.mp3", "playerHurt_4.mp3"], gain: 0.45, pitchJitter: 0.04 },
};
