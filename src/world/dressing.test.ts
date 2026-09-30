import { describe, expect, it } from "vitest";
import { planDressing } from "./dressing";
import { isSolid, worldToCell } from "./grid";
import { parseLevel } from "./levelParser";
import { LEVELS } from "./levels";

describe("set dressing", () => {
  for (const def of LEVELS) {
    const level = parseLevel(def);
    it(`${def.id}: rooms furnished, signs up, nothing in a wall, the same every time`, () => {
      const plan = planDressing(level);
      expect(planDressing(level)).toEqual(plan);
      for (const p of plan.props) {
        const c = worldToCell(p.x, p.z);
        expect(isSolid(level, c.col, c.row), `${p.kind} at ${c.col},${c.row}`).toBe(false);
      }
      // Every note lies on a table.
      expect(plan.props.filter((p) => p.kind === "noteTable").length).toBe(level.spawns.notes.length);
      expect(plan.props.filter((p) => p.kind !== "noteTable" && p.kind !== "body").length).toBeGreaterThan(
        def.id === "ventilation" ? 0 : 3
      );
      if (def.id !== "hive" && def.id !== "ventilation") expect(plan.signs.length).toBeGreaterThan(0);
    });
  }
});
