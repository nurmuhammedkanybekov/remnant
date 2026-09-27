import * as THREE from "three";
import type { PickupType } from "../content/items";
import { cellCenter, isSolid } from "./grid";
import type { ItemSpawn, ParsedLevel } from "./levelParser";
import { hash, mulberry32, shuffle, walkingDistances } from "./reinforcements";

/** Supplies that can be thinned out or added. Keycards, weapons and notes never are. */
const SUPPLIES: ReadonlySet<PickupType> = new Set(["ammo", "shells", "rivets", "medkit", "battery"]);
/** Added supplies stay at least this many cells (walking) from the start... */
const MIN_START_DISTANCE = 3;
/** ...and this far (world units) from any other item. */
const MIN_SPACING = 3;

/**
 * The level's pickups for a difficulty. `supply` below 1 removes that share
 * of the ammunition, medkits and batteries (Aizi finds barely half of what
 * Story does); above 1 adds more of the same kinds in new places. Every kind
 * a level offers keeps at least one pickup, so no weapon is left without
 * ammunition and nothing the level was designed around disappears.
 *
 * Seeded by the level and the amount, so it's the same every time: both
 * co-op players get the same pickups, and checkpoints stay valid.
 */
export function lootFor(level: ParsedLevel, supply: number): ItemSpawn[] {
  const items = level.spawns.items;
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
  const dist = walkingDistances(level);
  const taken: THREE.Vector2[] = [
    ...items.map((i) => i.pos),
    ...level.spawns.notes.map((n) => n.pos),
    ...level.spawns.enemies.map((e) => e.pos),
  ];
  const reserved = new Set<string>();
  const sp = level.spawns;
  for (const s of [...sp.doors, ...sp.generators, ...sp.intercoms, ...sp.consoles, ...sp.checkpoints, ...sp.water])
    reserved.add(`${s.cell.col},${s.cell.row}`);
  reserved.add(`${level.exitCell.col},${level.exitCell.row}`);
  const candidates: THREE.Vector2[] = [];
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      const d = dist[row * level.cols + col];
      if (d === undefined || d < MIN_START_DISTANCE || isSolid(level, col, row) || reserved.has(`${col},${row}`)) continue;
      candidates.push(cellCenter(col, row));
    }
  }
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
