import * as THREE from "three";
import { textures } from "../fx/textures";
import { isSolid, worldToCell, WALL_HEIGHT, type LevelGrid } from "../world/grid";

const GRAVITY = 9;
const MAX_LIFE = 4;
/** Player hit test: a vertical capsule this wide around the player's position. */
const PLAYER_RADIUS = 0.45;

interface Glob {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  life: number;
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
}

/**
 * Lobbed acid: spat by Spitters and the Remnant. Globs fly on a ballistic
 * arc, so there's time to see them coming and step aside.
 */
export class Projectiles {
  private readonly globs: Glob[] = [];
  private readonly geo = new THREE.SphereGeometry(0.11, 10, 8);
  private readonly mat = new THREE.MeshStandardMaterial({ color: 0x9adf3a, emissive: 0x8adf2a, emissiveIntensity: 0.9, roughness: 0.2 });

  /** Fired when a glob hits the player. */
  onHitPlayer: ((damage: number, from: THREE.Vector2) => void) | null = null;
  /** Fired when a glob bursts on a wall or the floor (or the player). */
  onSplash: ((point: THREE.Vector3) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly level: LevelGrid
  ) {}

  get active(): number {
    return this.globs.length;
  }

  /** Launch from `from` so the arc passes through `target`, flying at roughly `speed`. */
  spawn(from: THREE.Vector3, target: THREE.Vector3, speed: number, damage: number): void {
    const flat = new THREE.Vector2(target.x - from.x, target.z - from.z);
    const d = Math.max(0.5, flat.length());
    const t = d / speed;
    flat.divideScalar(d).multiplyScalar(speed);
    const vy = (target.y - from.y) / t + 0.5 * GRAVITY * t;
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.copy(from);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textures().glow,
        color: 0x9aff4a,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.scale.setScalar(0.45);
    mesh.add(glow);
    this.scene.add(mesh);
    this.globs.push({ pos: from.clone(), vel: new THREE.Vector3(flat.x, vy, flat.y), damage, life: MAX_LIFE, mesh, glow });
  }

  /** `player` is the player's feet position; `eyeHeight` the top of their body. */
  update(dt: number, player: THREE.Vector3, eyeHeight: number, playerDead: boolean): void {
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i];
      g.life -= dt;
      g.vel.y -= GRAVITY * dt;
      const prev = g.pos.clone();
      g.pos.addScaledVector(g.vel, dt);
      g.mesh.position.copy(g.pos);
      g.mesh.scale.set(1, 1 + Math.min(1, g.vel.length() / 20) * 0.6, 1);
      g.mesh.lookAt(g.pos.clone().add(g.vel));
      g.mesh.rotateX(Math.PI / 2);

      if (!playerDead && hitsPlayer(prev, g.pos, player, eyeHeight)) {
        this.onHitPlayer?.(g.damage, new THREE.Vector2(prev.x, prev.z));
        this.burst(i, g.pos);
        continue;
      }
      const { col, row } = worldToCell(g.pos.x, g.pos.z);
      if (g.pos.y <= 0.05 || g.pos.y >= WALL_HEIGHT || isSolid(this.level, col, row) || g.life <= 0) {
        this.burst(i, isSolid(this.level, col, row) ? prev : g.pos.setY(Math.max(0.05, g.pos.y)));
      }
    }
  }

  private burst(i: number, at: THREE.Vector3): void {
    const g = this.globs[i];
    this.scene.remove(g.mesh);
    g.glow.material.dispose();
    this.globs.splice(i, 1);
    this.onSplash?.(at.clone());
  }

  clear(): void {
    for (let i = this.globs.length - 1; i >= 0; i--) {
      this.scene.remove(this.globs[i].mesh);
      this.globs[i].glow.material.dispose();
    }
    this.globs.length = 0;
  }
}

/** Does the segment a→b pass through the player's body (a vertical capsule)? */
export function hitsPlayer(a: THREE.Vector3, b: THREE.Vector3, player: THREE.Vector3, top: number): boolean {
  // Closest approach of the segment to the player's vertical axis, in the ground plane.
  const ab = new THREE.Vector2(b.x - a.x, b.z - a.z);
  const ap = new THREE.Vector2(player.x - a.x, player.z - a.z);
  const len2 = ab.lengthSq();
  const t = len2 > 1e-9 ? THREE.MathUtils.clamp(ap.dot(ab) / len2, 0, 1) : 0;
  const cx = a.x + (b.x - a.x) * t;
  const cz = a.z + (b.z - a.z) * t;
  const y = a.y + (b.y - a.y) * t;
  return Math.hypot(player.x - cx, player.z - cz) < PLAYER_RADIUS && y > 0 && y < top + 0.2;
}
