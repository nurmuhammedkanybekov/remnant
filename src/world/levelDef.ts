/**
 * A hand-authored level. Maps are text grids, one character per
 * CELL_SIZE × CELL_SIZE cell:
 *
 *   #  wall                  .  floor
 *   S  player spawn          X  exit
 *   A  ammo                  M  medkit
 *   B  flashlight battery    K  keycard (if present, exit stays locked until taken)
 *   L  ceiling lamp          R  red emergency lamp
 *   C  crate stack (solid)   O  barrels (solid)
 *   0–9  note pickup, text from the level's `notes` table
 *
 * Enemy glyphs come from `content/enemies.ts` (E = husk, H = brute, …).
 */
export interface LevelDef {
  id: string;
  name: string;
  subtitle: string;
  objective: string;
  map: string[];
  notes: Record<string, string>;
  /** Initial camera yaw in radians. 0 faces -Z (up the map), -PI/2 faces +X (right). */
  spawnYaw: number;
}
