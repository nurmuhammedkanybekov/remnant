import * as THREE from "three";
import { enemyDef, type EnemyKind } from "../content/enemies";
import { cellCenter, isSolid } from "./grid";
import type { EnemySpawn, ParsedLevel } from "./levelParser";

/** Extra creatures never appear closer to the start than this (in cells, walking). */
const MIN_START_DISTANCE = 6;
/** ...or within this many cells (straight-line) of another creature, so they spread out. */
const MIN_SPACING = 1.5;
/** ...or this close to the boss. */
const BOSS_CLEARANCE = 4;
/** No level gets more than this many extras, however many it started with. */
const MAX_EXTRAS = 14;
/** Small levels are treated as if they had at least this many creatures, so they still fill up. */
const MIN_BASE = 4;

/**
 * Extra creatures on top of a level's hand-placed ones, for the harder
 * difficulties and co-op. `amount` is a fraction of the level's own count
 * (0.6 = 60% more), counting a small level as `MIN_BASE`.
 *
 * Deterministic for a given level and amount — both co-op players get the
 * same creatures in the same places, and checkpoint indices stay valid.
 * Only kinds already on the level are used, so each creature still first
 * appears where the story introduces it. They're placed far from the start
 * (by walking distance), spread out, away from doors, machines and the exit.
 */
export function reinforcements(level: ParsedLevel, amount: number): EnemySpawn[] {
  const base = level.spawns.enemies.filter((e) => enemyDef(e.kind).behaviour !== "boss");
  if (amount <= 0 || base.length === 0) return [];
  const count = Math.min(MAX_EXTRAS, Math.round(Math.max(base.length, MIN_BASE) * amount));
  if (count === 0) return [];

  const rand = mulberry32(hash(`${level.def.id}:${amount}`));
  const reserved = new Set<string>();
  const key = (c: { col: number; row: number }) => `${c.col},${c.row}`;
  const sp = level.spawns;
  for (const s of [...sp.doors, ...sp.generators, ...sp.intercoms, ...sp.consoles, ...sp.checkpoints]) reserved.add(key(s.cell));
  reserved.add(key(level.exitCell));

  const dist = walkingDistances(level);
  const boss = level.spawns.enemies.find((e) => enemyDef(e.kind).behaviour === "boss");
  const taken: THREE.Vector2[] = level.spawns.enemies.map((e) => e.pos);
  const candidates: THREE.Vector2[] = [];
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      if (isSolid(level, col, row) || reserved.has(key({ col, row }))) continue;
      const d = dist[row * level.cols + col];
      if (d === undefined || d < MIN_START_DISTANCE) continue;
      const p = cellCenter(col, row);
      if (boss && p.distanceTo(boss.pos) < BOSS_CLEARANCE * 4) continue;
      candidates.push(p);
    }
  }
  // Kinds in proportion to the level's own mix (a level of rats gets more rats).
  const kinds: EnemyKind[] = base.map((e) => e.kind);
  const out: EnemySpawn[] = [];
  shuffle(candidates, rand);
  for (const p of candidates) {
    if (out.length >= count) break;
    if (taken.some((t) => t.distanceTo(p) < MIN_SPACING * 4)) continue;
    taken.push(p);
    out.push({ pos: p.clone(), kind: kinds[Math.floor(rand() * kinds.length)] });
  }
  return out;
}

/** Walking distance in cells from the start to every reachable floor cell (doors count as open). */
export function walkingDistances(level: ParsedLevel): (number | undefined)[] {
  const dist: (number | undefined)[] = new Array(level.cols * level.rows);
  const s = level.startCell;
  const queue = [s];
  dist[s.row * level.cols + s.col] = 0;
  while (queue.length) {
    const c = queue.shift()!;
    const d = dist[c.row * level.cols + c.col]!;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = { col: c.col + dc, row: c.row + dr };
      const i = n.row * level.cols + n.col;
      if (isSolid(level, n.col, n.row) || dist[i] !== undefined) continue;
      dist[i] = d + 1;
      queue.push(n);
    }
  }
  return dist;
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: T[], rand: () => number): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}
