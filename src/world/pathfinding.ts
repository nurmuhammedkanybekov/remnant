import * as THREE from "three";
import { CELL_SIZE, isSolid, worldToCell, type LevelData } from "./level";

/** Breadth-first search on the level grid. Good enough for small hand-built levels. */
export function findPath(
  level: LevelData,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number
): THREE.Vector2[] {
  const start = worldToCell(fromX, fromZ);
  const goal = worldToCell(toX, toZ);

  if (isSolid(level, goal.col, goal.row)) return [];

  const key = (c: number, r: number) => `${c},${r}`;
  const visited = new Set<string>([key(start.col, start.row)]);
  const cameFrom = new Map<string, { col: number; row: number }>();
  const queue: { col: number; row: number }[] = [start];
  const dirs = [
    { dc: 1, dr: 0 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: 0, dr: -1 },
  ];

  let found = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.col === goal.col && current.row === goal.row) {
      found = true;
      break;
    }
    for (const d of dirs) {
      const nc = current.col + d.dc;
      const nr = current.row + d.dr;
      const k = key(nc, nr);
      if (visited.has(k) || isSolid(level, nc, nr)) continue;
      visited.add(k);
      cameFrom.set(k, current);
      queue.push({ col: nc, row: nr });
    }
  }

  if (!found) return [];

  const path: THREE.Vector2[] = [];
  let cur = goal;
  while (!(cur.col === start.col && cur.row === start.row)) {
    path.push(new THREE.Vector2((cur.col + 0.5) * CELL_SIZE, (cur.row + 0.5) * CELL_SIZE));
    const prev = cameFrom.get(key(cur.col, cur.row));
    if (!prev) break;
    cur = prev;
  }
  path.reverse();
  return path;
}
