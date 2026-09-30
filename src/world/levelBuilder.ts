import * as THREE from "three";
import { textures, type Surface } from "../fx/textures";
import { CELL_SIZE, WALL_HEIGHT, cellCenter, isSolid, type Cell } from "./grid";
import type { ParsedLevel } from "./levelParser";
import { resolveTheme } from "./theme";

/** Ceiling-lamp meshes the LampSystem dims when a lamp flickers off. */
export interface LampFixture {
  mesh: THREE.Mesh;
  halo: THREE.Sprite;
}

/** A parsed level plus the scene objects gameplay needs to reach at runtime. */
export interface LevelData extends ParsedLevel {
  /** Parallel to `spawns.lamps`. */
  lampFixtures: LampFixture[];
  exitSignMat: THREE.MeshBasicMaterial;
  exitLight: THREE.PointLight;
  /** The walls' material, so a loose panel can look like the wall around it. */
  wallMaterial: THREE.Material;
  /** The water's layers, whose ripples `animateWater` moves. */
  waterMaterials: THREE.MeshStandardMaterial[];
}

/** Drifts the water's ripples: each layer its own way, so they cross and never look like a pattern. */
export function animateWater(level: LevelData, time: number): void {
  level.waterMaterials.forEach((m, i) => {
    const map = m.normalMap;
    if (!map) return;
    if (i === 0) map.offset.set(time * 0.021, time * 0.013);
    else map.offset.set(-time * 0.034, time * 0.027);
  });
}

let rippleTexture: THREE.CanvasTexture | null = null;

/**
 * A tileable normal map of small ripples: a height field made of waves whose
 * frequencies are whole numbers over the tile, so it wraps seamlessly from
 * one flooded cell to the next, turned into normals.
 */
function waterNormals(): THREE.CanvasTexture {
  if (rippleTexture) return rippleTexture;
  const n = 128;
  const waves = [
    [3, 1, 0.9, 0.3],
    [-2, 4, 0.7, 1.7],
    [5, -3, 0.45, 2.9],
    [1, 6, 0.4, 0.8],
    [-7, 2, 0.3, 4.1],
    [8, 5, 0.2, 5.3],
  ];
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = 0;
      for (const [fx, fy, a, p] of waves) v += a * Math.sin(((fx * x + fy * y) / n) * Math.PI * 2 + p);
      h[y * n + x] = v;
    }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  const at = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 1.6;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 1.6;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * n + x) * 4;
      img.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  rippleTexture = new THREE.CanvasTexture(canvas);
  rippleTexture.wrapS = rippleTexture.wrapT = THREE.RepeatWrapping;
  return rippleTexture;
}

/**
 * Material maps for a surface, repeated `rx` × `ry` times. `detail` (a
 * quality option) turns on normal maps — or, for a painted surface, a bump
 * map from its colour.
 */
function surfaceMaps(s: Surface, detail: boolean, rx = 1, ry = 1): Partial<THREE.MeshStandardMaterialParameters> {
  const rep = (t: THREE.Texture | null) => {
    if (!t || (rx === 1 && ry === 1)) return t;
    const c = t.clone();
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    return c;
  };
  const map = rep(s.map);
  return {
    map,
    normalMap: detail ? rep(s.normalMap) : null,
    bumpMap: detail && !s.normalMap ? map : null,
    roughnessMap: rep(s.roughnessMap),
  };
}

/**
 * Every wall block shares one texture, so without help the same stains line
 * up on every face. This picks one of four variants per face — mirrored
 * and/or shifted half a texture sideways, which keeps the panel seams on
 * the seams — from a hash of the block's position and the face's direction.
 */
function varyPanels(mat: THREE.MeshStandardMaterial): void {
  const uvs = ["vMapUv", "vNormalMapUv", "vRoughnessMapUv", "vBumpMapUv"];
  const defines = ["USE_MAP", "USE_NORMALMAP", "USE_ROUGHNESSMAP", "USE_BUMPMAP"];
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
      #ifdef USE_INSTANCING
      {
        vec3 cell = floor(instanceMatrix[3].xyz + normal * 0.5);
        float h = fract(sin(dot(cell.xz, vec2(12.9898, 78.233)) + normal.x * 3.1 + normal.z * 5.7) * 43758.5453);
        float flip = step(0.5, h);
        float shift = step(0.5, fract(h * 4.0)) * 0.5;
        ${uvs.map((v, i) => `#ifdef ${defines[i]}\n        ${v}.x = mix(${v}.x, 1.0 - ${v}.x, flip) + shift;\n        #endif`).join("\n        ")}
      }
      #endif`
    );
  };
}

/** Builds a parsed level's geometry, props, lamps and exit into `scene`. `bumpMaps` is a quality option. */
export function buildLevel(scene: THREE.Scene, level: ParsedLevel, bumpMaps = true): LevelData {
  const { lampFixtures, wallMaterial, waterMaterials } = buildGeometry(scene, level, bumpMaps);
  const exit = buildExit(scene, level, level.exitCell);
  return { ...level, lampFixtures, exitSignMat: exit.signMat, exitLight: exit.light, wallMaterial, waterMaterials };
}

function buildGeometry(
  scene: THREE.Scene,
  level: ParsedLevel,
  bumpMaps: boolean
): { lampFixtures: LampFixture[]; wallMaterial: THREE.Material; waterMaterials: THREE.MeshStandardMaterial[] } {
  const tex = textures();
  const theme = resolveTheme(level.def.theme);
  const { walls, crates, barrels } = level.props;

  // Walls: one instanced mesh, one draw call.
  const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
  const wallMat = new THREE.MeshStandardMaterial({
    color: theme.wallTint,
    ...surfaceMaps(tex.wall, bumpMaps),
    bumpScale: 1.2,
    roughness: tex.wall.roughnessMap ? 1 : 0.92,
    metalness: 0.05,
  });
  varyPanels(wallMat);
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

  const floorMat = new THREE.MeshStandardMaterial({
    color: theme.floorTint,
    ...surfaceMaps(tex.floor, bumpMaps, level.cols, level.rows),
    bumpScale: 0.8,
    roughness: tex.floor.roughnessMap ? 0.9 : 0.75,
    metalness: 0.15,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width / 2, 0, depth / 2);
  scene.add(floor);

  // The photo ceiling holds a whole cell's tiles; the painted one a quarter.
  const ceilPerCell = tex.ceiling.photo ? 1 : 2;
  const ceilMat = new THREE.MeshStandardMaterial({
    ...surfaceMaps(tex.ceiling, bumpMaps, level.cols * ceilPerCell, level.rows * ceilPerCell),
    roughness: 1,
  });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(width / 2, WALL_HEIGHT, depth / 2);
  scene.add(ceiling);

  // Crate stacks
  if (crates.length) {
    const crateMat = new THREE.MeshStandardMaterial({ ...surfaceMaps(tex.crate, bumpMaps), roughness: 0.9 });
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
    const barrelMat = new THREE.MeshStandardMaterial({ ...surfaceMaps(tex.barrel, bumpMaps), roughness: 0.8, metalness: 0.4 });
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
  const fixtures: LampFixture[] = [];
  for (const lamp of level.spawns.lamps) {
    const mat = new THREE.MeshBasicMaterial({ color: lamp.color });
    const fixture = new THREE.Mesh(fixtureGeo, mat);
    fixture.position.set(lamp.pos.x, WALL_HEIGHT - 0.05, lamp.pos.y);
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
    fixtures.push({ mesh: fixture, halo });
    scene.add(halo);
  }

  // Shallow water: two thin layers over each flooded cell, dark and glossy,
  // with ripples that drift in different directions (see `animateWater`), so
  // your light and the lamps glint and move on it. Most of the floor beneath
  // is hidden; you see the water, not the tiles.
  const waterMaterials: THREE.MeshStandardMaterial[] = [];
  if (level.spawns.water.length) {
    const ripples = waterNormals();
    const layers = [
      { y: 0.3, opacity: 0.84, color: 0x0e2022, rough: 0.07, repeat: 1, scale: 0.8 },
      { y: 0.305, opacity: 0.35, color: 0x1a3033, rough: 0.04, repeat: 2, scale: 0.45 },
    ];
    for (const l of layers) {
      const map = ripples.clone();
      map.needsUpdate = true;
      map.repeat.set(l.repeat, l.repeat);
      const mat = new THREE.MeshStandardMaterial({
        color: l.color,
        emissive: 0x020909, // a faint sheen, so flooded floors read even in the dark
        roughness: l.rough,
        metalness: 0.05,
        normalMap: map,
        normalScale: new THREE.Vector2(l.scale, l.scale),
        transparent: true,
        opacity: l.opacity,
        depthWrite: false,
      });
      waterMaterials.push(mat);
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE), mat, level.spawns.water.length);
      level.spawns.water.forEach((w, i) => {
        dummy.position.set(w.pos.x, l.y, w.pos.y);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.renderOrder = 1;
      scene.add(mesh);
    }
  }

  scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
  scene.background = new THREE.Color(theme.fog);
  // A cool, very dim fill so nothing is ever pure black.
  scene.add(new THREE.HemisphereLight(theme.skyLight, theme.groundLight, theme.fillIntensity));
  return { lampFixtures: fixtures, wallMaterial: wallMat, waterMaterials };
}

/** Door + glowing sign on the wall next to the exit cell. */
function buildExit(scene: THREE.Scene, level: ParsedLevel, cell: Cell): { signMat: THREE.MeshBasicMaterial; light: THREE.PointLight } {
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
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x3b4640,
    ...(tex.plate ? surfaceMaps(tex.plate, true) : {}),
    metalness: 0.6,
    roughness: tex.plate?.roughnessMap ? 0.9 : 0.5,
  });
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
