import * as THREE from "three";
import { buildDressing } from "./dressing";
import { setSkyScale, snowGroundTexture, textures, valleySkyTexture, type Surface } from "../fx/textures";
import { Snowfall } from "../fx/snow";
import { cliffCells, skyCells } from "./outdoors";
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
  /** Snow over the open-air cells (Part Two's outdoors); null underground. */
  weather: Snowfall | null;
}

/** Moves the weather along; call every frame with the camera's position. */
export function animateWeather(level: LevelData, dt: number, camera: THREE.Vector3): void {
  level.weather?.update(dt, camera);
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
export function buildLevel(scene: THREE.Scene, level: ParsedLevel, bumpMaps = true, skyScale = 1): LevelData {
  setSkyScale(skyScale);
  const { lampFixtures, wallMaterial, waterMaterials, weather } = buildGeometry(scene, level, bumpMaps);
  const exit = buildExit(scene, level, level.exitCell);
  return { ...level, lampFixtures, exitSignMat: exit.signMat, exitLight: exit.light, wallMaterial, waterMaterials, weather };
}

function buildGeometry(
  scene: THREE.Scene,
  level: ParsedLevel,
  bumpMaps: boolean
): { lampFixtures: LampFixture[]; wallMaterial: THREE.Material; waterMaterials: THREE.MeshStandardMaterial[]; weather: Snowfall | null } {
  const tex = textures();
  const theme = resolveTheme(level.def.theme);
  const cellKey = (pos: THREE.Vector2) => Math.floor(pos.y / CELL_SIZE) * level.cols + Math.floor(pos.x / CELL_SIZE);
  const { walls, crates, barrels } = level.props;

  // Walls: one instanced mesh, one draw call. On the mountain, walls that face
  // the open sky are cliffs instead (below), so they're left out of this one.
  const sky = skyCells(level);
  const cliffs = cliffCells(level, sky);
  const cellOf = (pos: THREE.Vector2) => Math.floor(pos.y / CELL_SIZE) * level.cols + Math.floor(pos.x / CELL_SIZE);
  const wallSurface =
    theme.walls === "timber" && tex.timber ? tex.timber : theme.walls === "rock" ? tex.rock : theme.walls === "tile" ? tex.tile : tex.wall;
  const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
  const wallMat = new THREE.MeshStandardMaterial({
    color: theme.wallTint,
    ...surfaceMaps(wallSurface, bumpMaps),
    bumpScale: theme.walls === "tile" ? 0.6 : 1.2,
    roughness: wallSurface.roughnessMap ? 1 : theme.walls === "tile" ? 0.45 : 0.92,
    metalness: 0.05,
  });
  varyPanels(wallMat);
  const plainWalls = walls.filter((pos) => !cliffs.has(cellOf(pos)));
  const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, plainWalls.length);
  const dummy = new THREE.Object3D();
  plainWalls.forEach((pos, i) => {
    dummy.position.set(pos.x, WALL_HEIGHT / 2, pos.y);
    // Rotate instances by random multiples of 90° so the pattern doesn't repeat obviously.
    dummy.rotation.y = (Math.floor((pos.x * 7 + pos.y * 13) % 4) * Math.PI) / 2;
    dummy.updateMatrix();
    wallMesh.setMatrixAt(i, dummy.matrix);
  });
  wallMesh.instanceMatrix.needsUpdate = true;
  scene.add(wallMesh);
  if (cliffs.size)
    buildCliffs(
      scene,
      level,
      walls.filter((pos) => cliffs.has(cellOf(pos))),
      bumpMaps
    );

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
  // A cavern's roof is the same rock as its walls.
  const ceilSurface = theme.walls === "rock" ? tex.rock : tex.ceiling;
  const ceilMat = new THREE.MeshStandardMaterial({
    ...surfaceMaps(ceilSurface, bumpMaps, level.cols * ceilPerCell, level.rows * ceilPerCell),
    ...(theme.walls === "rock" ? { color: theme.wallTint } : {}),
    roughness: 1,
  });
  if (sky.size === 0) {
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(width / 2, WALL_HEIGHT, depth / 2);
    scene.add(ceiling);
  } else {
    // Out in the open: a roof only over what's indoors, tile by tile, and the sky over the rest.
    const roofed: [number, number][] = [];
    for (let r = 0; r < level.rows; r++)
      for (let c = 0; c < level.cols; c++) if (!sky.has(r * level.cols + c) && level.def.map[r]?.[c] !== "#") roofed.push([c, r]);
    const tileMat = new THREE.MeshStandardMaterial({ ...surfaceMaps(ceilSurface, bumpMaps, ceilPerCell, ceilPerCell), roughness: 1 });
    const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE), tileMat, roofed.length);
    roofed.forEach(([c, r], i) => {
      dummy.position.set((c + 0.5) * CELL_SIZE, WALL_HEIGHT, (r + 0.5) * CELL_SIZE);
      dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      tiles.setMatrixAt(i, dummy.matrix);
    });
    tiles.instanceMatrix.needsUpdate = true;
    scene.add(tiles);

    // Snow lying in drifts on the open ground (not on the water).
    const water = new Set(level.spawns.water.map((w) => w.cell.row * level.cols + w.cell.col));
    const ground = [...sky].filter((k) => !water.has(k));
    const snowTex = snowGroundTexture();
    const snowMat = new THREE.MeshStandardMaterial({
      map: snowTex,
      transparent: true,
      depthWrite: false,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    // One sheet over all the open ground, its texture laid in world space, so the drifts run on across cells.
    const positions: number[] = [];
    const uvs: number[] = [];
    const SNOW_TILE = 11; // metres per repeat of the drift texture
    for (const k of ground) {
      const x0 = (k % level.cols) * CELL_SIZE;
      const z0 = Math.floor(k / level.cols) * CELL_SIZE;
      const x1 = x0 + CELL_SIZE;
      const z1 = z0 + CELL_SIZE;
      for (const [x, z] of [
        [x0, z0],
        [x0, z1],
        [x1, z0],
        [x1, z0],
        [x0, z1],
        [x1, z1],
      ]) {
        positions.push(x, 0.012, z);
        uvs.push(x / SNOW_TILE, z / SNOW_TILE);
      }
    }
    const sheet = new THREE.BufferGeometry();
    sheet.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    sheet.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    sheet.computeVertexNormals();
    const snow = new THREE.Mesh(sheet, snowMat);
    snow.renderOrder = 1;
    scene.add(snow);
  }

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
    // Under the open sky there's no ceiling to hang from: the lamp is strung on a wire from the nearest wall.
    if (sky.has(cellKey(lamp.pos))) stringLamp(scene, level, lamp.pos);
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

  buildDressing(scene, level);

  scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
  scene.background = sky.size ? valleySkyTexture(0x07090d, theme.fog, theme.skyline === "peaks") : new THREE.Color(theme.fog);
  const weather = sky.size ? new Snowfall(scene, sky, level.cols, level.rows, tex.glow) : null;
  // A cool, very dim fill so nothing is ever pure black.
  scene.add(new THREE.HemisphereLight(theme.skyLight, theme.groundLight, theme.fillIntensity));
  return { lampFixtures: fixtures, wallMaterial: wallMat, waterMaterials, weather };
}

/** Small deterministic hash of a cell, 0..1, so a level's cliffs come out the same every time. */
function cellHash(col: number, row: number, salt: number): number {
  const h = Math.sin(col * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** One rock block, shared by every cliff: a box whose sides are pushed in and out by noise and lean in towards the top. */
function cliffGeometry(): THREE.BufferGeometry {
  // Flush with the cell: the noise pushes the face at most a hand's width into the open, never into your way.
  const w = CELL_SIZE * 1.02;
  const geo = new THREE.BoxGeometry(w, WALL_HEIGHT, w, 5, 7, 5);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Height through the block, 0 at the foot, 1 at the top.
    const t = v.y / WALL_HEIGHT + 0.5;
    // The same offset for the same point, whichever face it belongs to, so the block stays closed.
    const n =
      Math.sin(v.x * 1.7 + v.y * 2.3) * 0.5 + Math.sin(v.z * 2.1 - v.y * 1.3 + 1.7) * 0.5 + Math.sin((v.x + v.z) * 3.1 + v.y * 4.2) * 0.25;
    const taper = 1 - 0.32 * t;
    const push = 1 + n * 0.09;
    v.x *= taper * push;
    v.z *= taper * push;
    // Ragged top: the upper ring of points rises and falls.
    if (t > 0.99) v.y += n * 0.35;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Cliffs: the walls around open ground on the mountain, as tall broken rock.
 * Each cell is one block of a height and turn of its own, overlapping its
 * neighbours so the face reads as one mass.
 */
function buildCliffs(scene: THREE.Scene, level: ParsedLevel, cells: THREE.Vector2[], bumpMaps: boolean): void {
  const tex = textures();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8b4ac,
    ...surfaceMaps(tex.rock, bumpMaps, 1, 2.5),
    bumpScale: 2,
    roughness: 0.96,
    metalness: 0,
  });
  // Snow lies on the ledges: lighter as the face goes up.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vCliffY;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvCliffY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vCliffY;")
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\n  float snowLine = smoothstep(5.0, 12.0, vCliffY);\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.81, 0.86), snowLine * 0.55);"
      );
  };
  const geo = cliffGeometry();
  const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
  const dummy = new THREE.Object3D();
  cells.forEach((pos, i) => {
    const col = Math.floor(pos.x / CELL_SIZE);
    const row = Math.floor(pos.y / CELL_SIZE);
    const h = WALL_HEIGHT * (2 + cellHash(col, row, 1) * 2.5);
    dummy.position.set(pos.x, h / 2, pos.y);
    // Quarter turns only: a square block turned any other way would poke its corners into the open floor.
    dummy.rotation.set(0, Math.floor(cellHash(col, row, 2) * 4) * (Math.PI / 2), 0);
    const spread = 1;
    dummy.scale.set(spread, h / WALL_HEIGHT, spread);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/** A wire from the lamp over an open-air cell to the top of the nearest wall (if one is close enough). */
function stringLamp(scene: THREE.Scene, level: ParsedLevel, pos: THREE.Vector2): void {
  const col = Math.floor(pos.x / CELL_SIZE);
  const row = Math.floor(pos.y / CELL_SIZE);
  for (let reach = 1; reach <= 3; reach++)
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (level.def.map[row + dr * reach]?.[col + dc * reach] !== "#") continue;
      // The wall's face, at the eaves.
      const to = new THREE.Vector3(pos.x + dc * (reach - 0.5) * CELL_SIZE, WALL_HEIGHT, pos.y + dr * (reach - 0.5) * CELL_SIZE);
      const from = new THREE.Vector3(pos.x, WALL_HEIGHT - 0.05, pos.y);
      const len = from.distanceTo(to);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 4), new THREE.MeshBasicMaterial({ color: 0x0c0c0c }));
      wire.position.copy(from).add(to).multiplyScalar(0.5);
      wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      scene.add(wire);
      return;
    }
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
