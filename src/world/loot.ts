import * as THREE from "three";
import type { PickupType } from "../content/items";
import { cellCenter, isSolid, worldToCell } from "./grid";
import type { ItemSpawn, ParsedLevel } from "./levelParser";
import { hash, mulberry32, shuffle, walkingDistances as measure } from "./reinforcements";

const distances = new WeakMap<ParsedLevel, (number | undefined)[]>();
/** Walking distances from the start (worked out once per level). */
function walkingDistances(level: ParsedLevel): (number | undefined)[] {
  let d = distances.get(level);
  if (!d) distances.set(level, (d = measure(level)));
  return d;
}

/** Supplies that can be thinned out or added. Keycards, weapons and notes never are. */
const SUPPLIES: ReadonlySet<PickupType> = new Set(["ammo", "shells", "rivets", "medkit", "battery"]);
/** Added supplies stay at least this many cells (walking) from the start... */
const MIN_START_DISTANCE = 3;
/** ...and this far (world units) from any other item. */
const MIN_SPACING = 3;

/** Ammunition: split into small caches spread over the whole level. */
const AMMO: ReadonlySet<PickupType> = new Set(["ammo", "shells", "rivets"]);
/**
 * Each ammunition pickup on a map becomes this many caches (each pickup now
 * holds half what it used to: see `ammoPickup` in `content/weapons.ts`), so
 * the total is the same but you have to search for it.
 */
const AMMO_SPLIT = 2;
/** Caches are spread between this share of the level's walking length and its far end. */
const AMMO_FROM = 0.2;
/** Bottles to throw on each level, before the difficulty's supply. */
const BOTTLES_PER_LEVEL = 2;
/** Even the leanest level has at least this many caches of each kind it offers. */
const MIN_CACHES = 3;

/**
 * The level's pickups for a difficulty. `supply` below 1 removes that share
 * of the ammunition, medkits and batteries (Aizi finds barely half of what
 * Story does); above 1 adds more of the same kinds in new places. Every kind
 * a level offers keeps at least one pickup, so no weapon is left without
 * ammunition and nothing the level was designed around disappears.
 *
 * Ammunition comes in small caches spread from near the start to the far
 * corners (`spreadAmmo`), so the bullets are found by exploring, not in one
 * box by the door.
 *
 * Seeded by the level and the amount, so it's the same every time: both
 * co-op players get the same pickups, and checkpoints stay valid.
 */
export function lootFor(level: ParsedLevel, supply: number): ItemSpawn[] {
  const items = level.spawns.items;
  const rest = otherSupplies(
    level,
    items.filter((i) => !AMMO.has(i.type)),
    supply
  );
  const ammo = spreadAmmo(level, supply, rest);
  return [...rest, ...ammo, ...scatterBottles(level, supply, [...rest, ...ammo])];
}

/** Medkits and batteries (and everything fixed): thinned out or added to, as before. */
function otherSupplies(level: ParsedLevel, items: ItemSpawn[], supply: number): ItemSpawn[] {
  if (Math.abs(supply - 1) < 1e-6) return items.map((i) => ({ ...i }));
  const rand = mulberry32(hash(`${level.def.id}:loot:${supply}`));
  const fixed = items.filter((i) => !SUPPLIES.has(i.type));
  const supplies = items.filter((i) => SUPPLIES.has(i.type));

  if (supply < 1) {
    const kept: ItemSpawn[] = [];
    for (const type of new Set(supplies.map((i) => i.type))) {
      const ofType = supplies.filter((i) => i.type === type);
      shuffle(ofType, rand);
      kept.push(...ofType.slice(0, Math.max(1, Math.round(ofType.length * supply))));
    }
    // Keep the map's reading order, so indices are stable and readable.
    return [...fixed, ...supplies.filter((i) => kept.includes(i))].map((i) => ({ ...i }));
  }

  const extra = Math.round(supplies.length * (supply - 1));
  const out = items.map((i) => ({ ...i }));
  if (extra === 0 || supplies.length === 0) return out;
  const taken: THREE.Vector2[] = [
    ...items.map((i) => i.pos),
    ...level.spawns.notes.map((n) => n.pos),
    ...level.spawns.enemies.map((e) => e.pos),
  ];
  const candidates = openCells(level).map((c) => c.pos);
  shuffle(candidates, rand);
  const kinds = supplies.map((i) => i.type);
  let added = 0;
  for (const p of candidates) {
    if (added >= extra) break;
    if (taken.some((t) => t.distanceTo(p) < MIN_SPACING)) continue;
    taken.push(p);
    out.push({ type: kinds[Math.floor(rand() * kinds.length)], pos: p.clone() });
    added++;
  }
  return out;
}

/**
 * The level's ammunition as small caches: each pickup on the map becomes
 * `AMMO_SPLIT` caches (times the difficulty's supply), spread evenly by
 * walking distance from a fifth of the way in to the far end. Map-placed
 * pickups past that point keep their spot (the designer put them there);
 * ones by the start move out into the level.
 */
function spreadAmmo(level: ParsedLevel, supply: number, placed: ItemSpawn[]): ItemSpawn[] {
  const own = level.spawns.items.filter((i) => AMMO.has(i.type));
  if (own.length === 0) return [];
  const left = new Map<PickupType, number>();
  for (const type of new Set(own.map((i) => i.type)))
    left.set(type, Math.max(MIN_CACHES, Math.round(own.filter((i) => i.type === type).length * AMMO_SPLIT * supply)));
  const far = farthest(level);
  const keep: ItemSpawn[] = [];
  for (const i of own) {
    if (distanceShare(level, i.pos, far) < AMMO_FROM || !left.get(i.type)) continue;
    left.set(i.type, left.get(i.type)! - 1);
    keep.push(i);
  }
  const kinds = [...left].flatMap(([type, n]) => new Array<PickupType>(n).fill(type));
  return spread(level, mulberry32(hash(`${level.def.id}:ammo:${supply}`)), kinds, keep, placed);
}

/**
 * Bottles and cans to throw: a couple per level (more on easy settings and in
 * co-op), scattered the same way as the ammunition.
 */
function scatterBottles(level: ParsedLevel, supply: number, placed: ItemSpawn[]): ItemSpawn[] {
  const n = Math.max(1, Math.round(BOTTLES_PER_LEVEL * supply));
  return spread(level, mulberry32(hash(`${level.def.id}:bottles:${supply}`)), new Array<PickupType>(n).fill("bottle"), [], placed);
}

/**
 * Places `kinds` so that, together with `keep` (already placed, kept as they
 * are), they cover the level evenly by walking distance: the stretch from
 * `AMMO_FROM` to the far end is cut into one band per item, and each new
 * item goes in the emptiest band, on open floor away from everything in
 * `placed`, the notes and the creatures.
 */
function spread(level: ParsedLevel, rand: () => number, kinds: PickupType[], keep: ItemSpawn[], placed: ItemSpawn[]): ItemSpawn[] {
  const cells = openCells(level);
  const far = farthest(level);
  const total = keep.length + kinds.length;
  if (total === 0) return [];
  const band = (f: number) => Math.min(total - 1, Math.max(0, Math.floor(((f - AMMO_FROM) / (1 - AMMO_FROM)) * total)));
  const filled = new Array<number>(total).fill(0);
  const taken: THREE.Vector2[] = [
    ...placed.map((i) => i.pos),
    ...level.spawns.notes.map((n) => n.pos),
    ...level.spawns.enemies.map((e) => e.pos),
  ];
  const out: ItemSpawn[] = [];
  for (const i of keep) {
    filled[band(distanceShare(level, i.pos, far))]++;
    taken.push(i.pos);
    out.push({ ...i, pos: i.pos.clone() });
  }
  const byBand: THREE.Vector2[][] = filled.map(() => []);
  for (const c of cells) if (c.dist / far >= AMMO_FROM) byBand[band(c.dist / far)].push(c.pos);
  for (const list of byBand) shuffle(list, rand);
  const order = [...kinds];
  shuffle(order, rand);
  for (const type of order) {
    // The emptiest stretch of the level first, so the items cover all of it.
    const bands = filled.map((n, b) => [n, b] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, b] of bands) {
      const p = byBand[b].find((q) => !taken.some((t) => t.distanceTo(q) < MIN_SPACING));
      if (!p) continue;
      filled[b]++;
      taken.push(p);
      out.push({ type, pos: p.clone() });
      break;
    }
  }
  return out;
}

function farthest(level: ParsedLevel): number {
  return Math.max(1, ...openCells(level).map((c) => c.dist));
}

/** How far along the level (0 = the start, 1 = its farthest point) a spot is, walking. */
function distanceShare(level: ParsedLevel, p: THREE.Vector2, far: number): number {
  const c = worldToCell(p.x, p.y);
  return (walkingDistances(level)[c.row * level.cols + c.col] ?? 0) / far;
}

/** Floor cells an item can be put on, with their walking distance from the start. */
function openCells(level: ParsedLevel): { pos: THREE.Vector2; dist: number }[] {
  const dist = walkingDistances(level);
  const reserved = new Set<string>();
  const sp = level.spawns;
  for (const s of [...sp.doors, ...sp.generators, ...sp.intercoms, ...sp.consoles, ...sp.checkpoints, ...sp.water])
    reserved.add(`${s.cell.col},${s.cell.row}`);
  reserved.add(`${level.exitCell.col},${level.exitCell.row}`);
  const out: { pos: THREE.Vector2; dist: number }[] = [];
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      const d = dist[row * level.cols + col];
      if (d === undefined || d < MIN_START_DISTANCE || isSolid(level, col, row) || reserved.has(`${col},${row}`)) continue;
      out.push({ pos: cellCenter(col, row), dist: d });
    }
  }
  return out;
}
