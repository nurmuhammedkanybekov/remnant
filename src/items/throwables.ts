import * as THREE from "three";
import { CELL_SIZE, isSolid, WALL_HEIGHT, type LevelGrid } from "../world/grid";

/**
 * Bottles and cans you throw to make a noise somewhere else. A creature that
 * hears it goes to look, which is a way past it without spending a bullet.
 *
 * The flight is plain ballistics, stepped in small slices so a fast throw
 * can't pass through a wall; the first wall, floor or ceiling it meets is
 * where it breaks. Both co-op players fly the same throw, so both see and
 * hear it; only the thrower's copy makes the noise the creatures hear.
 */

/** Launch speed (units per second) and the upward tilt added to your aim. */
export const THROW_SPEED = 13;
const THROW_LIFT = 0.18;
const GRAVITY = 16;
/** Seconds after which a throw that somehow never landed is dropped. */
const MAX_FLIGHT = 4;
/** How far the smash carries (world units, before a creature's hearing). */
export const SMASH_NOISE = 16;

export interface Landing {
  pos: THREE.Vector3;
  /** Thrown by this player (their copy makes the noise). */
  own: boolean;
}

interface Flight {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  own: boolean;
}

/** Where a throw from `eye` along `look` starts and how fast it goes. */
export function throwFrom(eye: THREE.Vector3, look: THREE.Vector3): { pos: THREE.Vector3; vel: THREE.Vector3 } {
  const dir = look.clone().normalize();
  dir.y += THROW_LIFT;
  dir.normalize();
  return {
    pos: eye
      .clone()
      .addScaledVector(look, 0.4)
      .add(new THREE.Vector3(0, -0.15, 0)),
    vel: dir.multiplyScalar(THROW_SPEED),
  };
}

/**
 * Steps a flight by `dt`. Returns the point where it hit something, or null
 * if it's still in the air. Moves `pos` and bends `vel` in place.
 */
export function stepFlight(level: LevelGrid, pos: THREE.Vector3, vel: THREE.Vector3, dt: number): THREE.Vector3 | null {
  const slices = Math.max(1, Math.ceil((vel.length() * dt) / 0.2));
  const h = dt / slices;
  for (let i = 0; i < slices; i++) {
    const prev = pos.clone();
    vel.y -= GRAVITY * h;
    pos.addScaledVector(vel, h);
    const col = Math.floor(pos.x / CELL_SIZE);
    const row = Math.floor(pos.z / CELL_SIZE);
    if (isSolid(level, col, row)) return prev;
    if (pos.y <= 0.05) return pos.setY(0.05);
    if (pos.y >= WALL_HEIGHT - 0.05) return pos.setY(WALL_HEIGHT - 0.05);
  }
  return null;
}

export class Throwables {
  private readonly flights: Flight[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly level: LevelGrid
  ) {}

  launch(pos: THREE.Vector3, vel: THREE.Vector3, own: boolean): void {
    const mesh = bottleMesh();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const spin = new THREE.Vector3(6 + Math.random() * 4, Math.random() * 3, 2 + Math.random() * 3);
    this.flights.push({ mesh, vel: vel.clone(), spin, age: 0, own });
  }

  /** Moves everything in the air; returns what landed this frame. */
  update(dt: number): Landing[] {
    const out: Landing[] = [];
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.age += dt;
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.y += f.spin.y * dt;
      f.mesh.rotation.z += f.spin.z * dt;
      const hit = stepFlight(this.level, f.mesh.position, f.vel, dt);
      if (!hit && f.age < MAX_FLIGHT) continue;
      out.push({ pos: (hit ?? f.mesh.position).clone(), own: f.own });
      this.scene.remove(f.mesh);
      this.flights.splice(i, 1);
    }
    return out;
  }

  dispose(): void {
    for (const f of this.flights) this.scene.remove(f.mesh);
    this.flights.length = 0;
  }
}

let shared: { glass: THREE.Material; body: THREE.BufferGeometry; neck: THREE.BufferGeometry } | null = null;

/** A green glass bottle (also the pickup's model). */
export function bottleMesh(): THREE.Object3D {
  shared ??= {
    glass: new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.8 }),
    body: new THREE.CylinderGeometry(0.055, 0.06, 0.2, 10),
    neck: new THREE.CylinderGeometry(0.02, 0.035, 0.1, 8),
  };
  const g = new THREE.Group();
  g.add(new THREE.Mesh(shared.body, shared.glass));
  const neck = new THREE.Mesh(shared.neck, shared.glass);
  neck.position.y = 0.15;
  g.add(neck);
  return g;
}
