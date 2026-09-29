import { describe, expect, it } from "vitest";
import { DIFFICULTIES, DIFFICULTY_ORDER } from "../content/difficulty";
import { isSolid, worldToCell } from "./grid";
import { parseLevel } from "./levelParser";
import { LEVELS } from "./levels";
import { lootFor } from "./loot";
import { walkingDistances } from "./reinforcements";

const SUPPLY = new Set(["ammo", "shells", "rivets", "medkit", "battery"]);
const AMMO = new Set(["ammo", "shells", "rivets"]);
const count = (items: { type: string }[], pred: (t: string) => boolean) => items.filter((i) => pred(i.type)).length;

describe("loot by difficulty", () => {
  it("harder modes find fewer supplies, easier ones more, in the order of the menu", () => {
    for (const def of LEVELS) {
      const level = parseLevel(def);
      const supplies = DIFFICULTY_ORDER.filter((d) => d !== "ironman").map((d) =>
        count(lootFor(level, DIFFICULTIES[d].lootSupply), (t) => SUPPLY.has(t))
      );
      // story ≥ normal ≥ nightmare ≥ aizi
      for (let i = 1; i < supplies.length; i++) expect(supplies[i]).toBeLessThanOrEqual(supplies[i - 1]);
    }
    const total = (d: keyof typeof DIFFICULTIES) =>
      LEVELS.reduce((n, def) => n + count(lootFor(parseLevel(def), DIFFICULTIES[d].lootSupply), (t) => SUPPLY.has(t)), 0);
    expect(total("story")).toBeGreaterThan(total("normal"));
    expect(total("aizi")).toBeLessThan(total("nightmare"));
  });

  for (const def of LEVELS) {
    const level = parseLevel(def);
    const dist = walkingDistances(level);
    it(`${def.id}: ammunition is spread through the level, not left by the start`, () => {
      const far = Math.max(...dist.filter((d): d is number => d !== undefined));
      const at = (i: { pos: { x: number; y: number } }) => {
        const c = worldToCell(i.pos.x, i.pos.y);
        return (dist[c.row * level.cols + c.col] ?? 0) / far;
      };
      const ownAmmo = level.spawns.items.filter((i) => AMMO.has(i.type));
      for (const supply of [0.65, 1, 1.8]) {
        const ammo = lootFor(level, supply).filter((i) => AMMO.has(i.type));
        if (ownAmmo.length === 0) {
          expect(ammo).toEqual([]);
          continue;
        }
        expect(ammo.length).toBeGreaterThanOrEqual(3);
        for (const a of ammo) expect(at(a)).toBeGreaterThanOrEqual(0.2);
        // Some in the first half of the level and some in the second.
        expect(ammo.some((a) => at(a) < 0.6)).toBe(true);
        expect(ammo.some((a) => at(a) >= 0.6)).toBe(true);
      }
    });
    it(`${def.id}: keeps keycards, weapons and one of every kind; extras sit on reachable floor`, () => {
      const own = level.spawns.items;
      for (const supply of [0.55, 0.75, 1, 1.4]) {
        const items = lootFor(level, supply);
        expect(items).toEqual(lootFor(level, supply)); // same every time
        const fixed = (t: string) => !SUPPLY.has(t) && t !== "bottle";
        expect(count(items, fixed)).toBe(count(own, fixed));
        expect(count(items, (t) => t === "bottle")).toBeGreaterThanOrEqual(1);
        for (const type of new Set(own.map((i) => i.type))) expect(count(items, (t) => t === type)).toBeGreaterThan(0);
        for (const i of items) {
          const c = worldToCell(i.pos.x, i.pos.y);
          expect(isSolid(level, c.col, c.row)).toBe(false);
          if (!own.some((o) => o.pos.equals(i.pos))) expect(dist[c.row * level.cols + c.col]).toBeDefined();
        }
      }
    });
  }
});
