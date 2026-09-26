import * as THREE from "three";
import { findPath } from "../world/pathfinding";
import { circleHitsWall, hasLineOfSight, randomFloorNear, type LevelData } from "../world/level";
import { buildCreature, type CreatureRig } from "./enemyMesh";

export type EnemyKind = "husk" | "brute";
/**
 *  patrol      – wandering near home, unaware
 *  investigate – heard something, walking to where it came from
 *  chase       – has the player, pathing straight to them
 *  attack      – in reach: wind-up, then strike (you can dodge the wind-up)
 *  search      – lost the player, checking the last known position
 *  dead
 */
export type EnemyState = "patrol" | "investigate" | "chase" | "attack" | "search" | "dead";

interface KindStats {
  health: number;
  scale: number;
  tint: number;
  patrolSpeed: number;
  investigateSpeed: number;
  chaseSpeed: number;
  attackRange: number;
  attackDamage: number;
  windup: number;
  recover: number;
  hearing: number; // multiplier on noise radius
  radius: number;
}

export const ENEMY_STATS: Record<EnemyKind, KindStats> = {
  husk: {
    health: 60,
    scale: 1,
    tint: 0x2a201c,
    patrolSpeed: 1.0,
    investigateSpeed: 1.9,
    chaseSpeed: 3.6,
    attackRange: 1.35,
    attackDamage: 16,
    windup: 0.38,
    recover: 0.8,
    hearing: 1,
    radius: 0.35,
  },
  brute: {
    health: 190,
    scale: 1.4,
    tint: 0x281a1c,
    patrolSpeed: 0.8,
    investigateSpeed: 1.5,
    chaseSpeed: 2.5,
    attackRange: 1.75,
    attackDamage: 34,
    windup: 0.65,
    recover: 0.9,
    hearing: 0.8,
    radius: 0.5,
  },
};

const VISION_HALF_ANGLE = Math.PI / 3; // 60° each side
const SIGHT_DARK = 6; // how far they see you with your light off
const SIGHT_LIT = 15; // ...and with it on (they see the beam)
const LOSE_TIME = 3.5; // seconds without contact before chase → search
const SEARCH_TIME = 6;
const REPATH_INTERVAL = 0.4;

export interface Perception {
  playerPos: THREE.Vector2;
  playerNoise: number; // current movement noise radius
  torchOn: boolean;
  playerDead: boolean;
}

export class Enemy {
  readonly kind: EnemyKind;
  readonly stats: KindStats;
  readonly rig: CreatureRig;
  state: EnemyState = "patrol";
  health: number;
  /** 0..1 — how close this enemy is to noticing you by sight. */
  suspicion = 0;

  onAttackHit: ((damage: number, from: THREE.Vector2) => void) | null = null;
  onAlert: ((enemy: Enemy) => void) | null = null;
  onVocal: ((enemy: Enemy, kind: "idle" | "windup" | "hurt" | "death") => void) | null = null;

  private readonly home: THREE.Vector2;
  private patrolTarget: THREE.Vector2;
  private patrolWait = 0;
  private path: THREE.Vector2[] = [];
  private repathTimer = 0;
  private lastKnown = new THREE.Vector2();
  private sinceContact = 0;
  private searchTimer = 0;
  private attackTimer = 0;
  private attackPhase: "windup" | "recover" | null = null;
  private facing = Math.random() * Math.PI * 2;
  private walkPhase = Math.random() * 10;
  private speedNow = 0;
  private hitFlash = 0;
  private stagger = 0;
  private deathT = 0;
  private vocalTimer = 3 + Math.random() * 6;
  private lookAround = 0;

  constructor(
    private readonly scene: THREE.Scene,
    spawn: THREE.Vector2,
    kind: EnemyKind
  ) {
    this.kind = kind;
    this.stats = ENEMY_STATS[kind];
    this.health = this.stats.health;
    this.home = spawn.clone();
    this.patrolTarget = spawn.clone();
    this.rig = buildCreature(this.stats.tint, this.stats.scale);
    this.rig.root.position.set(spawn.x, 0, spawn.y);
    this.rig.root.rotation.order = "YXZ"; // yaw first, so the death fall tips backwards relative to facing
    scene.add(this.rig.root);
  }

  get position2D(): THREE.Vector2 {
    return new THREE.Vector2(this.rig.root.position.x, this.rig.root.position.z);
  }

  get isDead(): boolean {
    return this.state === "dead";
  }

  get isHunting(): boolean {
    return this.state === "chase" || this.state === "attack";
  }

  /** World-space hit volumes: head (bonus damage) and two body spheres. */
  hitVolumes(): { head: THREE.Sphere; body: THREE.Sphere[] } {
    const s = this.stats.scale;
    const head = new THREE.Sphere(this.rig.head.getWorldPosition(new THREE.Vector3()), 0.17 * s);
    const chest = new THREE.Sphere(this.rig.torso.localToWorld(new THREE.Vector3(0, 0.38, 0)), 0.3 * s);
    const hips = new THREE.Sphere(this.rig.body.getWorldPosition(new THREE.Vector3()), 0.26 * s);
    const legs = new THREE.Sphere(this.rig.root.position.clone().setY(0.45 * s), 0.25 * s);
    return { head, body: [chest, hips, legs] };
  }

  takeDamage(amount: number, from: THREE.Vector2): boolean {
    if (this.isDead) return false;
    this.health -= amount;
    this.hitFlash = 1;
    this.stagger = Math.min(1, this.stagger + 0.6);
    if (this.health <= 0) {
      this.state = "dead";
      this.onVocal?.(this, "death");
      for (const g of this.rig.eyeGlow) g.visible = false;
      return true;
    }
    this.onVocal?.(this, "hurt");
    // Getting shot always tells them where you are.
    this.lastKnown.copy(from);
    this.sinceContact = 0;
    if (!this.isHunting) this.enterChase();
    return false;
  }

  /** A loud noise (gunshot) at `pos`. `radius` is already reduced for walls by the caller. */
  hearNoise(pos: THREE.Vector2, radius: number): void {
    if (this.isDead) return;
    if (this.position2D.distanceTo(pos) > radius * this.stats.hearing) return;
    this.lastKnown.copy(pos);
    if (this.isHunting) {
      this.sinceContact = 0;
      return;
    }
    this.goInvestigate(pos);
  }

  private enterChase(): void {
    if (this.state === "patrol" || this.state === "search" || this.state === "investigate") this.onAlert?.(this);
    this.state = "chase";
    this.path = [];
    this.repathTimer = 0;
  }

  private goInvestigate(pos: THREE.Vector2): void {
    if (this.state === "patrol") this.onAlert?.(this);
    this.state = "investigate";
    this.lastKnown.copy(pos);
    this.path = [];
    this.repathTimer = 0;
  }

  update(dt: number, level: LevelData, p: Perception, others: Enemy[]): void {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.stagger = Math.max(0, this.stagger - dt * 2.5);
    this.rig.skin.emissive.setRGB(this.hitFlash * 0.6, this.hitFlash * 0.05, 0);

    if (this.isDead) {
      this.animateDeath(dt);
      return;
    }

    const me = this.position2D;
    const toPlayer = p.playerPos.clone().sub(me);
    const dist = toPlayer.length();
    const los = !p.playerDead && hasLineOfSight(level, me, p.playerPos);

    // --- Sight ---
    const angleTo = Math.atan2(toPlayer.x, toPlayer.y);
    const inCone = Math.abs(wrapAngle(angleTo - this.facing)) < VISION_HALF_ANGLE;
    const sightRange = p.torchOn ? SIGHT_LIT : SIGHT_DARK;
    const hunting = this.isHunting;
    // Once hunting, they track you all round (they know roughly where you are).
    const canSee = los && dist < sightRange && (inCone || hunting || dist < 2);
    if (canSee) {
      // Close = instant; far = suspicion builds over time (gives you a moment to duck away).
      const rate = dist < sightRange * 0.4 ? 10 : 1.6 + (1 - dist / sightRange) * 2;
      this.suspicion = Math.min(1, this.suspicion + rate * dt);
    } else {
      this.suspicion = Math.max(0, this.suspicion - dt * 0.35);
    }

    // --- Hearing (movement noise; walls muffle it to 40%) ---
    const heardRadius = p.playerNoise * this.stats.hearing * (los ? 1 : 0.4);
    const canHear = !p.playerDead && dist < heardRadius;

    if (!p.playerDead && (this.suspicion >= 1 || (hunting && (canSee || canHear)))) {
      this.lastKnown.copy(p.playerPos);
      this.sinceContact = 0;
      if (!hunting) this.enterChase();
    } else if (canHear && !hunting) {
      this.goInvestigate(p.playerPos);
    } else if (this.suspicion > 0.35 && this.state === "patrol") {
      // Half-noticed: turn and walk toward it.
      this.goInvestigate(p.playerPos);
    }

    if (p.playerDead && hunting) {
      this.state = "search";
      this.searchTimer = SEARCH_TIME;
    }

    switch (this.state) {
      case "patrol":
        this.updatePatrol(dt, level, others);
        break;
      case "investigate":
        if (this.followPathTo(dt, level, this.lastKnown, this.stats.investigateSpeed, others)) {
          this.state = "search";
          this.searchTimer = SEARCH_TIME * 0.6;
        }
        break;
      case "chase":
        this.sinceContact += dt;
        if (this.sinceContact > LOSE_TIME) {
          this.state = "search";
          this.searchTimer = SEARCH_TIME;
          break;
        }
        if (dist < this.stats.attackRange && los) {
          this.state = "attack";
          this.attackPhase = "windup";
          this.attackTimer = this.stats.windup;
          this.onVocal?.(this, "windup");
          break;
        }
        this.followPathTo(
          dt,
          level,
          this.sinceContact < 0.2 ? p.playerPos : this.lastKnown,
          this.stats.chaseSpeed * (1 - this.stagger * 0.7),
          others
        );
        break;
      case "attack":
        this.faceToward(angleTo, dt, 10);
        this.speedNow = 0;
        this.attackTimer -= dt;
        if (this.attackPhase === "windup" && this.attackTimer <= 0) {
          // Strike lands only if you're still in reach (plus a little lunge).
          if (dist < this.stats.attackRange + 0.35 && los && !p.playerDead) {
            this.onAttackHit?.(this.stats.attackDamage, me);
          }
          this.attackPhase = "recover";
          this.attackTimer = this.stats.recover;
        } else if (this.attackPhase === "recover" && this.attackTimer <= 0) {
          this.attackPhase = null;
          this.state = "chase";
        }
        break;
      case "search":
        this.searchTimer -= dt;
        if (this.followPathTo(dt, level, this.lastKnown, this.stats.investigateSpeed, others)) {
          // Look around at the spot.
          this.lookAround += dt;
          this.faceToward(this.facing + Math.sin(this.lookAround * 1.5) * 0.08, dt, 3);
          this.speedNow = 0;
        }
        if (this.searchTimer <= 0) {
          this.state = "patrol";
          this.patrolTarget = randomFloorNear(level, this.home.x, this.home.y, 2);
        }
        break;
    }

    this.vocalTimer -= dt;
    if (this.vocalTimer <= 0) {
      this.vocalTimer = (hunting ? 2 : 5) + Math.random() * 6;
      this.onVocal?.(this, "idle");
    }

    this.rig.root.rotation.y = this.facing;
    this.animate(dt);
  }

  private updatePatrol(dt: number, level: LevelData, others: Enemy[]): void {
    if (this.patrolWait > 0) {
      this.patrolWait -= dt;
      this.speedNow = 0;
      return;
    }
    if (this.followPathTo(dt, level, this.patrolTarget, this.stats.patrolSpeed, others)) {
      this.patrolWait = 1.5 + Math.random() * 3;
      this.patrolTarget = randomFloorNear(level, this.home.x, this.home.y, 2);
    }
  }

  /** Walk along a BFS path to `target`. Returns true once arrived. */
  private followPathTo(dt: number, level: LevelData, target: THREE.Vector2, speed: number, others: Enemy[]): boolean {
    const me = this.position2D;
    if (me.distanceTo(target) < 0.6) {
      this.speedNow = 0;
      return true;
    }
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 || this.path.length === 0) {
      this.repathTimer = REPATH_INTERVAL;
      this.path = findPath(level, me.x, me.y, target.x, target.y);
      // Replace the final cell-centre with the exact target point.
      if (this.path.length > 0) this.path[this.path.length - 1] = target.clone();
    }
    // String-pull: skip waypoints we can already see past.
    while (this.path.length > 1 && hasLineOfSight(level, me, this.path[1])) this.path.shift();

    const waypoint = this.path[0] ?? target;
    if (waypoint.distanceTo(me) < 0.3 && this.path.length > 0) this.path.shift();
    this.moveToward(dt, level, me, waypoint, speed, others);
    return false;
  }

  private moveToward(dt: number, level: LevelData, me: THREE.Vector2, target: THREE.Vector2, speed: number, others: Enemy[]): void {
    const dir = target.clone().sub(me);
    const d = dir.length();
    if (d < 0.001) return;
    dir.divideScalar(d);

    // Separation so a pack doesn't merge into one blob.
    for (const o of others) {
      if (o === this || o.isDead) continue;
      const away = me.clone().sub(o.position2D);
      const od = away.length();
      const minD = this.stats.radius + o.stats.radius + 0.2;
      if (od > 0.001 && od < minD) dir.addScaledVector(away.divideScalar(od), (minD - od) * 2);
    }
    dir.normalize();

    const step = Math.min(d, speed * dt);
    const r = this.stats.radius;
    let nx = me.x + dir.x * step;
    let nz = me.y + dir.y * step;
    if (circleHitsWall(level, nx, me.y, r)) nx = me.x;
    if (circleHitsWall(level, nx, nz, r)) nz = me.y;
    this.rig.root.position.x = nx;
    this.rig.root.position.z = nz;
    this.speedNow = Math.hypot(nx - me.x, nz - me.y) / Math.max(dt, 1e-6);
    this.faceToward(Math.atan2(dir.x, dir.y), dt, 8);
  }

  private faceToward(angle: number, dt: number, rate: number): void {
    this.facing += wrapAngle(angle - this.facing) * Math.min(1, rate * dt);
  }

  private animate(dt: number): void {
    const r = this.rig;
    const t = performance.now() / 1000;
    this.walkPhase += dt * this.speedNow * (this.kind === "brute" ? 2.6 : 3.6);
    const stride = Math.min(1, this.speedNow / 2);
    const s = Math.sin(this.walkPhase);
    const c = Math.cos(this.walkPhase);

    r.legL.rotation.x = s * 0.7 * stride;
    r.legR.rotation.x = -s * 0.7 * stride;
    r.shinL.rotation.x = Math.max(0, -c) * 0.9 * stride + 0.1;
    r.shinR.rotation.x = Math.max(0, c) * 0.9 * stride + 0.1;
    r.body.position.y = 0.95 - Math.abs(c) * 0.06 * stride + Math.sin(t * 1.3) * 0.01;

    const hunting = this.isHunting;
    // Idle twitch: the head jerks now and then.
    const twitch = Math.sin(t * 7.3 + this.walkPhase) > 0.97 ? 0.25 : 0;
    r.head.rotation.z = Math.sin(t * 0.9) * 0.15 + twitch;
    r.jaw.position.y = -0.1 - (hunting ? 0.03 + Math.abs(Math.sin(t * 9)) * 0.02 : 0);

    let armBase = hunting ? -1.1 : -0.15;
    let armSwing = s * 0.5 * stride;
    let foreBend = hunting ? -0.6 : -0.3;
    let lean = hunting ? 0.75 : 0.5;

    if (this.state === "attack") {
      if (this.attackPhase === "windup") {
        const k = 1 - this.attackTimer / this.stats.windup;
        armBase = -1.2 - k * 1.6; // arms rise up and back
        foreBend = -1.2;
        lean = 0.35;
        armSwing = 0;
      } else {
        const k = Math.min(1, (this.stats.recover - this.attackTimer) / 0.12);
        armBase = -2.8 + k * 2.3; // slash down
        foreBend = -0.2;
        lean = 0.95;
        armSwing = 0;
      }
    }
    r.armL.rotation.x = armBase + armSwing;
    r.armR.rotation.x = armBase - armSwing;
    r.armL.rotation.z = -0.2;
    r.armR.rotation.z = 0.2;
    r.foreL.rotation.x = foreBend;
    r.foreR.rotation.x = foreBend;
    r.torso.rotation.x = lean - this.stagger * 0.5;

    const pulse = 0.6 + 0.4 * Math.sin(t * (hunting ? 12 : 3));
    for (const g of r.eyeGlow) g.material.opacity = (hunting ? 1 : 0.6) * pulse;
  }

  private animateDeath(dt: number): void {
    this.deathT += dt;
    const k = Math.min(1, this.deathT / 0.7);
    const ease = 1 - Math.pow(1 - k, 3);
    const r = this.rig;
    r.root.rotation.x = -ease * (Math.PI / 2 - 0.1);
    r.root.position.y = ease * 0.15 * this.stats.scale;
    r.legL.rotation.x = ease * -0.4;
    r.legR.rotation.x = ease * 0.3;
    r.armL.rotation.x = -1.5 * ease;
    r.armR.rotation.x = -0.4 * ease;
    // Eyes fade out
    for (const e of r.eyes) (e.material as THREE.MeshBasicMaterial).color.setRGB(1 - ease * 0.9, 0.2 * (1 - ease), 0.1 * (1 - ease));
  }

  dispose(): void {
    this.scene.remove(this.rig.root);
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
