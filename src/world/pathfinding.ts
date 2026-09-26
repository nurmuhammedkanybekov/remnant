import * as THREE from "three";
import { CELL_SIZE, isSolid, worldToCell, type LevelData } from "./level";

/**
 * Breadth-first search on the 4-connected level grid. Returns cell-centre
 * waypoints from (but excluding) the start cell to the goal cell.
 * Uses flat typed arrays + an index-based queue — cheap enough to run for
 * every chasing enemy several times a second on these map sizes.
 */
export function findPath(level: LevelData, fromX: number, fromZ: number, toX: number, toZ: number): THREE.Vector2[] {
  const start = worldToCell(fromX, fromZ);
  const goal = worldToCell(toX, toZ);
  if (isSolid(level, goal.col, goal.row)) return [];
  const { cols, rows } = level;
  const idx = (c: number, r: number) => r * cols + c;
  const startI = idx(start.col, start.row);
  const goalI = idx(goal.col, goal.row);
  if (startI === goalI) return [];

  const cameFrom = new Int32Array(cols * rows).fill(-1);
  cameFrom[startI] = startI;
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  queue[tail++] = startI;

  while (head < tail) {
    const cur = queue[head++];
    if (cur === goalI) break;
    const c = cur % cols;
    const r = (cur / cols) | 0;
    const neighbours = [
      [c + 1, r],
      [c - 1, r],
      [c, r + 1],
      [c, r - 1],
    ];
    for (const [nc, nr] of neighbours) {
      if (isSolid(level, nc, nr)) continue;
      const ni = idx(nc, nr);
      if (cameFrom[ni] !== -1) continue;
      cameFrom[ni] = cur;
      queue[tail++] = ni;
    }
  }
  if (cameFrom[goalI] === -1) return [];

  const path: THREE.Vector2[] = [];
  for (let cur = goalI; cur !== startI; cur = cameFrom[cur]) {
    const c = cur % cols;
    const r = (cur / cols) | 0;
    path.push(new THREE.Vector2((c + 0.5) * CELL_SIZE, (r + 0.5) * CELL_SIZE));
  }
  return path.reverse();
}
