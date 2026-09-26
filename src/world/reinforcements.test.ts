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
      for (const amount of [0.6, 1, 1.4]) {
        const extras = reinforcements(level, amount);
        expect(extras).toEqual(reinforcements(level, amount));
        const base = level.spawns.enemies.filter((e) => enemyDef(e.kind).behaviour !== "boss").length;
        expect(extras.length).toBeLessThanOrEqual(Math.min(10, Math.round(base * amount)));
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

  it("adds nothing at 0", () => {
    expect(reinforcements(parseLevel(LEVELS[3]), 0)).toEqual([]);
  });
});
