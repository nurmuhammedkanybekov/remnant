import { describe, expect, it } from "vitest";
import { isSolid, worldToCell } from "./grid";
import { parseLevel } from "./levelParser";
import { LEVELS } from "./levels";
import { planScares } from "./scares";
import { walkingDistances } from "./reinforcements";

describe("scripted scares", () => {
  for (const def of LEVELS) {
    it(`${def.id}: a few, well apart, on the way, the same every time`, () => {
      const level = parseLevel(def);
      const scares = planScares(level);
      expect(planScares(level)).toEqual(scares);
      expect(scares.length).toBeGreaterThanOrEqual(2);
      expect(new Set(scares.map((s) => s.kind)).size).toBe(scares.length);
      const dist = walkingDistances(level);
      const far = Math.max(...dist.filter((d): d is number => d !== undefined));
      for (const s of scares) {
        const c = worldToCell(s.at.x, s.at.y);
        expect(isSolid(level, c.col, c.row)).toBe(false);
        // Not in the first fifth of the level: you've settled in before anything happens.
        expect(dist[c.row * level.cols + c.col]! / far).toBeGreaterThanOrEqual(0.2);
        for (const o of scares) if (o !== s) expect(o.at.distanceTo(s.at)).toBeGreaterThan(15);
      }
    });
  }
});
