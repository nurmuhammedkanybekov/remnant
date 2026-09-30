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
      // One restraint chair, one operating table, at most.
      expect(plan.props.filter((p) => p.kind === "restraintChair").length).toBeLessThanOrEqual(1);
      expect(plan.props.filter((p) => p.kind === "opTable").length).toBeLessThanOrEqual(1);
    });

    it(`${def.id}: the services run along the corridors and join up`, () => {
      const { runs } = planDressing(level);
      expect(runs.length).toBeGreaterThan(5);
      const at = new Map(runs.map((r) => [`${worldToCell(r.x, r.z).col},${worldToCell(r.x, r.z).row}`, r]));
      for (const r of runs) {
        const c = worldToCell(r.x, r.z);
        expect(def.map[c.row][c.col], `run at ${c.col},${c.row}`).not.toBe("#");
        // A link east (bit 1) is met by a link west (bit 2) from the next cell, and so on.
        for (const [dc, dr, bit, back] of [
          [1, 0, 1, 2],
          [-1, 0, 2, 1],
          [0, 1, 4, 8],
          [0, -1, 8, 4],
        ] as const)
          if (r.links & bit)
            expect(at.get(`${c.col + dc},${c.row + dr}`)?.links ?? 0, `link from ${c.col},${c.row}`).toSatisfy(
              (l: number) => (l & back) !== 0
            );
      }
    });
  }
});

describe("level character", () => {
  const plan = (id: string) => planDressing(parseLevel(LEVELS.find((l) => l.id === id)!));
  it("hangs strip curtains in the freezers and icicles in cold storage", () => {
    const kinds = plan("cold-storage").props.map((p) => p.kind);
    expect(kinds).toContain("strips");
    expect(kinds).toContain("icicles");
  });
  it("fits out the labs as labs", () => {
    const kinds = new Set(plan("containment-labs").props.map((p) => p.kind));
    for (const k of ["labBench", "fumeHood", "tank"] as const) expect(kinds).toContain(k);
  });
  it("puts pumps in the pumping station", () => {
    expect(plan("pumping-station").props.some((p) => p.kind === "pump")).toBe(true);
  });
});
