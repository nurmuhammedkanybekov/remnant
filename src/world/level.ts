import * as THREE from "three";

export const CELL_SIZE = 4;
export const WALL_HEIGHT = 3.2;

export interface NoteSpawn {
  pos: THREE.Vector2;
  text: string;
}

export interface Spawns {
  playerStart: THREE.Vector2;
  enemySpawns: THREE.Vector2[];
  ammoSpawns: THREE.Vector2[];
  medkitSpawns: THREE.Vector2[];
  noteSpawns: NoteSpawn[];
  exit: THREE.Vector2;
}

export interface LevelData {
  cols: number;
  rows: number;
  /** solid[row][col] === true means that cell is a wall */
  solid: boolean[][];
  spawns: Spawns;
}

function cellCenter(col: number, row: number): THREE.Vector2 {
  return new THREE.Vector2((col + 0.5) * CELL_SIZE, (row + 0.5) * CELL_SIZE);
}

export function worldToCell(x: number, z: number): { col: number; row: number } {
  return { col: Math.floor(x / CELL_SIZE), row: Math.floor(z / CELL_SIZE) };
}

export function isSolid(level: LevelData, col: number, row: number): boolean {
  if (row < 0 || row >= level.rows || col < 0 || col >= level.cols) return true;
  return level.solid[row][col];
}

export function buildLevel(
  scene: THREE.Scene,
  rawMap: string[],
  notes: Record<string, string>
): LevelData {
  const cols = Math.max(...rawMap.map((r) => r.length));
  const rows = rawMap.length;
  // Normalize: pad short rows with walls so a hand-authored map can never
  // produce out-of-bounds gaps.
  const map = rawMap.map((r) => r.padEnd(cols, "#"));

  const solid: boolean[][] = [];
  const spawns: Spawns = {
    playerStart: new THREE.Vector2(CELL_SIZE * 1.5, CELL_SIZE * 1.5),
    enemySpawns: [],
    ammoSpawns: [],
    medkitSpawns: [],
    noteSpawns: [],
    exit: new THREE.Vector2(CELL_SIZE * (cols - 1.5), CELL_SIZE * (rows - 1.5)),
  };

  const wallPositions: THREE.Vector2[] = [];

  for (let row = 0; row < rows; row++) {
    const solidRow: boolean[] = [];
    for (let col = 0; col < cols; col++) {
      const ch = map[row][col];
      const center = cellCenter(col, row);
      let isWall = false;
      switch (ch) {
        case "#":
          isWall = true;
          wallPositions.push(center);
          break;
        case "S":
          spawns.playerStart = center;
          break;
        case "X":
          spawns.exit = center;
          break;
        case "E":
          spawns.enemySpawns.push(center);
          break;
        case "A":
          spawns.ammoSpawns.push(center);
          break;
        case "M":
          spawns.medkitSpawns.push(center);
          break;
        default:
          if (ch >= "0" && ch <= "9" && notes[ch]) {
            spawns.noteSpawns.push({ pos: center, text: notes[ch] });
          }
          break;
      }
      solidRow.push(isWall);
    }
    solid.push(solidRow);
  }

  const level: LevelData = { cols, rows, solid, spawns };
  buildGeometry(scene, level, wallPositions);
  return level;
}

function buildGeometry(scene: THREE.Scene, level: LevelData, wallPositions: THREE.Vector2[]): void {
  const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.95, metalness: 0.05 });
  const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallPositions.length);
  const dummy = new THREE.Object3D();
  wallPositions.forEach((pos, i) => {
    dummy.position.set(pos.x, WALL_HEIGHT / 2, pos.y);
    dummy.updateMatrix();
    wallMesh.setMatrixAt(i, dummy.matrix);
  });
  wallMesh.instanceMatrix.needsUpdate = true;
  scene.add(wallMesh);

  const width = level.cols * CELL_SIZE;
  const depth = level.rows * CELL_SIZE;

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width / 2, 0, depth / 2);
  scene.add(floor);

  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 1 });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(width / 2, WALL_HEIGHT, depth / 2);
  scene.add(ceiling);

  scene.fog = new THREE.FogExp2(0x000000, 0.085);
  scene.background = new THREE.Color(0x000000);

  const ambient = new THREE.AmbientLight(0x3a4a55, 0.18);
  scene.add(ambient);
}

/** Samples points along a segment to check for a clear line of sight through the wall grid. */
export function hasLineOfSight(level: LevelData, from: THREE.Vector2, to: THREE.Vector2): boolean {
  const dist = from.distanceTo(to);
  const steps = Math.ceil(dist / (CELL_SIZE * 0.4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const z = from.y + (to.y - from.y) * t;
    const { col, row } = worldToCell(x, z);
    if (isSolid(level, col, row)) return false;
  }
  return true;
}

/** Resolve a moving circle against the level's wall grid, one axis at a time. */
export function resolveCollision(
  level: LevelData,
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number
): { x: number; z: number } {
  let nx = x;
  let nz = z;

  const collidesAt = (px: number, pz: number): boolean => {
    const minCol = Math.floor((px - radius) / CELL_SIZE);
    const maxCol = Math.floor((px + radius) / CELL_SIZE);
    const minRow = Math.floor((pz - radius) / CELL_SIZE);
    const maxRow = Math.floor((pz + radius) / CELL_SIZE);
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (isSolid(level, col, row)) {
          const closestX = Math.max(col * CELL_SIZE, Math.min(px, (col + 1) * CELL_SIZE));
          const closestZ = Math.max(row * CELL_SIZE, Math.min(pz, (row + 1) * CELL_SIZE));
          const ddx = px - closestX;
          const ddz = pz - closestZ;
          if (ddx * ddx + ddz * ddz < radius * radius) return true;
        }
      }
    }
    return false;
  };

  if (!collidesAt(nx + dx, nz)) nx += dx;
  if (!collidesAt(nx, nz + dz)) nz += dz;

  return { x: nx, z: nz };
}
