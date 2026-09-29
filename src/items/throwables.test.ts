import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CELL_SIZE, type LevelGrid } from "../world/grid";
import { stepFlight, throwFrom } from "./throwables";

// A corridor running east, with a wall at column 6.
const level: LevelGrid = {
  cols: 8,
  rows: 3,
  solid: [Array(8).fill(true), [true, false, false, false, false, false, true, true], Array(8).fill(true)],
} as LevelGrid;

const fly = (pos: THREE.Vector3, vel: THREE.Vector3) => {
  for (let t = 0; t < 4; t += 1 / 60) {
    const hit = stepFlight(level, pos, vel, 1 / 60);
    if (hit) return hit;
  }
  return null;
};

describe("throwing a bottle", () => {
  it("breaks against the first wall in its way, on the near side", () => {
    const { pos, vel } = throwFrom(new THREE.Vector3(CELL_SIZE * 1.5, 1.6, CELL_SIZE * 1.5), new THREE.Vector3(1, 0, 0));
    const hit = fly(pos, vel)!;
    expect(hit).not.toBeNull();
    expect(hit.x).toBeLessThan(CELL_SIZE * 6);
    expect(hit.x).toBeGreaterThan(CELL_SIZE * 1.5);
  });

  it("lands on the floor when thrown down", () => {
    const { pos, vel } = throwFrom(new THREE.Vector3(CELL_SIZE * 1.5, 1.6, CELL_SIZE * 1.5), new THREE.Vector3(1, -2, 0).normalize());
    const hit = fly(pos, vel)!;
    expect(hit.y).toBeCloseTo(0.05);
    expect(hit.x).toBeLessThan(CELL_SIZE * 6);
  });
});
