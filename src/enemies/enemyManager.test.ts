import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cellCenter, type LevelGrid } from "../world/grid";
import { canPerceive } from "./enemyManager";

/** Two rooms side by side, a solid wall between them (column 6). */
function twoRooms(): LevelGrid {
  const cols = 13;
  const rows = 5;
  const solid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => r === 0 || c === 0 || r === rows - 1 || c === cols - 1 || c === 6)
  );
  return { cols, rows, solid };
}

describe("the threat warning", () => {
  const level = twoRooms();
  const me = cellCenter(2, 2);
  it("counts a creature in plain sight", () => {
    expect(canPerceive(level, me, cellCenter(5, 2))).toBe(true);
  });
  it("doesn't give away one in the next room", () => {
    expect(canPerceive(level, me, cellCenter(9, 2))).toBe(false);
  });
  it("counts one close enough to hear, wall or not", () => {
    // Either side of the wall (column 6 spans x 24..28), 4.8 apart.
    expect(canPerceive(level, new THREE.Vector2(23.5, 10), new THREE.Vector2(28.3, 10))).toBe(true);
  });
});
