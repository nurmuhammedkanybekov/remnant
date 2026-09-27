import * as THREE from "three";
import { textures } from "../fx/textures";
import { CELL_SIZE, WALL_HEIGHT, isSolid, type LevelGrid } from "./grid";
import type { CellSpawn, DoorSpawn } from "./levelParser";

/** Something the player can use with the interact key. */
export interface Interactable {
  readonly pos: THREE.Vector2;
  /** How close (world units, horizontally) the player must be. */
  readonly reach: number;
  /** What pressing interact will do, e.g. "OPEN DOOR". Null when there's nothing to do. */
  readonly prompt: string | null;
  interact(): void;
  update(dt: number, time: number): void;
}

const GREEN = 0x4dff7a;
const RED = 0xff3a2a;
const AMBER = 0xffb040;

function glow(color: number, size: number, opacity = 0.8): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: textures().glow,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  s.scale.setScalar(size);
  return s;
}

const metal = (color: number, roughness = 0.45) => new THREE.MeshStandardMaterial({ color, metalness: 0.65, roughness });

/** Hazard paint along a door's bottom edge: yellow, or red on security doors. */
function hazardMaterial(security: boolean): THREE.MeshStandardMaterial {
  const hazard = textures().hazard;
  if (!hazard) return new THREE.MeshStandardMaterial({ color: security ? 0xa83a22 : 0xb88a1a, roughness: 0.8 });
  const rep = (t: THREE.Texture | null) => {
    if (!t) return null;
    const c = t.clone();
    // Keep the stripes square-ish on a 4 m × 0.22 m face.
    c.repeat.set(CELL_SIZE / 0.5, 0.44);
    c.needsUpdate = true;
    return c;
  };
  return new THREE.MeshStandardMaterial({
    color: security ? 0xff6a4a : 0xffffff,
    map: rep(hazard.map),
    normalMap: rep(hazard.normalMap),
    roughnessMap: rep(hazard.roughnessMap),
    metalness: 0.3,
    roughness: 1,
  });
}

/**
 * Rescales a box's UVs so one texture repeat covers `tile` metres on every
 * face — otherwise the thin edges squash a whole texture into a few centimetres.
 */
function metresUV(geo: THREE.BoxGeometry, tile: number): THREE.BoxGeometry {
  const { width: w, height: h, depth: d } = geo.parameters;
  // BoxGeometry faces, 4 vertices each: +x, -x, +y, -y, +z, -z.
  const sizes = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const [su, sv] = sizes[Math.floor(i / 4)];
    uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
  }
  return geo;
}

/** Door slabs: scuffed steel plate where the photo material is available. */
function plated(color: number): THREE.MeshStandardMaterial {
  const plate = textures().plate;
  if (!plate) return metal(color);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(2.2),
    map: plate.map,
    normalMap: plate.normalMap,
    roughnessMap: plate.roughnessMap,
    metalness: 0.65,
    roughness: 0.85,
  });
}

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/**
 * A sliding blast door filling one corridor cell. Blocks movement, sight and
 * pathfinding until opened; then it retracts into the ceiling for good.
 * Security doors stay locked until `isUnlocked()` says otherwise.
 */
export class Door implements Interactable {
  readonly pos: THREE.Vector2;
  readonly reach = CELL_SIZE * 0.5 + 1.4;
  readonly security: boolean;
  isOpen = false;
  /** Security doors ask this before opening. */
  isUnlocked: () => boolean = () => true;
  onOpen: ((door: Door) => void) | null = null;
  onLocked: ((door: Door) => void) | null = null;

  private readonly group = new THREE.Group();
  private readonly slab: THREE.Group;
  private readonly lights: THREE.Sprite[] = [];
  private readonly lightMat: THREE.MeshBasicMaterial;
  private openT = 0;

  constructor(
    scene: THREE.Scene,
    private readonly level: LevelGrid,
    readonly spawn: DoorSpawn
  ) {
    this.pos = spawn.pos;
    this.security = spawn.security;
    const { col, row } = spawn.cell;
    // Corridor runs north–south if the cells east and west are walls: the slab then spans X.
    const spansX = isSolid(level, col - 1, row) && isSolid(level, col + 1, row);
    this.group.position.set(spawn.pos.x, 0, spawn.pos.y);
    this.group.rotation.y = spansX ? 0 : Math.PI / 2;

    this.slab = new THREE.Group();
    const body = new THREE.Mesh(
      metresUV(new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, 0.3), 2),
      plated(this.security ? 0x3a3530 : 0x2f3833)
    );
    body.position.y = WALL_HEIGHT / 2;
    this.slab.add(body);
    const ribMat = metal(0x1e2422, 0.6);
    for (const y of [0.7, 1.6, 2.5]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE - 0.3, 0.12, 0.4), ribMat);
      rib.position.y = y;
      this.slab.add(rib);
    }
    // Hazard stripe along the bottom edge.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE, 0.22, 0.34), hazardMaterial(this.security));
    stripe.position.y = 0.11;
    this.slab.add(stripe);
    this.group.add(this.slab);

    // Status lights on both faces.
    this.lightMat = new THREE.MeshBasicMaterial({ color: this.security ? RED : GREEN });
    for (const z of [-0.2, 0.2]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.04), this.lightMat);
      panel.position.set(CELL_SIZE / 2 - 0.45, 1.5, z);
      this.slab.add(panel);
      const g = glow(this.security ? RED : GREEN, 0.9, 0.6);
      g.position.set(CELL_SIZE / 2 - 0.45, 1.5, z * 2);
      this.slab.add(g);
      this.lights.push(g);
    }
    scene.add(this.group);
  }

  get prompt(): string | null {
    if (this.isOpen) return null;
    if (this.security && !this.isUnlocked()) return "LOCKED — NEEDS KEYCARD";
    return this.security ? "USE KEYCARD" : "OPEN DOOR";
  }

  interact(): void {
    if (this.isOpen) return;
    if (this.security && !this.isUnlocked()) {
      this.onLocked?.(this);
      return;
    }
    this.open();
    this.onOpen?.(this);
  }

  /** Opens without callbacks. `instant` skips the animation (checkpoint restore). */
  open(instant = false): void {
    this.isOpen = true;
    this.level.solid[this.spawn.cell.row][this.spawn.cell.col] = false;
    if (instant) this.openT = 1;
  }

  update(dt: number, time: number): void {
    if (this.security && !this.isOpen) {
      const color = this.isUnlocked() ? GREEN : RED;
      this.lightMat.color.setHex(color);
      for (const l of this.lights) l.material.color.setHex(color);
    }
    if (this.isOpen && this.openT < 1) this.openT = Math.min(1, this.openT + dt / 1.1);
    // Judder while the motor strains, then slide up into the ceiling.
    const k = easeInOut(this.openT);
    this.slab.position.y = k * (WALL_HEIGHT + 0.2) + (this.openT > 0 && this.openT < 1 ? Math.sin(time * 60) * 0.01 : 0);
    this.group.visible = this.openT < 1;
  }
}

/** A diesel generator. Loud to start, and it keeps humming — creatures come to see what the noise is. */
export class Generator implements Interactable {
  readonly pos: THREE.Vector2;
  readonly reach = CELL_SIZE * 0.5 + 1.3;
  running = false;
  onStart: ((g: Generator) => void) | null = null;

  private readonly body = new THREE.Group();
  private readonly fan: THREE.Mesh;
  private readonly lamp: THREE.Sprite;
  private readonly lampMat: THREE.MeshBasicMaterial;

  constructor(
    scene: THREE.Scene,
    readonly spawn: CellSpawn
  ) {
    this.pos = spawn.pos;
    this.body.position.set(spawn.pos.x, 0, spawn.pos.y);

    const housing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 2.0), metal(0x3c4a3a, 0.55));
    housing.position.y = 0.95;
    this.body.add(housing);
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.2, 2.4), metal(0x1b1f1c, 0.7));
    base.position.y = 0.1;
    this.body.add(base);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 10), metal(0x222222, 0.4));
    exhaust.position.set(-0.9, 2.3, -0.6);
    this.body.add(exhaust);
    this.fan = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 6), metal(0x151515, 0.5));
    this.fan.rotation.z = Math.PI / 2;
    this.fan.position.set(1.34, 1.0, 0);
    this.body.add(this.fan);
    this.lampMat = new THREE.MeshBasicMaterial({ color: RED });
    const lampMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), this.lampMat);
    lampMesh.position.set(0.8, 1.85, 1.0);
    this.body.add(lampMesh);
    this.lamp = glow(RED, 1.1);
    this.lamp.position.copy(lampMesh.position);
    this.body.add(this.lamp);
    scene.add(this.body);
  }

  get prompt(): string | null {
    return this.running ? null : "START GENERATOR";
  }

  interact(): void {
    if (this.running) return;
    this.start();
    this.onStart?.(this);
  }

  start(): void {
    this.running = true;
    this.lampMat.color.setHex(GREEN);
    this.lamp.material.color.setHex(GREEN);
  }

  update(dt: number, time: number): void {
    if (!this.running) {
      this.lamp.material.opacity = 0.5 + 0.4 * Math.sin(time * 4);
      return;
    }
    this.fan.rotation.x += dt * 18;
    this.body.position.y = Math.sin(time * 70) * 0.006;
  }
}

/** A wall-phone on a post. Plays its script once. */
export class Intercom implements Interactable {
  readonly pos: THREE.Vector2;
  readonly reach = 1.9;
  used = false;
  onUse: ((i: Intercom) => void) | null = null;

  private readonly light: THREE.Sprite;

  constructor(
    scene: THREE.Scene,
    readonly spawn: CellSpawn,
    readonly index: number
  ) {
    this.pos = spawn.pos;
    const g = new THREE.Group();
    g.position.set(spawn.pos.x, 0, spawn.pos.y);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.1), metal(0x2a2a2a));
    post.position.y = 0.65;
    g.add(post);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.22), metal(0x6b5a2c, 0.6));
    box.position.y = 1.45;
    g.add(box);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.02), metal(0x111111, 0.8));
    grille.position.set(0, 1.52, 0.12);
    g.add(grille);
    this.light = glow(AMBER, 0.7);
    this.light.position.set(0.12, 1.66, 0.14);
    g.add(this.light);
    scene.add(g);
  }

  get prompt(): string | null {
    return this.used ? null : "ANSWER INTERCOM";
  }

  interact(): void {
    if (this.used) return;
    this.used = true;
    this.onUse?.(this);
  }

  update(_dt: number, time: number): void {
    this.light.material.opacity = this.used ? 0.12 : Math.sin(time * 6) > 0 ? 0.9 : 0.15;
  }
}

/** The consortium's self-destruct panel at the top of the lift shaft. */
export class DetonatorConsole implements Interactable {
  readonly pos: THREE.Vector2;
  readonly reach = 2;
  used = false;
  onUse: (() => void) | null = null;
  /** Why it can't be used yet (the boss is still guarding it), or null. */
  lockedReason: () => string | null = () => null;

  private readonly glowSprite: THREE.Sprite;

  constructor(scene: THREE.Scene, spawn: CellSpawn) {
    this.pos = spawn.pos;
    const g = new THREE.Group();
    g.position.set(spawn.pos.x, 0, spawn.pos.y);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.6), metal(0x2c2f33));
    pedestal.position.y = 0.5;
    g.add(pedestal);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.75), metal(0x44484e));
    top.position.set(0, 1.05, 0);
    top.rotation.x = -0.35;
    g.add(top);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.1, 16), new THREE.MeshBasicMaterial({ color: RED }));
    button.position.set(0, 1.13, 0);
    button.rotation.x = -0.35;
    g.add(button);
    this.glowSprite = glow(RED, 1.4);
    this.glowSprite.position.set(0, 1.25, 0);
    g.add(this.glowSprite);
    scene.add(g);
  }

  get prompt(): string | null {
    return this.used ? null : (this.lockedReason() ?? "TRIGGER THE CHARGES");
  }

  interact(): void {
    if (this.used || this.lockedReason()) return;
    this.used = true;
    this.onUse?.();
  }

  update(_dt: number, time: number): void {
    this.glowSprite.material.opacity = 0.45 + 0.4 * Math.sin(time * 3);
  }
}

/** A floor beacon marking a checkpoint; dims once reached. */
export class CheckpointMarker {
  reached = false;
  private readonly light: THREE.Sprite;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  constructor(
    scene: THREE.Scene,
    readonly spawn: CellSpawn
  ) {
    const g = new THREE.Group();
    g.position.set(spawn.pos.x, 0, spawn.pos.y);
    this.light = glow(GREEN, 1.6, 0.5);
    this.light.position.y = 0.1;
    g.add(this.light);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 0.95, 32),
      new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    this.ring = ring;
    scene.add(g);
  }

  update(time: number): void {
    this.light.material.opacity = this.reached ? 0.1 : 0.35 + 0.2 * Math.sin(time * 2.5);
    this.ring.material.opacity = this.reached ? 0.08 : 0.35;
  }
}
