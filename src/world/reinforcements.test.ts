import { describe, expect, it } from "vitest";
import { enemyDef } from "../content/enemies";
import { isSolid, worldToCell } from "./grid";
import { parseLevel } from "./levelParser";
import { LEVELS } from "./levels";
import { reinforcements, walkingDistances } from "./reinforcements";

describe("extra creatures (harder difficulties, co-op)", () => {
  for (const def of LEVELS) {
    const level = parseLevel(def);
    const own = new Set(level.spawns.enemies.map((e) => e.kind));
    const dist = walkingDistances(level);

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
          // Far from the start (walking, through doors), and reachable.
          expect(dist[c.row * level.cols + c.col]).toBeGreaterThanOrEqual(5);
        }
      }
    });
  }

  it("fills small levels too: more difficulty, more creatures", () => {
    const small = parseLevel(LEVELS[0]);
    expect(reinforcements(small, 0.8).length).toBeGreaterThanOrEqual(3);
    expect(reinforcements(small, 1.8).length).toBeGreaterThan(reinforcements(small, 0.8).length);
  });

  it("spreads beyond closed doors instead of piling up near the start", () => {
    // Regression: closed doors are solid in the grid, and the placement search used to stop at them.
    const level = parseLevel(LEVELS[0]); // the infirmary: the start room is closed off by doors
    const start = level.startCell;
    const noDoors = new Set<string>([`${start.col},${start.row}`]);
    const queue = [start];
    while (queue.length) {
      const c = queue.shift()!;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const n = { col: c.col + dc, row: c.row + dr };
        if (isSolid(level, n.col, n.row) || noDoors.has(`${n.col},${n.row}`)) continue;
        noDoors.add(`${n.col},${n.row}`);
        queue.push(n);
      }
    }
    const extras = reinforcements(level, 1.8);
    const beyond = extras.filter((e) => {
      const c = worldToCell(e.pos.x, e.pos.y);
      return !noDoors.has(`${c.col},${c.row}`);
    });
    expect(beyond.length).toBeGreaterThan(extras.length / 2);
  });

  it("adds nothing at 0", () => {
    expect(reinforcements(parseLevel(LEVELS[3]), 0)).toEqual([]);
  });
});
