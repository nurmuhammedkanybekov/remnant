import { describe, expect, it } from "vitest";
import { DIFFICULTIES, DIFFICULTY_ORDER } from "../content/difficulty";
import { findPath } from "./pathfinding";
import { isSolid, worldToCell } from "./grid";
import { parseLevel } from "./levelParser";
import { LEVELS } from "./levels";
import { lootFor } from "./loot";

const SUPPLY = new Set(["ammo", "shells", "rivets", "medkit", "battery"]);
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
    it(`${def.id}: keeps keycards, weapons and one of every kind; extras sit on reachable floor`, () => {
      const own = level.spawns.items;
      for (const supply of [0.55, 0.75, 1, 1.4]) {
        const items = lootFor(level, supply);
        expect(items).toEqual(lootFor(level, supply)); // same every time
        expect(count(items, (t) => !SUPPLY.has(t))).toBe(count(own, (t) => !SUPPLY.has(t)));
        for (const type of new Set(own.map((i) => i.type))) expect(count(items, (t) => t === type)).toBeGreaterThan(0);
        for (const i of items) {
          const c = worldToCell(i.pos.x, i.pos.y);
          expect(isSolid(level, c.col, c.row)).toBe(false);
          const start = level.spawns.playerStart;
          if (!own.includes(i) && !own.some((o) => o.pos.equals(i.pos)))
            expect(findPath(level, start.x, start.y, i.pos.x, i.pos.y).length).toBeGreaterThan(0);
        }
      }
    });
  }
});
