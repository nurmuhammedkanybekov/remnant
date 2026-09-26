import * as THREE from "three";
import { textures } from "../fx/textures";

export const CELL_SIZE = 4;
export const WALL_HEIGHT = 3.2;

/**
 * Map legend (one char = one CELL_SIZE x CELL_SIZE cell):
 *   #  wall                  .  floor
 *   S  player spawn          X  exit
 *   E  husk (standard enemy) H  brute (slow, tanky enemy)
 *   A  ammo                  M  medkit
 *   B  flashlight battery    K  keycard (if present, exit stays locked until taken)
 *   L  ceiling lamp          R  red emergency lamp
 *   C  crate stack (solid)   O  barrels (solid)
 *   0-9 note pickup, text from the level's notes table
 */
export interface LevelDef {
  id: string;
  name: string;
  subtitle: string;
  objective: string;
  map: string[];
  notes: Record<string, string>;
  /** Initial camera yaw in radians. 0 faces -Z (up the map), -PI/2 faces +X (right). */
  spawnYaw: number;
}

export interface NoteSpawn {
  pos: THREE.Vector2;
  text: string;
}

export interface LampSpawn {
  pos: THREE.Vector2;
  color: number;
  emergency: boolean;
  /** Filled in when geometry is built; LampSystem dims it when the lamp flickers off. */
  fixture?: THREE.Mesh;
}

export interface EnemySpawn {
  pos: THREE.Vector2;
  kind: "husk" | "brute";
}

export interface Spawns {
  playerStart: THREE.Vector2;
  enemies: EnemySpawn[];
  ammo: THREE.Vector2[];
  medkits: THREE.Vector2[];
  batteries: THREE.Vector2[];
  keycards: THREE.Vector2[];
  notes: NoteSpawn[];
  lamps: LampSpawn[];
  exit: THREE.Vector2;
}

export interface LevelData {
  def: LevelDef;
  cols: number;
  rows: number;
  /** solid[row][col] === true means that cell blocks movement and sight */
  solid: boolean[][];
  spawns: Spawns;
  /** Things the game needs to animate/modify (exit sign colour, etc.) */
  exitSignMat: THREE.MeshBasicMaterial;
  exitLight: THREE.PointLight;
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

export function buildLevel(scene: THREE.Scene, def: LevelDef): LevelData {
  const cols = Math.max(...def.map.map((r) => r.length));
  const rows = def.map.length;
  // Pad short rows with walls so a hand-authored map can never leak.
  const map = def.map.map((r) => r.padEnd(cols, "#"));

  const solid: boolean[][] = [];
  const spawns: Spawns = {
    playerStart: cellCenter(1, 1),
    enemies: [],
    ammo: [],
    medkits: [],
    batteries: [],
    keycards: [],
    notes: [],
    lamps: [],
    exit: cellCenter(cols - 2, rows - 2),
  };

  const walls: THREE.Vector2[] = [];
  const crates: THREE.Vector2[] = [];
  const barrels: THREE.Vector2[] = [];
  let exitCell = { col: cols - 2, row: rows - 2 };

  for (let row = 0; row < rows; row++) {
    const solidRow: boolean[] = [];
    for (let col = 0; col < cols; col++) {
      const ch = map[row][col];
      const c = cellCenter(col, row);
      let blocked = false;
      switch (ch) {
        case "#":
          blocked = true;
          walls.push(c);
          break;
        case "C":
          blocked = true;
          crates.push(c);
          break;
        case "O":
          blocked = true;
          barrels.push(c);
          break;
        case "S":
          spawns.playerStart = c;
          break;
        case "X":
          spawns.exit = c;
          exitCell = { col, row };
          break;
        case "E":
          spawns.enemies.push({ pos: c, kind: "husk" });
          break;
        case "H":
          spawns.enemies.push({ pos: c, kind: "brute" });
          break;
        case "A":
          spawns.ammo.push(c);
          break;
        case "M":
          spawns.medkits.push(c);
          break;
        case "B":
          spawns.batteries.push(c);
          break;
        case "K":
          spawns.keycards.push(c);
          break;
        case "L":
          spawns.lamps.push({ pos: c, color: 0xffd9a0, emergency: false });
          break;
        case "R":
          spawns.lamps.push({ pos: c, color: 0xff2a1a, emergency: true });
          break;
        default:
          if (ch >= "0" && ch <= "9" && def.notes[ch]) spawns.notes.push({ pos: c, text: def.notes[ch] });
          break;
      }
      solidRow.push(blocked);
    }
    solid.push(solidRow);
  }

  const partial = { def, cols, rows, solid, spawns } as LevelData;
  buildGeometry(scene, partial, walls, crates, barrels);
  const exit = buildExit(scene, partial, exitCell);
  partial.exitSignMat = exit.signMat;
  partial.exitLight = exit.light;
  return partial;
}

function buildGeometry(
  scene: THREE.Scene,
  level: LevelData,
  walls: THREE.Vector2[],
  crates: THREE.Vector2[],
  barrels: THREE.Vector2[]
): void {
  const tex = textures();

  // Walls: one instanced mesh, one draw call.
  const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
  const wallMat = new THREE.MeshStandardMaterial({
    map: tex.wall,
    bumpMap: tex.wall,
    bumpScale: 1.2,
    roughness: 0.92,
    metalness: 0.05,
  });
  const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, walls.length);
  const dummy = new THREE.Object3D();
  walls.forEach((pos, i) => {
    dummy.position.set(pos.x, WALL_HEIGHT / 2, pos.y);
    // Rotate instances by random multiples of 90° so the pattern doesn't repeat obviously.
    dummy.rotation.y = (Math.floor((pos.x * 7 + pos.y * 13) % 4) * Math.PI) / 2;
    dummy.updateMatrix();
    wallMesh.setMatrixAt(i, dummy.matrix);
  });
  wallMesh.instanceMatrix.needsUpdate = true;
  scene.add(wallMesh);

  const width = level.cols * CELL_SIZE;
  const depth = level.rows * CELL_SIZE;

  const floorTex = tex.floor.clone();
  floorTex.repeat.set(level.cols, level.rows);
  floorTex.needsUpdate = true;
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    bumpMap: floorTex,
    bumpScale: 0.8,
    roughness: 0.75,
    metalness: 0.15,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width / 2, 0, depth / 2);
  scene.add(floor);

  const ceilTex = tex.ceiling.clone();
  ceilTex.repeat.set(level.cols * 2, level.rows * 2);
  ceilTex.needsUpdate = true;
  const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(width / 2, WALL_HEIGHT, depth / 2);
  scene.add(ceiling);

  // Crate stacks
  if (crates.length) {
    const crateMat = new THREE.MeshStandardMaterial({ map: tex.crate, roughness: 0.9 });
    const crateGeo = new THREE.BoxGeometry(1.8, 1.8, 1.8);
    const perCell = 5;
    const crateMesh = new THREE.InstancedMesh(crateGeo, crateMat, crates.length * perCell);
    let i = 0;
    for (const c of crates) {
      const offsets = [
        [-0.95, 0.9, -0.95, 0.1],
        [0.95, 0.9, -0.9, -0.15],
        [-0.9, 0.9, 0.95, 0.2],
        [0.95, 0.9, 0.95, 0],
        [0.1, 2.7, -0.2, 0.35],
      ];
      for (const [ox, oy, oz, ry] of offsets) {
        dummy.position.set(c.x + ox, oy, c.y + oz);
        dummy.rotation.set(0, ry, 0);
        dummy.updateMatrix();
        crateMesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    crateMesh.instanceMatrix.needsUpdate = true;
    scene.add(crateMesh);
  }

  // Barrel clusters
  if (barrels.length) {
    const barrelMat = new THREE.MeshStandardMaterial({ map: tex.barrel, roughness: 0.6, metalness: 0.4 });
    const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.5, 16);
    const barrelMesh = new THREE.InstancedMesh(barrelGeo, barrelMat, barrels.length * 4);
    let i = 0;
    for (const c of barrels) {
      for (const [ox, oz] of [
        [-0.8, -0.7],
        [0.7, -0.8],
        [-0.6, 0.8],
        [0.85, 0.75],
      ]) {
        dummy.position.set(c.x + ox, 0.75, c.y + oz);
        dummy.rotation.set(0, ox * 3, 0);
        dummy.updateMatrix();
        barrelMesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    barrelMesh.instanceMatrix.needsUpdate = true;
    scene.add(barrelMesh);
  }

  // Lamp fixtures (the lights themselves are pooled by LampSystem).
  const fixtureGeo = new THREE.BoxGeometry(1.4, 0.08, 0.35);
  for (const lamp of level.spawns.lamps) {
    const mat = new THREE.MeshBasicMaterial({ color: lamp.color });
    const fixture = new THREE.Mesh(fixtureGeo, mat);
    fixture.position.set(lamp.pos.x, WALL_HEIGHT - 0.05, lamp.pos.y);
    fixture.name = "lampFixture";
    scene.add(fixture);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex.glow,
        color: lamp.color,
        transparent: true,
        opacity: lamp.emergency ? 0.5 : 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    halo.scale.set(2.4, 1.2, 1);
    halo.position.set(lamp.pos.x, WALL_HEIGHT - 0.2, lamp.pos.y);
    halo.name = "lampHalo";
    fixture.userData.halo = halo;
    lamp.fixture = fixture;
    scene.add(halo);
  }

  scene.fog = new THREE.FogExp2(0x050607, 0.06);
  scene.background = new THREE.Color(0x050607);
  // A cool, very dim fill so nothing is ever pure black.
  scene.add(new THREE.HemisphereLight(0x55606a, 0x1a1510, 1.1));
}

/** Door + glowing sign on the wall next to the exit cell. */
function buildExit(
  scene: THREE.Scene,
  level: LevelData,
  cell: { col: number; row: number }
): { signMat: THREE.MeshBasicMaterial; light: THREE.PointLight } {
  const tex = textures();
  const center = cellCenter(cell.col, cell.row);
  // Pick the first solid neighbour to mount the door on.
  const dirs = [
    { dc: 1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: -1 },
  ];
  const d = dirs.find((d) => isSolid(level, cell.col + d.dc, cell.row + d.dr)) ?? dirs[0];
  const group = new THREE.Group();
  group.position.set(center.x + d.dc * (CELL_SIZE / 2 - 0.02), 0, center.y + d.dr * (CELL_SIZE / 2 - 0.02));
  group.rotation.y = Math.atan2(-d.dc, -d.dr);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2d2a, metalness: 0.7, roughness: 0.4 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3b4640, metalness: 0.6, roughness: 0.5 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.5, 0.1), doorMat);
  door.position.set(0, 1.25, 0);
  group.add(door);
  for (const x of [-0.98, 0.98]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.2), frameMat);
    post.position.set(x, 1.3, 0);
    group.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.2), frameMat);
  lintel.position.set(0, 2.6, 0);
  group.add(lintel);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.12), frameMat);
  bar.position.set(0, 1.1, 0.08);
  group.add(bar);

  const signMat = new THREE.MeshBasicMaterial({ map: tex.exitSign, color: 0xffffff });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), signMat);
  sign.position.set(0, 2.9, 0.12);
  group.add(sign);

  const light = new THREE.PointLight(0x4dff7a, 6, 9, 2);
  light.position.set(0, 2.6, 0.8);
  group.add(light);
  scene.add(group);
  return { signMat, light };
}

/** Samples along a segment to check for a clear line through the wall grid. */
export function hasLineOfSight(level: LevelData, from: THREE.Vector2, to: THREE.Vector2): boolean {
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
export function raycastWorld(level: LevelData, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): WorldHit | null {
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
export function resolveCollision(level: LevelData, x: number, z: number, dx: number, dz: number, radius: number): { x: number; z: number } {
  let nx = x;
  let nz = z;
  if (!circleHitsWall(level, nx + dx, nz, radius)) nx += dx;
  if (!circleHitsWall(level, nx, nz + dz, radius)) nz += dz;
  return { x: nx, z: nz };
}

export function circleHitsWall(level: LevelData, px: number, pz: number, radius: number): boolean {
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
export function randomFloorNear(level: LevelData, x: number, z: number, radiusCells: number): THREE.Vector2 {
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
