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
  | "pumpBack"
  | "pumpForward"
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

export const SAMPLES: Partial<Record<SampleId, SampleDef>> = {};
