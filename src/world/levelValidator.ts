import { isSolid, worldToCell, type Cell } from "./grid";
import type { ParsedLevel } from "./levelParser";

/**
 * Design checks beyond "does it parse": can the level actually be finished?
 * Returns human-readable problems; an empty list means the level is sound.
 */
export function validateLevel(level: ParsedLevel): string[] {
  const problems: string[] = [];
  const id = level.def.id;
  const reachable = floodFill(level, level.startCell);
  const canReach = (c: Cell) => reachable.has(c.row * level.cols + c.col);

  // The outer ring must be solid — collision assumes a closed map.
  for (let col = 0; col < level.cols; col++) {
    if (!level.solid[0][col] || !level.solid[level.rows - 1][col]) problems.push(`${id}: open edge at column ${col}`);
  }
  for (let row = 0; row < level.rows; row++) {
    if (!level.solid[row][0] || !level.solid[row][level.cols - 1]) problems.push(`${id}: open edge at row ${row}`);
  }

  if (!canReach(level.exitCell)) problems.push(`${id}: exit is not reachable from the spawn`);

  const s = level.spawns;
  const check = (label: string, points: { x: number; y: number }[]) => {
    for (const p of points) {
      const cell = worldToCell(p.x, p.y);
      if (!canReach(cell)) problems.push(`${id}: ${label} at ${cell.col},${cell.row} is not reachable`);
    }
  };
  check("keycard", s.keycards);
  check("ammo", s.ammo);
  check("medkit", s.medkits);
  check("battery", s.batteries);
  check(
    "note",
    s.notes.map((n) => n.pos)
  );

  if (s.keycards.length > 1) problems.push(`${id}: more than one keycard`);
  for (const e of s.enemies) {
    const cell = worldToCell(e.pos.x, e.pos.y);
    const d = Math.abs(cell.col - level.startCell.col) + Math.abs(cell.row - level.startCell.row);
    if (d < 3) problems.push(`${id}: ${e.kind} at ${cell.col},${cell.row} spawns within 3 cells of the player`);
  }
  return problems;
}

/** Every walkable cell index reachable from `start` (4-connected). */
function floodFill(level: ParsedLevel, start: Cell): Set<number> {
  const seen = new Set<number>([start.row * level.cols + start.col]);
  const queue: Cell[] = [start];
  while (queue.length) {
    const { col, row } = queue.pop()!;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const c = col + dc;
      const r = row + dr;
      const i = r * level.cols + c;
      if (isSolid(level, c, r) || seen.has(i)) continue;
      seen.add(i);
      queue.push({ col: c, row: r });
    }
  }
  return seen;
}
