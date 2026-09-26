import * as THREE from "three";
import type { EnemyKind } from "../content/enemies";
import { hasLineOfSight, type LevelGrid } from "../world/grid";
import { MassBody, type CreatureBody } from "./bodies";
import { Enemy, type EnemyModifiers, type Perception } from "./enemy";

/** Wakes when you come this close with a clear line to it (or hurt it). */
const WAKE_RANGE = 16;
/** Seconds the core stays open after an attack — the window to hit it. */
const PUNISH_WINDOW = 2.2;
/** Per phase (index 0 = phase 1). */
const SPIT_COUNT = [1, 3, 5];
const SPIT_COOLDOWN = [3.2, 3.4, 2.6];
const SLAM_COOLDOWN = [2.6, 2.2, 1.6];
const SLAM_WINDUP = [0.95, 0.85, 0.7];
const SUMMON_INTERVAL = [Infinity, 14, 10];
const SPIT_SPREAD = 0.16;

/**
 * The Remnant: the mass at the heart of the Hive. It doesn't move. It
 * slams anything that comes close with its tendrils, lobs acid at anything
 * that doesn't, and in later phases births swarms to flush you out.
 *
 * Its hide soaks up most damage. The core — an eye the size of a torso —
 * only opens while it attacks and for a moment after, and that's when it
 * can really be hurt. Three phases, at full, two-thirds and one-third health.
 */
export class RemnantBoss extends Enemy {
  phase = 1;
  awake = false;
  /** Fired when the fight moves to phase 2 or 3. */
  onPhase: ((phase: number) => void) | null = null;
  /** Wants reinforcements near itself. */
  onSummon: ((boss: RemnantBoss) => void) | null = null;

  private slamCooldown = 1.5;
  private spitCooldown = 1.5;
  private summonTimer = 0;
  private openTimer = 0;
  private readonly mass: MassBody;

  constructor(scene: THREE.Scene, spawn: THREE.Vector2, kind: EnemyKind, mods: EnemyModifiers, body?: CreatureBody) {
    super(scene, spawn, kind, mods, body);
    this.mass = this.body as MassBody;
    this.state = "patrol";
    // It faces up the map until it notices you.
    this.facing = Math.PI;
  }

  override get isHunting(): boolean {
    return this.awake && !this.isDead;
  }

  /** 0..1 — how far the core is open. Hits to the core only count fully when it's open. */
  get coreOpen(): number {
    return this.mass.open;
  }

  /** Would a hit to `part` right now be soaked by the hide? */
  isArmoured(part: "head" | "body"): boolean {
    return part === "body" || this.mass.open <= 0.5;
  }

  override canBeTakenDown(): boolean {
    return false;
  }

  override hearNoise(pos: THREE.Vector2, radius: number): void {
    if (this.isDead || this.awake) return;
    if (this.position2D.distanceTo(pos) < radius * this.stats.hearing * 0.5) this.wake();
  }

  override takeDamage(amount: number, from: THREE.Vector2, part: "head" | "body" = "body"): boolean {
    if (this.isDead) return false;
    this.wake();
    const armor = this.stats.armor ?? 1;
    const scale = part === "head" && this.mass.open > 0.5 ? 1 : armor;
    this.health -= amount * scale;
    this.lastKnown.copy(from);
    if (this.health <= 0) {
      this.hitFlash = 1;
      this.die(true);
      return true;
    }
    if (this.hitFlash < 0.2) this.onVocal?.(this, "hurt");
    this.hitFlash = scale === 1 ? 1 : 0.4;
    return false;
  }

  override shove(): void {
    // It's the size of a room.
  }

  private wake(): void {
    if (this.awake) return;
    this.awake = true;
    this.state = "chase";
    this.onAlert?.(this);
    this.onVocal?.(this, "roar");
  }

  override update(dt: number, level: LevelGrid, p: Perception): void {
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    if (this.isDead) {
      this.animateDeath(dt);
      return;
    }

    const me = this.position2D;
    const toPlayer = p.playerPos.clone().sub(me);
    const dist = toPlayer.length();
    const los = !p.playerDead && hasLineOfSight(level, me, p.playerPos);

    if (!this.awake && !p.playerDead && los && dist < WAKE_RANGE) this.wake();
    if (!this.awake) {
      this.mass.open = Math.max(0, this.mass.open - dt);
      this.finishFrame(dt, false);
      return;
    }

    this.faceToward(Math.atan2(toPlayer.x, toPlayer.y), dt, 1.4);

    const phase = this.health > (this.maxHealth * 2) / 3 ? 1 : this.health > this.maxHealth / 3 ? 2 : 3;
    if (phase > this.phase) {
      this.phase = phase;
      this.onVocal?.(this, "roar");
      this.onPhase?.(phase);
      // It rears up, exposed, and calls for help.
      this.openTimer = 3.5;
      this.summonTimer = 1.2;
      this.state = "chase";
      this.attackPhase = null;
    }
    const pi = this.phase - 1;
    this.mass.rage = pi / 2;

    this.slamCooldown -= dt;
    this.spitCooldown -= dt;
    this.openTimer -= dt;
    if (this.phase >= 2) {
      this.summonTimer -= dt;
      if (this.summonTimer <= 0) {
        this.summonTimer = SUMMON_INTERVAL[pi];
        this.onSummon?.(this);
      }
    }

    if (this.state === "attack") {
      this.attackTimer -= dt;
      if (this.attackPhase === "windup" && this.attackTimer <= 0) {
        if (this.attackKind === "melee") {
          this.onVocal?.(this, "slam");
          if (dist < this.stats.attackRange + 0.6 && !p.playerDead) this.onAttackHit?.(this.stats.attackDamage * this.mods.damage, me);
          this.slamCooldown = SLAM_COOLDOWN[pi];
        } else {
          this.spitVolley(p, SPIT_COUNT[pi]);
          this.spitCooldown = SPIT_COOLDOWN[pi];
        }
        this.attackPhase = "recover";
        this.attackTimer = this.attackDuration = this.stats.recover;
      } else if (this.attackPhase === "recover" && this.attackTimer <= 0) {
        this.attackPhase = null;
        this.state = "chase";
        this.openTimer = PUNISH_WINDOW;
      }
    } else if (!p.playerDead) {
      if (dist < this.stats.attackRange && this.slamCooldown <= 0) this.begin("melee", SLAM_WINDUP[pi]);
      else if (los && this.spitCooldown <= 0 && dist < (this.stats.ranged?.range ?? 20)) this.begin("ranged", 0.8);
    }

    const wantOpen = this.state === "attack" || this.openTimer > 0 ? 1 : 0;
    this.mass.open += (wantOpen - this.mass.open) * Math.min(1, dt * (wantOpen ? 5 : 2.5));
    this.speedNow = 0;
    this.finishFrame(dt, true);
  }

  private begin(kind: "melee" | "ranged", windup: number): void {
    this.state = "attack";
    this.attackKind = kind;
    this.attackPhase = "windup";
    this.attackTimer = this.attackDuration = windup;
    this.onVocal?.(this, kind === "melee" ? "windup" : "spit");
  }

  /** A fan of acid globs aimed at (and around) the player. */
  private spitVolley(p: Perception, count: number): void {
    const from = this.body.mouth();
    const me = this.position2D;
    const target = new THREE.Vector3(p.playerPos.x, Math.max(0.9, p.eye.y - 0.45), p.playerPos.y);
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * SPIT_SPREAD;
      const rel = new THREE.Vector2(target.x - me.x, target.z - me.y).rotateAround(new THREE.Vector2(), offset);
      this.onRanged?.(this, from.clone(), new THREE.Vector3(me.x + rel.x, target.y, me.y + rel.y));
    }
  }
}
