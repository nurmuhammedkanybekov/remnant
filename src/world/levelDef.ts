import type { ScriptAction } from "../game/script";
import type { LevelTheme } from "./theme";

/**
 * A hand-authored level. Maps are text grids, one character per
 * CELL_SIZE × CELL_SIZE cell:
 *
 *   #  wall                  .  floor
 *   S  player spawn          X  exit
 *   A  ammo                  M  medkit
 *   B  flashlight battery    K  keycard
 *   L  ceiling lamp          R  red emergency lamp
 *   C  crate stack (solid)   O  barrels (solid)
 *   D  door (press interact to open)
 *   =  security door (opens with the keycard)
 *   G  generator (solid; the exit has no power until every generator runs)
 *   Y  intercom (plays the next entry of `intercoms`)
 *   ~  shallow water (slow and loud to wade through)
 *   *  checkpoint
 *   Z  detonator console (final level only)
 *   0–9  note pickup, text from the level's `notes` table
 *   a–z  invisible trigger; runs `triggers[letter]` the first time any cell with that letter is entered
 *
 * Enemy glyphs come from `content/enemies.ts` (E = husk, H = brute, …).
 *
 * The keycard opens security doors if the level has any; otherwise it
 * unlocks the exit.
 */
export interface LevelDef {
  id: string;
  /** "Sublevel 10" */
  name: string;
  /** "Infirmary" */
  subtitle: string;
  objective: string;
  map: string[];
  notes: Record<string, string>;
  /** Initial camera yaw in radians. 0 faces -Z (up the map), -PI/2 faces +X (right). */
  spawnYaw: number;
  /** Run once per trigger letter. */
  triggers?: Record<string, ScriptAction[]>;
  /** Intercom scripts, in map reading order (left to right, top to bottom). */
  intercoms?: ScriptAction[][];
  events?: {
    /** When the level starts fresh (not when restored from a checkpoint). */
    start?: ScriptAction[];
    /** When the keycard is picked up. */
    keycard?: ScriptAction[];
    /** When the last generator comes online. */
    power?: ScriptAction[];
  };
  theme?: Partial<LevelTheme>;
  /** The last level: the exit and the detonator console each end the game. */
  finale?: boolean;
}
