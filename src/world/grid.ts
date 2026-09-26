import * as THREE from "three";

export const CELL_SIZE = 4;
export const WALL_HEIGHT = 3.2;

/**
 * The walkability grid every spatial query runs on. The same grid drives
 * collision, line of sight, bullet raycasts and pathfinding.
 */
export interface LevelGrid {
  cols: number;
  rows: number;
  /** solid[row][col] === true means that cell blocks movement and sight. */
  solid: boolean[][];
}

export interface Cell {
  col: number;
  row: number;
}

export function cellCenter(col: number, row: number): THREE.Vector2 {
  return new THREE.Vector2((col + 0.5) * CELL_SIZE, (row + 0.5) * CELL_SIZE);
}

export function worldToCell(x: number, z: number): Cell {
  return { col: Math.floor(x / CELL_SIZE), row: Math.floor(z / CELL_SIZE) };
}

/** Out-of-bounds counts as solid, so nothing can ever leave the map. */
export function isSolid(level: LevelGrid, col: number, row: number): boolean {
  if (row < 0 || row >= level.rows || col < 0 || col >= level.cols) return true;
  return level.solid[row][col];
}

/** Samples along a segment to check for a clear line through the wall grid. */
export function hasLineOfSight(level: LevelGrid, from: THREE.Vector2, to: THREE.Vector2): boolean {
  const dist = from.distanceTo(to);
  const steps = Math.ceil(dist / (CELL_SIZE * 0.2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const { col, row } = worldToCell(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    if (isSolid(level, col, row)) return false;
  }
  return true;
}

export interface WorldHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

/**
 * Exact ray vs. level test (DDA grid walk for walls, plus the floor and
 * ceiling planes). Used so bullets stop at walls and leave impacts.
 */
export function raycastWorld(level: LevelGrid, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): WorldHit | null {
  let best: WorldHit | null = null;

  // Floor / ceiling planes
  if (dir.y < -1e-6) {
    const t = -origin.y / dir.y;
    if (t > 0 && t < maxDist) best = { distance: t, point: origin.clone().addScaledVector(dir, t), normal: new THREE.Vector3(0, 1, 0) };
  } else if (dir.y > 1e-6) {
    const t = (WALL_HEIGHT - origin.y) / dir.y;
    if (t > 0 && t < maxDist) best = { distance: t, point: origin.clone().addScaledVector(dir, t), normal: new THREE.Vector3(0, -1, 0) };
  }

  // DDA across the XZ grid
  const ox = origin.x / CELL_SIZE;
  const oz = origin.z / CELL_SIZE;
  let col = Math.floor(ox);
  let row = Math.floor(oz);
  const hlen = Math.hypot(dir.x, dir.z);
  if (hlen < 1e-6) return best;
  const stepC = dir.x > 0 ? 1 : -1;
  const stepR = dir.z > 0 ? 1 : -1;
  const tDeltaC = Math.abs(CELL_SIZE / (dir.x || 1e-9));
  const tDeltaR = Math.abs(CELL_SIZE / (dir.z || 1e-9));
  let tMaxC = dir.x !== 0 ? ((dir.x > 0 ? col + 1 - ox : ox - col) * CELL_SIZE) / Math.abs(dir.x) : Infinity;
  let tMaxR = dir.z !== 0 ? ((dir.z > 0 ? row + 1 - oz : oz - row) * CELL_SIZE) / Math.abs(dir.z) : Infinity;
  const limit = best ? best.distance : maxDist;

  for (let i = 0; i < 128; i++) {
    let t: number;
    let normal: THREE.Vector3;
    if (tMaxC < tMaxR) {
      t = tMaxC;
      col += stepC;
      tMaxC += tDeltaC;
      normal = new THREE.Vector3(-stepC, 0, 0);
    } else {
      t = tMaxR;
      row += stepR;
      tMaxR += tDeltaR;
      normal = new THREE.Vector3(0, 0, -stepR);
    }
    if (t > limit) break;
    if (isSolid(level, col, row)) {
      return { distance: t, point: origin.clone().addScaledVector(dir, t), normal };
    }
  }
  return best;
}

/** Resolve a moving circle against the level's wall grid, one axis at a time (slides along walls). */
export function resolveCollision(level: LevelGrid, x: number, z: number, dx: number, dz: number, radius: number): { x: number; z: number } {
  let nx = x;
  let nz = z;
  if (!circleHitsWall(level, nx + dx, nz, radius)) nx += dx;
  if (!circleHitsWall(level, nx, nz + dz, radius)) nz += dz;
  return { x: nx, z: nz };
}

export function circleHitsWall(level: LevelGrid, px: number, pz: number, radius: number): boolean {
  const minCol = Math.floor((px - radius) / CELL_SIZE);
  const maxCol = Math.floor((px + radius) / CELL_SIZE);
  const minRow = Math.floor((pz - radius) / CELL_SIZE);
  const maxRow = Math.floor((pz + radius) / CELL_SIZE);
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!isSolid(level, col, row)) continue;
      const cx = Math.max(col * CELL_SIZE, Math.min(px, (col + 1) * CELL_SIZE));
      const cz = Math.max(row * CELL_SIZE, Math.min(pz, (row + 1) * CELL_SIZE));
      const ddx = px - cx;
      const ddz = pz - cz;
      if (ddx * ddx + ddz * ddz < radius * radius) return true;
    }
  }
  return false;
}

/** Random walkable cell centre within `radiusCells` of a point (for patrols). */
export function randomFloorNear(level: LevelGrid, x: number, z: number, radiusCells: number): THREE.Vector2 {
  const { col, row } = worldToCell(x, z);
  for (let tries = 0; tries < 20; tries++) {
    const c = col + Math.round((Math.random() * 2 - 1) * radiusCells);
    const r = row + Math.round((Math.random() * 2 - 1) * radiusCells);
    if (!isSolid(level, c, r)) {
      const p = cellCenter(c, r);
      p.x += (Math.random() - 0.5) * CELL_SIZE * 0.5;
      p.y += (Math.random() - 0.5) * CELL_SIZE * 0.5;
      return p;
    }
  }
  return new THREE.Vector2(x, z);
}
