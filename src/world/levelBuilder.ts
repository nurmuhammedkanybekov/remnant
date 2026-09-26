import * as THREE from "three";
import { textures } from "../fx/textures";
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
}

/** Builds a parsed level's geometry, props, lamps and exit into `scene`. */
export function buildLevel(scene: THREE.Scene, level: ParsedLevel): LevelData {
  const lampFixtures = buildGeometry(scene, level);
  const exit = buildExit(scene, level, level.exitCell);
  return { ...level, lampFixtures, exitSignMat: exit.signMat, exitLight: exit.light };
}

function buildGeometry(scene: THREE.Scene, level: ParsedLevel): LampFixture[] {
  const tex = textures();
  const theme = resolveTheme(level.def.theme);
  const { walls, crates, barrels } = level.props;

  // Walls: one instanced mesh, one draw call.
  const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
  const wallMat = new THREE.MeshStandardMaterial({
    color: theme.wallTint,
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
    color: theme.floorTint,
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

  // Shallow water: one instanced sheet per flooded cell, slightly above the floor.
  if (level.spawns.water.length) {
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1d3438,
      emissive: 0x04110f, // a faint sheen, so flooded floors read even in the dark
      roughness: 0.18,
      metalness: 0.15,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    const waterMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE), waterMat, level.spawns.water.length);
    level.spawns.water.forEach((w, i) => {
      dummy.position.set(w.pos.x, 0.32, w.pos.y);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      waterMesh.setMatrixAt(i, dummy.matrix);
    });
    waterMesh.instanceMatrix.needsUpdate = true;
    scene.add(waterMesh);
  }

  scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
  scene.background = new THREE.Color(theme.fog);
  // A cool, very dim fill so nothing is ever pure black.
  scene.add(new THREE.HemisphereLight(theme.skyLight, theme.groundLight, theme.fillIntensity));
  return fixtures;
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
