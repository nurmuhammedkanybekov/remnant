import * as THREE from "three";
import { Enemy, type Perception } from "./enemy";
import { hasLineOfSight, type EnemySpawn, type LevelData } from "../world/level";

export interface EnemyHit {
  enemy: Enemy;
  distance: number;
  point: THREE.Vector3;
  headshot: boolean;
}

export class EnemyManager {
  readonly enemies: Enemy[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly level: LevelData,
    spawns: EnemySpawn[]
  ) {
    for (const s of spawns) this.enemies.push(new Enemy(scene, s.pos, s.kind));
  }

  update(dt: number, perception: Perception): void {
    for (const e of this.enemies) e.update(dt, this.level, perception, this.enemies);
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
      if (e.isHunting) return 1;
      t = Math.max(t, e.state === "investigate" || e.state === "search" ? 0.6 : e.suspicion * 0.6);
    }
    return t;
  }

  dispose(): void {
    for (const e of this.enemies) e.dispose();
  }
}
