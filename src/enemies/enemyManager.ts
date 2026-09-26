import * as THREE from "three";
import type { EnemyKind } from "../content/enemies";
import { RemnantBoss } from "./boss";
import { Enemy, NO_MODIFIERS, type EnemyModifiers, type Perception } from "./enemy";
import { hasLineOfSight, type LevelGrid } from "../world/grid";
import type { EnemySpawn } from "../world/levelParser";

export interface EnemyHit {
  enemy: Enemy;
  distance: number;
  point: THREE.Vector3;
  headshot: boolean;
}

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  /** Called for every enemy, including ones spawned mid-level, so the session can wire up its callbacks. */
  onSpawned: ((enemy: Enemy) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly level: LevelGrid,
    spawns: EnemySpawn[],
    private readonly modifiers: EnemyModifiers = NO_MODIFIERS
  ) {
    for (const s of spawns) this.add(s.kind, s.pos);
  }

  private add(kind: EnemyKind, pos: THREE.Vector2): Enemy {
    const e =
      kind === "remnant" ? new RemnantBoss(this.scene, pos, kind, this.modifiers) : new Enemy(this.scene, pos, kind, this.modifiers);
    this.enemies.push(e);
    return e;
  }

  /** Adds an enemy mid-level (the boss's summons). Appended, so checkpoint indices of the originals never shift. */
  spawn(kind: EnemyKind, pos: THREE.Vector2): Enemy {
    const e = this.add(kind, pos);
    this.onSpawned?.(e);
    return e;
  }

  /** Wires every enemy that exists so far. */
  wireAll(): void {
    for (const e of this.enemies) this.onSpawned?.(e);
  }

  get boss(): RemnantBoss | null {
    return (this.enemies.find((e) => e instanceof RemnantBoss) as RemnantBoss | undefined) ?? null;
  }

  /** One perception per player (just one in solo play). Puppets (co-op guest) only animate. */
  update(dt: number, perception: Perception | Perception[]): void {
    // Copy: an update can spawn more enemies.
    for (const e of [...this.enemies]) {
      if (e.puppet) e.updatePuppet(dt);
      else e.update(dt, this.level, perception, this.enemies);
    }
  }

  /** Loud noise (gunfire). Walls cut the radius to 60%. */
  emitNoise(pos: THREE.Vector2, radius: number): void {
    for (const e of this.enemies) {
      if (e.isDead) continue;
      const r = hasLineOfSight(this.level, e.position2D, pos) ? radius : radius * 0.6;
      e.hearNoise(pos, r);
    }
  }

  /** Ray vs every living enemy's hit volumes; closest hit within maxDist wins. */
  raycast(ray: THREE.Ray, maxDist: number): EnemyHit | null {
    let best: EnemyHit | null = null;
    const tmp = new THREE.Vector3();
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      // Cheap reject before building hit volumes.
      const c = enemy.root.position;
      const reach = enemy.stats.radius + 2.5;
      if (ray.distanceSqToPoint(tmp.set(c.x, 1.2, c.z)) > reach * reach) continue;
      const { head, body } = enemy.hitVolumes();
      const test = (s: THREE.Sphere, headshot: boolean) => {
        if (!ray.intersectSphere(s, tmp)) return;
        const d = ray.origin.distanceTo(tmp);
        if (d > maxDist) return;
        // Prefer headshots if the head is (almost) as close as the body hit.
        if (!best || d < best.distance + (headshot ? 0.25 : 0)) best = { enemy, distance: d, point: tmp.clone(), headshot };
      };
      for (const b of body) test(b, false);
      test(head, true);
    }
    return best;
  }

  get aliveCount(): number {
    return this.enemies.filter((e) => !e.isDead).length;
  }

  /** 0..1 — the highest suspicion/hunting level, drives the HUD "awareness" eye. */
  get threat(): number {
    let t = 0;
    for (const e of this.enemies) {
      if (e.isDead) continue;
      if (e.isHunting || e.state === "drop") return 1;
      t = Math.max(t, e.state === "investigate" || e.state === "search" ? 0.6 : e.suspicion * 0.6);
    }
    return t;
  }

  dispose(): void {
    for (const e of this.enemies) e.dispose();
  }
}
