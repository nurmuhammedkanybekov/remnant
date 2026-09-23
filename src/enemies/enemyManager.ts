import * as THREE from "three";
import { Enemy } from "./enemy";
import { hasLineOfSight, type LevelData } from "../world/level";

export class EnemyManager {
  readonly enemies: Enemy[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly level: LevelData,
    spawns: THREE.Vector2[]
  ) {
    for (const spawn of spawns) {
      this.enemies.push(new Enemy(scene, spawn));
    }
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerIsSprinting: boolean,
    onPlayerDamage: (amount: number) => void
  ): void {
    for (const enemy of this.enemies) {
      enemy.onPlayerDamage = onPlayerDamage;
      enemy.update(dt, this.level, playerPos, playerIsSprinting, (from, to) =>
        hasLineOfSight(this.level, from, to)
      );
    }

  }

  /** Raycast a shot against all living enemies' rough hit spheres. Returns the closest hit, if any. */
  raycastEnemies(raycaster: THREE.Raycaster): { enemy: Enemy; distance: number } | null {
    let closest: { enemy: Enemy; distance: number } | null = null;
    for (const enemy of this.enemies) {
      if (enemy.state === "dead") continue;
      const hitbox = new THREE.Sphere(
        new THREE.Vector3(enemy.group.position.x, 1.1, enemy.group.position.z),
        0.55
      );
      const point = new THREE.Vector3();
      if (raycaster.ray.intersectSphere(hitbox, point)) {
        const distance = raycaster.ray.origin.distanceTo(point);
        if (!closest || distance < closest.distance) closest = { enemy, distance };
      }
    }
    return closest;
  }

  anyAlive(): boolean {
    return this.enemies.some((e) => e.state !== "dead");
  }
}
