import * as THREE from "three";
import { findPath } from "../world/pathfinding";
import type { LevelData } from "../world/level";

export type EnemyState = "patrol" | "alert" | "chase" | "attack" | "dead";

const VISION_RANGE = 9;
const VISION_HALF_ANGLE = Math.PI / 3.2;
const HEARING_RANGE_WALK = 3.5;
const HEARING_RANGE_SPRINT = 8;
const ATTACK_RANGE = 1.15;
const ATTACK_DAMAGE = 18;
const ATTACK_COOLDOWN = 1.1;
const CHASE_SPEED = 2.6;
const PATROL_SPEED = 1.1;
const MAX_HEALTH = 60;
const REPATH_INTERVAL = 0.5;

export class Enemy {
  readonly group: THREE.Group;
  state: EnemyState = "patrol";
  health = MAX_HEALTH;
  onPlayerDamage: ((amount: number) => void) | null = null;
  onNoiseAlert: (() => void) | null = null;

  private patrolCenter: THREE.Vector2;
  private patrolTarget: THREE.Vector2;
  private path: THREE.Vector2[] = [];
  private repathTimer = 0;
  private attackCooldown = 0;
  private facingAngle = Math.random() * Math.PI * 2;
  private eyeMeshes: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene, spawn: THREE.Vector2) {
    this.patrolCenter = spawn.clone();
    this.patrolTarget = spawn.clone();
    this.group = buildEnemyMesh();
    this.eyeMeshes = this.group.userData.eyes as THREE.Mesh[];
    this.group.position.set(spawn.x, 0, spawn.y);
    scene.add(this.group);
    this.pickNewPatrolTarget();
  }

  get position2D(): THREE.Vector2 {
    return new THREE.Vector2(this.group.position.x, this.group.position.z);
  }

  takeDamage(amount: number): boolean {
    if (this.state === "dead") return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.state = "dead";
      return true;
    }
    this.state = "chase";
    return false;
  }

  private pickNewPatrolTarget(): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = 2 + Math.random() * 3;
    this.patrolTarget = new THREE.Vector2(
      this.patrolCenter.x + Math.cos(angle) * dist,
      this.patrolCenter.y + Math.sin(angle) * dist
    );
  }

  update(
    dt: number,
    level: LevelData,
    playerPos: THREE.Vector3,
    playerIsSprinting: boolean,
    hasLineOfSight: (from: THREE.Vector2, to: THREE.Vector2) => boolean
  ): void {
    if (this.state === "dead") {
      this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, Math.PI / 2, dt * 4);
      this.group.position.y = THREE.MathUtils.lerp(this.group.position.y, -0.4, dt * 4);
      return;
    }

    const myPos = this.position2D;
    const playerPos2D = new THREE.Vector2(playerPos.x, playerPos.z);
    const toPlayer = playerPos2D.clone().sub(myPos);
    const distToPlayer = toPlayer.length();

    const angleToPlayer = Math.atan2(toPlayer.x, toPlayer.y);
    let angleDiff = Math.abs(angleToPlayer - this.facingAngle);
    if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

    const canSeePlayer =
      distToPlayer < VISION_RANGE && angleDiff < VISION_HALF_ANGLE && hasLineOfSight(myPos, playerPos2D);
    const hearingRange = playerIsSprinting ? HEARING_RANGE_SPRINT : HEARING_RANGE_WALK;
    const canHearPlayer = distToPlayer < hearingRange;

    if (this.state !== "attack" && (canSeePlayer || canHearPlayer)) {
      if (this.state === "patrol") this.onNoiseAlert?.();
      this.state = distToPlayer < ATTACK_RANGE ? "attack" : "chase";
    }

    if (this.state === "attack" && distToPlayer > ATTACK_RANGE * 1.4) {
      this.state = "chase";
    }

    switch (this.state) {
      case "patrol":
        this.updatePatrol(dt, level);
        break;
      case "chase":
        this.updateChase(dt, level, myPos, playerPos2D);
        break;
      case "attack":
        this.attackCooldown -= dt;
        this.facingAngle = angleToPlayer;
        if (this.attackCooldown <= 0) {
          this.attackCooldown = ATTACK_COOLDOWN;
          this.onPlayerDamage?.(ATTACK_DAMAGE);
        }
        break;
    }

    this.group.rotation.y = this.facingAngle;
    this.animate(dt);
  }

  private updatePatrol(dt: number, level: LevelData): void {
    const myPos = this.position2D;
    const toTarget = this.patrolTarget.clone().sub(myPos);
    if (toTarget.length() < 0.3) {
      this.pickNewPatrolTarget();
      return;
    }
    this.moveToward(dt, level, myPos, this.patrolTarget, PATROL_SPEED);
  }

  private updateChase(dt: number, level: LevelData, myPos: THREE.Vector2, playerPos: THREE.Vector2): void {
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 || this.path.length === 0) {
      this.repathTimer = REPATH_INTERVAL;
      this.path = findPath(level, myPos.x, myPos.y, playerPos.x, playerPos.y);
    }

    if (this.path.length > 0) {
      const waypoint = this.path[0];
      if (waypoint.distanceTo(myPos) < 0.35) {
        this.path.shift();
      } else {
        this.moveToward(dt, level, myPos, waypoint, CHASE_SPEED);
      }
    } else {
      this.moveToward(dt, level, myPos, playerPos, CHASE_SPEED);
    }
  }

  private moveToward(
    dt: number,
    _level: LevelData,
    myPos: THREE.Vector2,
    target: THREE.Vector2,
    speed: number
  ): void {
    const dir = target.clone().sub(myPos);
    const dist = dir.length();
    if (dist < 0.001) return;
    dir.divideScalar(dist);
    const step = Math.min(dist, speed * dt);
    this.group.position.x += dir.x * step;
    this.group.position.z += dir.y * step;
    this.facingAngle = Math.atan2(dir.x, dir.y);
  }

  private animate(dt: number): void {
    const bob = Math.sin(performance.now() * 0.006) * 0.05;
    this.group.position.y = this.state === "dead" ? this.group.position.y : bob;
    const pulse = 0.5 + Math.sin(performance.now() * 0.01) * 0.5;
    for (const eye of this.eyeMeshes) {
      (eye.material as THREE.MeshBasicMaterial).opacity = 0.5 + pulse * 0.5;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}

function buildEnemyMesh(): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 4, 8), bodyMat);
  torso.position.y = 0.95;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.3), bodyMat);
  head.position.y = 1.62;
  group.add(head);

  const eyeGeo = new THREE.SphereGeometry(0.035, 6, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 1 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat.clone());
  eyeL.position.set(-0.08, 1.63, 0.16);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat.clone());
  eyeR.position.set(0.08, 1.63, 0.16);
  group.add(eyeL, eyeR);

  group.userData.eyes = [eyeL, eyeR];
  return group;
}
