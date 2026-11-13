import type { ParsedLevel } from "./levelParser";
import { resolveTheme } from "./theme";

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Which cells are open to the sky (cell index = row * cols + col), from the
 * level theme's `outdoor` setting. Empty for every level underground. Pure,
 * so the builder, the dressing and the snow all agree.
 */
export function skyCells(level: ParsedLevel): Set<number> {
  const mode = resolveTheme(level.def.theme).outdoor;
  const sky = new Set<number>();
  if (!mode) return sky;
  const { cols, rows } = level;
  const key = (c: number, r: number) => r * cols + c;
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;
  const open = (c: number, r: number) => inside(c, r) && !level.solid[r][c];
  const water = new Set(level.spawns.water.map((w) => key(w.cell.col, w.cell.row)));

  if (mode === "water") {
    // The water, and any walkway with water on two sides of it.
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (!open(c, r)) continue;
        const wet = SIDES.filter(([dc, dr]) => water.has(key(c + dc, r + dr))).length;
        if (water.has(key(c, r)) || wet >= 2) sky.add(key(c, r));
      }
    return sky;
  }

  // "streets": the biggest stretch of floor you can cover without opening a door.
  const seen = new Set<number>();
  let best: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!open(c, r) || seen.has(key(c, r))) continue;
      const region: number[] = [];
      const queue = [[c, r]];
      seen.add(key(c, r));
      while (queue.length) {
        const [qc, qr] = queue.pop()!;
        region.push(key(qc, qr));
        for (const [dc, dr] of SIDES) {
          const nc = qc + dc;
          const nr = qr + dr;
          if (!open(nc, nr) || seen.has(key(nc, nr))) continue;
          seen.add(key(nc, nr));
          queue.push([nc, nr]);
        }
      }
      if (region.length > best.length) best = region;
    }
  for (const k of best) sky.add(k);
  return sky;
}
