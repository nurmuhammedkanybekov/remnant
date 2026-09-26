import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CELL_SIZE, circleHitsWall, hasLineOfSight, raycastWorld, resolveCollision, worldToCell, type LevelGrid } from "./grid";
import { findPath } from "./pathfinding";

// 5×5 cells: a ring of walls with one pillar in the middle.
//   #####
//   #...#
//   #.#.#
//   #...#
//   #####
const grid: LevelGrid = {
  cols: 5,
  rows: 5,
  solid: ["#####", "#...#", "#.#.#", "#...#", "#####"].map((r) => [...r].map((c) => c === "#")),
};
const center = (col: number, row: number) => new THREE.Vector2((col + 0.5) * CELL_SIZE, (row + 0.5) * CELL_SIZE);

describe("grid queries", () => {
  it("maps world positions to cells", () => {
    expect(worldToCell(CELL_SIZE * 2.5, CELL_SIZE * 1.1)).toEqual({ col: 2, row: 1 });
  });

  it("line of sight is blocked by the pillar only", () => {
    expect(hasLineOfSight(grid, center(1, 1), center(3, 1))).toBe(true);
    expect(hasLineOfSight(grid, center(1, 2), center(3, 2))).toBe(false);
  });

  it("raycasts stop at the first wall", () => {
    const origin = new THREE.Vector3(center(1, 2).x, 1.5, center(1, 2).y);
    const hit = raycastWorld(grid, origin, new THREE.Vector3(1, 0, 0), 100);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(CELL_SIZE / 2);
    expect(hit!.normal.x).toBe(-1);
  });

  it("raycasts hit the floor when aimed down", () => {
    const origin = new THREE.Vector3(center(1, 1).x, 1.5, center(1, 1).y);
    const hit = raycastWorld(grid, origin, new THREE.Vector3(0, -1, 0), 100);
    expect(hit!.distance).toBeCloseTo(1.5);
    expect(hit!.normal.y).toBe(1);
  });

  it("collision slides along walls instead of stopping", () => {
    const start = center(1, 1);
    // Push diagonally into the top wall: x movement survives, z is blocked.
    const r = resolveCollision(grid, start.x, start.y, 0.5, -3, 0.35);
    expect(r.x).toBeCloseTo(start.x + 0.5);
    expect(r.z).toBe(start.y);
    expect(circleHitsWall(grid, r.x, r.z, 0.35)).toBe(false);
  });

  it("pathfinding routes around the pillar", () => {
    const from = center(1, 2);
    const to = center(3, 2);
    const path = findPath(grid, from.x, from.y, to.x, to.y);
    expect(path.length).toBe(4);
    for (const p of path) {
      const c = worldToCell(p.x, p.y);
      expect(grid.solid[c.row][c.col]).toBe(false);
    }
    expect(findPath(grid, from.x, from.y, center(2, 2).x, center(2, 2).y)).toEqual([]);
  });
});
