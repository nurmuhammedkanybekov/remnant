import { describe, expect, it } from "vitest";
import { enemyDef } from "../content/enemies";
import { findPath } from "./pathfinding";
import { isSolid, worldToCell } from "./grid";
import { parseLevel } from "./levelParser";
import { LEVELS } from "./levels";
import { reinforcements } from "./reinforcements";

describe("extra creatures (harder difficulties, co-op)", () => {
  for (const def of LEVELS) {
    const level = parseLevel(def);
    const own = new Set(level.spawns.enemies.map((e) => e.kind));
    const start = level.spawns.playerStart;

    it(`${def.id}: placed sensibly, only familiar kinds, same every time`, () => {
      for (const amount of [0.8, 1.3, 1.8, 2.2]) {
        const extras = reinforcements(level, amount);
        expect(extras).toEqual(reinforcements(level, amount));
        const base = level.spawns.enemies.filter((e) => enemyDef(e.kind).behaviour !== "boss").length;
        expect(extras.length).toBeLessThanOrEqual(Math.min(14, Math.round(Math.max(base, 4) * amount)));
        for (const e of extras) {
          const c = worldToCell(e.pos.x, e.pos.y);
          expect(isSolid(level, c.col, c.row)).toBe(false);
          expect(own.has(e.kind)).toBe(true);
          expect(enemyDef(e.kind).behaviour).not.toBe("boss");
          // Far from the start (by path), and reachable.
          const path = findPath(level, start.x, start.y, e.pos.x, e.pos.y);
          expect(path.length).toBeGreaterThanOrEqual(5);
        }
      }
    });
  }

  it("fills small levels too: more difficulty, more creatures", () => {
    const small = parseLevel(LEVELS[0]);
    expect(reinforcements(small, 0.8).length).toBeGreaterThanOrEqual(3);
    expect(reinforcements(small, 1.8).length).toBeGreaterThan(reinforcements(small, 0.8).length);
  });

  it("adds nothing at 0", () => {
    expect(reinforcements(parseLevel(LEVELS[3]), 0)).toEqual([]);
  });
});
