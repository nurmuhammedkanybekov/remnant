import * as THREE from "three";
import { CELL_SIZE, cellCenter, isSolid } from "./grid";
import type { ParsedLevel } from "./levelParser";
import { hash, mulberry32, shuffle, walkingDistances } from "./reinforcements";

/**
 * Scripted scares: a few one-off moments placed along each level's route,
 * the kind of thing that happens once and stays with you. Nothing in them
 * can hurt you; they work on what you expect.
 *
 *   lightsOut  the lamps ahead go out one by one, towards you, and come back
 *   glimpse    someone is standing at the far end of the corridor, in your
 *              beam; the torch stutters, and they're gone
 *   slam       a steel door slams somewhere behind you; grit falls
 *   runner     bare feet run past on the other side of the wall
 *   whisper    the radio clicks on by itself and says your name
 *
 * Planned purely and seeded per level (the same places every attempt), a
 * fifth of the way in or further, well apart. They fire when you reach them.
 */

export type ScareKind = "lightsOut" | "glimpse" | "slam" | "runner" | "whisper";

export interface ScarePlacement {
  kind: ScareKind;
  /** Where it fires: when you come within `radius` of it. */
  at: THREE.Vector2;
  radius: number;
  /** For lightsOut and glimpse: the direction along the corridor it plays out (unit, world X/Z). */
  dir: THREE.Vector2;
}

/** How many scares a level gets. */
const PER_LEVEL = 3;
/** They stay this far apart (world units). */
const SPACING = CELL_SIZE * 5;

/**
 * Picks the level's scares. Each needs a place that suits it: lightsOut and
 * glimpse a straight run of corridor at least four cells long ahead of you
 * (so there's somewhere for the dark to come from, or someone to stand);
 * runner a wall beside you with open floor behind it; the rest anywhere.
 */
export function planScares(level: ParsedLevel): ScarePlacement[] {
  const rand = mulberry32(hash(`${level.def.id}:scares`));
  const dist = walkingDistances(level);
  const far = Math.max(1, ...dist.filter((d): d is number => d !== undefined));
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c < level.cols && r < level.rows && !isSolid(level, c, r);
  const lampCells = new Set(level.spawns.lamps.map((l) => `${Math.floor(l.pos.x / CELL_SIZE)},${Math.floor(l.pos.y / CELL_SIZE)}`));

  /** How many open cells run straight from (c, r) in direction (dc, dr), and how many lamps are on them. */
  const run = (c: number, r: number, dc: number, dr: number) => {
    let n = 0;
    let lamps = 0;
    while (open(c + dc * (n + 1), r + dr * (n + 1)) && n < 10) {
      n++;
      if (lampCells.has(`${c + dc * n},${r + dr * n}`)) lamps++;
    }
    return { n, lamps };
  };

  const candidates: { c: number; r: number; d: number; dirs: [number, number][]; lampRun: [number, number] | null; wallRun: boolean }[] =
    [];
  for (let r = 0; r < level.rows; r++)
    for (let c = 0; c < level.cols; c++) {
      const d = dist[r * level.cols + c];
      if (d === undefined || !open(c, r)) continue;
      const share = d / far;
      if (share < 0.2 || share > 0.92) continue;
      const dirs: [number, number][] = [];
      let lampRun: [number, number] | null = null;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        // Only directions that lead on, further from the start: where you're going.
        const next = dist[(r + dr) * level.cols + (c + dc)];
        if (next === undefined || next <= d) continue;
        const { n, lamps } = run(c, r, dc, dr);
        if (n >= 4) dirs.push([dc, dr]);
        if (n >= 3 && lamps >= 2 && !lampRun) lampRun = [dc, dr];
        // A lamp right overhead and one more ahead will do, too.
        if (!lampRun && lamps >= 1 && lampCells.has(`${c},${r}`)) lampRun = [dc, dr];
      }
      // A wall to one side with open floor beyond it: something can run there.
      const wallRun = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dc, dr]) => !open(c + dc, r + dr) && open(c + dc * 2, r + dr * 2));
      candidates.push({ c, r, d, dirs, lampRun, wallRun });
    }
  shuffle(candidates, rand);

  const chosen: ScarePlacement[] = [];
  // A different mix on every level: lights going out wherever a level can stage it,
  // the rest in a seeded order, so no two levels play the same trick in the same way.
  const order: ScareKind[] = ["glimpse", "runner", "slam", "whisper"];
  shuffle(order, rand);
  order.unshift("lightsOut");
  for (const kind of order) {
    if (chosen.length >= PER_LEVEL) break;
    const pick = candidates.find((k) => {
      const at = cellCenter(k.c, k.r);
      if (chosen.some((s) => s.at.distanceTo(at) < SPACING)) return false;
      if (kind === "lightsOut") return k.lampRun !== null;
      if (kind === "glimpse") return k.dirs.length > 0;
      if (kind === "runner") return k.wallRun;
      return true;
    });
    if (!pick) continue;
    const [dc, dr] = kind === "lightsOut" ? pick.lampRun! : kind === "glimpse" ? pick.dirs[0] : [1, 0];
    chosen.push({ kind, at: cellCenter(pick.c, pick.r), radius: CELL_SIZE * 0.6, dir: new THREE.Vector2(dc, dr) });
  }
  return chosen;
}
