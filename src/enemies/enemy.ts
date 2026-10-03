import * as THREE from "three";
import { findPath } from "../world/pathfinding";
import { enemyDef, type EnemyDef, type EnemyKind } from "../content/enemies";
import { circleHitsWall, hasLineOfSight, randomFloorNear, WALL_HEIGHT, type LevelGrid } from "../world/grid";
import { buildBody, type CreatureBody } from "./bodies";

/**
 *  lurk        – waiting in ambush: clinging to the ceiling (Crawler) or hiding and luring (Mimic)
 *  drop        – falling from the ceiling
 *  patrol      – wandering near home, unaware
 *  investigate – heard something, walking to where it came from
 *  chase       – has the player, pathing straight to them
 *  attack      – wind-up, then strike or spit (you can dodge the wind-up)
 *  search      – lost the player, checking the last known position
 *  dead
 */
export type EnemyState = "lurk" | "drop" | "patrol" | "investigate" | "chase" | "attack" | "search" | "dead";

export type VocalKind = "idle" | "windup" | "hurt" | "death" | "drop" | "spit" | "takedown" | "slam" | "roar";

/** Difficulty scaling applied on top of an enemy's definition. */
export interface EnemyModifiers {
  health: number;
  damage: number;
  /** Scales sight range and hearing. */
  perception: number;
  /** Scales how fast they run once they're hunting you. Optional: 1 if left out. */
  speed?: number;
}

export const NO_MODIFIERS: EnemyModifiers = { health: 1, damage: 1, perception: 1 };

const VISION_HALF_ANGLE = Math.PI / 3; // 60° each side
const SIGHT_DARK = 6; // how far they see you with your light off
const SIGHT_LIT = 15; // ...and with it on (they see the beam)
const TOUCH_RANGE = 1.1; // even blind creatures notice you bumping into them
const LOSE_TIME = 3.5; // seconds without contact before chase → search
const SEARCH_TIME = 6;
const REPATH_INTERVAL = 0.4;
/** Crawlers drop when you pass (almost) beneath them. */
const DROP_RADIUS = 1.7;
const DROP_TIME = 0.45;
/** Mimics spring their ambush when you get this close. */
const AMBUSH_RADIUS = 3.2;
/** The flashlight beam: half-angle and how far it holds a Watcher. */
const BEAM_HALF_ANGLE = 0.42;
const BEAM_REACH = 20;
/**
 * A Watcher stays locked this long after the beam slips off it, so sweeping
 * the light across it doesn't make it stop and start every other frame...
 */
const FREEZE_HOLD = 0.35;
/** ...and then its muscles unlock over this long: it gathers speed instead of lunging off at once. */
const THAW_TIME = 0.6;
/**
 * How quickly the walk animation follows the creature's actual speed (per
 * second). Without it the legs snapped straight the frame a creature
 * stopped and back to full stride the frame it set off, which reads as lag.
 */
const ANIM_EASE = 8;
/** Behind = more than this far round from where it's facing. */
const BEHIND_ANGLE = THREE.MathUtils.degToRad(105);
const MELEE_WINDUP_MAX = 0.45;
/** With two players, it only switches to the other one if they're this much closer. */
const TARGET_STICK = 3;
/**
 * Roamers: this share of the creatures that walk don't keep to their corner;
 * they wander the level, so nowhere you've cleared is safe for long.
 */
const ROAM_SHARE = 0.4;
/** How far (cells) a roamer picks its next spot from where it is, and how long it tries to reach it. */
const ROAM_RADIUS = 7;
const ROAM_GIVE_UP = 14;
/** How fast suspicion fills when it sees you with your light on: a blink, then it comes. */
const LIT_SUSPICION_RATE = 6;
/** A puppet carries on at the host copy's last speed for at most this long past its last snapshot. */
const PUPPET_EXTRAPOLATE = 0.25;
/** Faster than any creature runs: a jump that big between snapshots is a teleport, not movement. */
const PUPPET_MAX_SPEED = 12;
/** A puppet further than this from where the host says it is jumps there instead of gliding. */
const PUPPET_SNAP = 3;

const STATES: EnemyState[] = ["lurk", "drop", "patrol", "investigate", "chase", "attack", "search", "dead"];

export interface Perception {
  playerPos: THREE.Vector2;
  playerNoise: number; // current movement noise radius
  /** The flashlight is on and actually lit. */
  torchOn: boolean;
  playerDead: boolean;
  /**
   * Hiding in a locker: it can't be seen, and only one that watched you get
   * in knows where you are (it comes and pulls you out).
   */
  hidden?: boolean;
  /** Eye position and view direction (for "is the beam on me?"). */
  eye: THREE.Vector3;
  look: THREE.Vector3;
}

export class Enemy {
  readonly kind: EnemyKind;
  readonly stats: EnemyDef;
  /** Position and facing. The body hangs underneath. */
  readonly root = new THREE.Group();
  readonly body: CreatureBody;
  readonly maxHealth: number;
  state: EnemyState = "patrol";
  health: number;
  /** 0..1 — how close this enemy is to noticing you by sight. */
  suspicion = 0;
  /** A Watcher held in the flashlight beam. */
  frozen = false;
  /** Index of the player (in the perceptions it was given) it's paying attention to. */
  target = 0;
  /**
   * Co-op guest: the host's copy does the thinking; this one follows its
   * snapshots (`applyNet`) and only animates.
   */
  puppet = false;
  /** Latest snapshot from the host, for a puppet. */
  protected net: number[] | null = null;
  /** Puppet: how fast the host's copy was moving between its last two snapshots, and when the last one came. */
  private readonly netVel = new THREE.Vector2();
  private netAge = 0;

  onAttackHit: ((damage: number, from: THREE.Vector2) => void) | null = null;
  onAlert: ((enemy: Enemy) => void) | null = null;
  onVocal: ((enemy: Enemy, kind: VocalKind) => void) | null = null;
  /** Launch one projectile from `from` towards `target`. */
  onRanged: ((enemy: Enemy, from: THREE.Vector3, target: THREE.Vector3) => void) | null = null;
  /** A Mimic wants to make a sound to draw you in. */
  onLure: ((enemy: Enemy) => void) | null = null;

  protected readonly home: THREE.Vector2;
  protected patrolTarget: THREE.Vector2;
  protected patrolWait = 0;
  /** Wanders the whole level instead of its own corner (see `ROAM_SHARE`). */
  readonly roamer: boolean;
  private roamTime = 0;
  protected path: THREE.Vector2[] = [];
  protected repathTimer = 0;
  protected lastKnown = new THREE.Vector2();
  protected sinceContact = 0;
  protected searchTimer = 0;
  protected attackTimer = 0;
  protected attackDuration = 1;
  protected attackPhase: "windup" | "recover" | null = null;
  protected attackKind: "melee" | "ranged" = "melee";
  protected facing = Math.random() * Math.PI * 2;
  protected walkPhase = Math.random() * 10;
  protected speedNow = 0;
  /** `speedNow`, eased: what the walk animation uses. */
  private animSpeed = 0;
  /** Watcher: how much longer the light holds it after the beam has gone. */
  private lightHold = 0;
  /** Watcher: 0 just released from the light, 1 moving freely. */
  private thaw = 1;
  /** It could see its target last frame (so it saw them climb into a locker). */
  private sawTarget = false;
  /** Its target hid while it was watching: it knows which locker. */
  private knowsHide = false;
  protected hitFlash = 0;
  protected stagger = 0;
  protected deathT = 0;
  protected vocalTimer = 3 + Math.random() * 6;
  protected lookAround = 0;
  protected time = Math.random() * 100;
  protected rangedCooldown = 1 + Math.random();
  protected lureTimer = 4 + Math.random() * 6;
  private dropT = 0;
  private diedOnCeiling = false;

  constructor(
    private readonly scene: THREE.Scene,
    spawn: THREE.Vector2,
    kind: EnemyKind,
    protected readonly mods: EnemyModifiers = NO_MODIFIERS,
    /** Tests pass a stand-in; the real bodies need a canvas for their textures. */
    body?: CreatureBody
  ) {
    this.kind = kind;
    this.stats = enemyDef(kind);
    this.maxHealth = this.stats.health * mods.health;
    this.health = this.maxHealth;
    this.home = spawn.clone();
    this.patrolTarget = spawn.clone();
    const b = this.stats.behaviour;
    this.roamer = b !== "boss" && b !== "ceiling" && b !== "lurker" && Math.random() < ROAM_SHARE;
    this.body = body ?? buildBody(this.stats);
    this.root.add(this.body.group);
    this.root.position.set(spawn.x, 0, spawn.y);
    this.root.rotation.order = "YXZ";
    if (this.stats.behaviour === "ceiling" || this.stats.behaviour === "lurker") this.state = "lurk";
    if (this.onCeiling) this.hangFromCeiling(1);
    scene.add(this.root);
  }

  get position2D(): THREE.Vector2 {
    return new THREE.Vector2(this.root.position.x, this.root.position.z);
  }

  get isDead(): boolean {
    return this.state === "dead";
  }

  get isHunting(): boolean {
    return this.state === "chase" || this.state === "attack";
  }

  get onCeiling(): boolean {
    return this.stats.behaviour === "ceiling" && this.state === "lurk";
  }

  /** Direction it's facing, as a yaw angle (0 = +Z). */
  get heading(): number {
    return this.facing;
  }

  hitVolumes(): { head: THREE.Sphere; body: THREE.Sphere[] } {
    return this.body.hitVolumes();
  }

  /** Damage from the player. `part` lets armoured creatures shrug off body hits. Returns true if this killed it. */
  takeDamage(amount: number, from: THREE.Vector2, part: "head" | "body" = "body"): boolean {
    if (this.isDead) return false;
    this.health -= amount * (part === "body" ? (this.stats.armor ?? 1) : 1);
    if (this.health <= 0) {
      this.hitFlash = 1;
      this.die(true);
      return true;
    }
    if (this.hitFlash < 0.3) this.onVocal?.(this, "hurt");
    this.hitFlash = 1;
    this.stagger = Math.min(1, this.stagger + 0.6);
    // Getting hurt always tells them where you are.
    this.lastKnown.copy(from);
    this.sinceContact = 0;
    if (this.onCeiling) this.startDrop();
    else if (this.state !== "drop" && !this.isHunting) this.enterChase();
    return false;
  }

  /** True if a quiet melee strike from `from` would kill it outright. */
  canBeTakenDown(from: THREE.Vector2): boolean {
    if (this.isDead || !this.stats.takedown || this.onCeiling || this.state === "drop") return false;
    if (this.frozen) return true; // locked in the light: helpless from any side
    if (this.isHunting) return false;
    const to = from.clone().sub(this.position2D);
    return Math.abs(wrapAngle(Math.atan2(to.x, to.y) - this.facing)) > BEHIND_ANGLE;
  }

  /** Killed silently from behind. */
  takedown(): void {
    if (this.isDead) return;
    this.health = 0;
    this.hitFlash = 0.6;
    this.onVocal?.(this, "takedown");
    this.die(false);
  }

  /** A melee hit that didn't kill: knocked back and staggered. */
  shove(dir: THREE.Vector2, distance: number, level: LevelGrid): void {
    if (this.isDead || this.stats.behaviour === "boss") return;
    this.stagger = 1;
    const me = this.position2D;
    const nx = me.x + dir.x * distance;
    const nz = me.y + dir.y * distance;
    if (!circleHitsWall(level, nx, me.y, this.stats.radius)) this.root.position.x = nx;
    if (!circleHitsWall(level, this.root.position.x, nz, this.stats.radius)) this.root.position.z = nz;
    // Interrupt a wind-up: that's the point of shoving.
    if (this.state === "attack" && this.attackPhase === "windup") {
      this.attackPhase = "recover";
      this.attackTimer = this.stats.recover;
      this.attackDuration = this.stats.recover;
    }
  }

  protected die(vocal = false): void {
    this.diedOnCeiling = this.onCeiling || this.state === "drop";
    this.state = "dead";
    if (vocal) this.onVocal?.(this, "death");
  }

  /** Removes the enemy without a death scene (it was killed before a checkpoint). */
  removeFromPlay(): void {
    this.health = 0;
    this.state = "dead";
    this.root.visible = false;
  }

  /** A loud noise (gunshot) at `pos`. `radius` is already reduced for walls by the caller. */
  hearNoise(pos: THREE.Vector2, radius: number): void {
    if (this.isDead) return;
    if (this.position2D.distanceTo(pos) > radius * this.stats.hearing * this.mods.perception) return;
    this.lastKnown.copy(pos);
    if (this.onCeiling) {
      this.startDrop();
      return;
    }
    if (this.state === "drop") return;
    if (this.isHunting) {
      this.sinceContact = 0;
      return;
    }
    this.goInvestigate(pos);
  }

  /**
   * Walking over to look around because the hunt drew it (see `drawnTo`),
   * not because it noticed anything: it doesn't count as suspicious of you.
   */
  drawn = false;

  /** Wanders over to look around `pos`, not knowing what's there (the hunt drawing it towards you). */
  drawnTo(pos: THREE.Vector2): void {
    if (this.isDead || this.isHunting || this.state !== "patrol") return;
    this.drawn = true;
    this.state = "investigate";
    this.lastKnown.copy(pos);
    this.path = [];
    this.repathTimer = 0;
  }

  /** Starts hunting the player at `pos` straight away (freshly summoned creatures). */
  alertTo(pos: THREE.Vector2): void {
    if (this.isDead) return;
    this.lastKnown.copy(pos);
    this.sinceContact = 0;
    if (this.onCeiling) this.startDrop();
    else this.enterChase();
  }

  protected enterChase(): void {
    this.drawn = false;
    if (this.state !== "chase" && this.state !== "attack") this.onAlert?.(this);
    this.state = "chase";
    this.path = [];
    this.repathTimer = 0;
  }

  private goInvestigate(pos: THREE.Vector2): void {
    this.drawn = false;
    if (this.state === "patrol" || this.state === "lurk") this.onAlert?.(this);
    this.state = "investigate";
    this.lastKnown.copy(pos);
    this.path = [];
    this.repathTimer = 0;
  }

  private startDrop(): void {
    this.state = "drop";
    this.dropT = 0;
    this.onAlert?.(this);
  }

  /**
   * k = 1: upside down on the ceiling, hands and feet in the concrete; 0: on
   * the floor. In between it flips over as it falls.
   */
  private hangFromCeiling(k: number): void {
    const g = this.body.group;
    g.rotation.z = Math.PI * k;
    g.position.y = WALL_HEIGHT * (1 - (1 - k) * (1 - k));
  }

  /** Is the flashlight beam on this creature? */
  private inBeam(p: Perception, los: boolean): boolean {
    if (!p.torchOn || !los) return false;
    const chest = new THREE.Vector3(this.root.position.x, 1.1 * this.stats.scale, this.root.position.z).sub(p.eye);
    const d = chest.length();
    return d < BEAM_REACH && p.look.angleTo(chest) < BEAM_HALF_ANGLE + Math.atan2(0.4, d);
  }

  /**
   * Chooses which player to pay attention to: the closest one standing, but
   * it doesn't flip back and forth — it sticks with its current one unless
   * the other is clearly closer.
   */
  protected pickTarget(ps: Perception | Perception[]): Perception {
    if (!Array.isArray(ps)) {
      this.target = 0;
      return ps;
    }
    const me = this.position2D;
    const d = ps.map((q) => (q.playerDead ? Infinity : me.distanceTo(q.playerPos)));
    let best = d.indexOf(Math.min(...d));
    const current = this.target < ps.length ? this.target : 0;
    if (d[best] === Infinity) best = current;
    else if (best !== current && d[current] < d[best] + TARGET_STICK) best = current;
    this.target = best;
    return ps[best];
  }

  /** `ps` is one perception per player (a single one in solo play). */
  update(dt: number, level: LevelGrid, ps: Perception | Perception[], others: Enemy[]): void {
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.stagger = Math.max(0, this.stagger - dt * 2.5);

    if (this.isDead) {
      this.animateDeath(dt);
      return;
    }

    const p = this.pickTarget(ps);
    const me = this.position2D;
    const toPlayer = p.playerPos.clone().sub(me);
    const dist = toPlayer.length();
    const los = !p.playerDead && hasLineOfSight(level, me, p.playerPos);
    const angleTo = Math.atan2(toPlayer.x, toPlayer.y);
    const s = this.stats;

    // Anyone's beam holds a Watcher (and it stays held a moment after the beam moves on).
    const beamed =
      s.light === "freezes" &&
      this.state !== "drop" &&
      (Array.isArray(ps) ? ps : [ps]).some((q) => this.inBeam(q, q === p ? los : !q.playerDead && hasLineOfSight(level, me, q.playerPos)));
    this.lightHold = beamed ? FREEZE_HOLD : Math.max(0, this.lightHold - dt);
    this.frozen = beamed || (this.lightHold > 0 && this.state !== "drop");
    this.thaw = this.frozen ? 0 : Math.min(1, this.thaw + dt / THAW_TIME);

    // --- Sight (blind creatures skip it; "ignores" means the beam doesn't give you away) ---
    const hunting = this.isHunting;
    let canSee = false;
    if (s.sight > 0 && !p.playerDead) {
      const lit = p.torchOn && s.light !== "ignores";
      const sightRange = (lit ? SIGHT_LIT : SIGHT_DARK) * this.mods.perception * s.sight;
      const inCone = Math.abs(wrapAngle(angleTo - this.facing)) < VISION_HALF_ANGLE;
      // Once hunting, they track you all round (they know roughly where you are).
      canSee = !p.hidden && los && dist < sightRange && (inCone || hunting || dist < 2);
      if (canSee) {
        // Close = instant; far = suspicion builds over time (gives you a moment to duck away).
        // A light in the dark is different: it knows at once what that is.
        const rate = lit
          ? Math.max(LIT_SUSPICION_RATE, dist < sightRange * 0.4 ? 10 : 0)
          : dist < sightRange * 0.4
            ? 10
            : 1.6 + (1 - dist / sightRange) * 2;
        this.suspicion = Math.min(1, this.suspicion + rate * dt);
      }
      // Your beam on it: it sees the light coming from you, from as far as the beam reaches.
      if (!canSee && s.light === "sees" && this.inBeam(p, los)) this.suspicion = Math.min(1, this.suspicion + LIT_SUSPICION_RATE * dt);
    }
    if (!canSee) this.suspicion = Math.max(0, this.suspicion - dt * 0.35);
    // In a locker you're out of sight; one that watched you get in still knows where.
    if (!p.hidden) this.knowsHide = false;
    else if (this.sawTarget) this.knowsHide = true;
    this.sawTarget = canSee;
    if (p.hidden && this.knowsHide) this.lastKnown.copy(p.playerPos);
    const touch = !p.playerDead && los && dist < TOUCH_RANGE && (!p.hidden || this.knowsHide);

    // --- Hearing (movement noise; walls muffle it to 40%) ---
    const heardRadius = p.playerNoise * s.hearing * this.mods.perception * (los ? 1 : 0.4);
    const canHear = !p.playerDead && dist < heardRadius;

    // --- Ambushers ---
    if (this.state === "lurk") {
      this.speedNow = 0;
      if (this.onCeiling) {
        if (!p.playerDead && ((dist < DROP_RADIUS && los) || canHear || this.suspicion >= 1)) {
          this.lastKnown.copy(p.playerPos);
          this.startDrop();
        }
      } else if (!p.playerDead && ((dist < AMBUSH_RADIUS && los) || canHear || this.suspicion >= 1 || touch)) {
        this.lastKnown.copy(p.playerPos);
        this.sinceContact = 0;
        this.enterChase();
      } else {
        this.lureTimer -= dt;
        if (this.lureTimer <= 0 && !p.playerDead) {
          this.lureTimer = 9 + Math.random() * 8;
          this.onLure?.(this);
        }
      }
      this.finishFrame(dt, hunting);
      return;
    }
    if (this.state === "drop") {
      this.dropT += dt;
      const k = Math.min(1, this.dropT / DROP_TIME);
      this.hangFromCeiling(1 - k);
      if (k >= 1) {
        this.hangFromCeiling(0);
        this.onVocal?.(this, "drop");
        this.lastKnown.copy(p.playerDead ? me : p.playerPos);
        this.sinceContact = 0;
        this.stagger = 0.6;
        this.enterChase();
      }
      this.finishFrame(dt, true);
      return;
    }

    if (!p.playerDead && (this.suspicion >= 1 || touch || (hunting && (canSee || canHear)))) {
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

    this.rangedCooldown -= dt;
    // Locked by the light: it knows where you are, but it can't move or strike.
    if (this.frozen) {
      this.speedNow = 0;
      this.finishFrame(dt, this.isHunting);
      return;
    }

    switch (this.state) {
      case "patrol":
        this.updatePatrol(dt, level, others);
        break;
      case "investigate":
        if (this.followPathTo(dt, level, this.lastKnown, s.investigateSpeed, others)) {
          this.state = "search";
          this.searchTimer = SEARCH_TIME * 0.6;
        }
        break;
      case "chase":
        this.updateChase(dt, level, p, dist, los, angleTo, others);
        break;
      case "attack":
        this.updateAttack(dt, p, dist, los, angleTo, me);
        break;
      case "search":
        this.searchTimer -= dt;
        if (this.followPathTo(dt, level, this.lastKnown, s.investigateSpeed, others)) {
          // Look around at the spot.
          this.lookAround += dt;
          this.faceToward(this.facing + Math.sin(this.lookAround * 1.5) * 0.08, dt, 3);
          this.speedNow = 0;
        }
        if (this.searchTimer <= 0) {
          this.drawn = false;
          this.state = "patrol";
          this.patrolTarget = s.behaviour === "lurker" ? this.home.clone() : randomFloorNear(level, this.home.x, this.home.y, 2);
        }
        break;
    }
    this.finishFrame(dt, hunting);
  }

  private updateChase(dt: number, level: LevelGrid, p: Perception, dist: number, los: boolean, angleTo: number, others: Enemy[]): void {
    const s = this.stats;
    this.sinceContact += dt;
    if (this.sinceContact > LOSE_TIME) {
      this.state = "search";
      this.searchTimer = SEARCH_TIME;
      return;
    }
    const target = this.sinceContact < 0.2 ? p.playerPos : this.lastKnown;
    const speed = s.chaseSpeed * (this.mods.speed ?? 1) * (1 - this.stagger * 0.7);
    const r = s.behaviour === "ranged" ? s.ranged : undefined;
    // Someone hiding is only a target to one that saw them get in.
    const reachable = !p.hidden || this.knowsHide;
    if (dist < s.attackRange && los && reachable) {
      this.startAttack("melee");
    } else if (r && los && reachable && dist <= r.range && this.rangedCooldown <= 0 && this.sinceContact < 0.5) {
      this.startAttack("ranged");
    } else if (r && los && dist < r.minRange) {
      // Too close for comfort: back off, still facing you.
      const me = this.position2D;
      const away = me.clone().sub(p.playerPos).normalize();
      this.moveToward(dt, level, me, me.clone().addScaledVector(away, 1.5), s.investigateSpeed, others);
      this.faceToward(angleTo, dt, 10);
    } else if (r && los && dist < r.range * 0.8) {
      // In range: hold position and wait for the next spit.
      this.speedNow = 0;
      this.faceToward(angleTo, dt, 8);
    } else {
      this.followPathTo(dt, level, target, speed, others);
    }
  }

  private startAttack(kind: "melee" | "ranged"): void {
    this.state = "attack";
    this.attackKind = kind;
    this.attackPhase = "windup";
    this.attackDuration = kind === "melee" && this.stats.ranged ? Math.min(this.stats.windup, MELEE_WINDUP_MAX) : this.stats.windup;
    this.attackTimer = this.attackDuration;
    this.onVocal?.(this, kind === "ranged" ? "spit" : "windup");
  }

  private updateAttack(dt: number, p: Perception, dist: number, los: boolean, angleTo: number, me: THREE.Vector2): void {
    const s = this.stats;
    this.faceToward(angleTo, dt, 10);
    this.speedNow = 0;
    this.attackTimer -= dt;
    if (this.attackPhase === "windup" && this.attackTimer <= 0) {
      if (this.attackKind === "ranged") {
        const target = new THREE.Vector3(p.playerPos.x, Math.max(0.9, p.eye.y - 0.45), p.playerPos.y);
        if (!p.playerDead) this.onRanged?.(this, this.body.mouth(), target);
        this.rangedCooldown = (s.ranged?.cooldown ?? 2) * (0.8 + Math.random() * 0.4);
      } else if (dist < s.attackRange + 0.35 && los && !p.playerDead && (!p.hidden || this.knowsHide)) {
        // Strike lands only if you're still in reach (plus a little lunge).
        this.onAttackHit?.(s.attackDamage * this.mods.damage, me);
      }
      this.attackPhase = "recover";
      this.attackTimer = s.recover;
      this.attackDuration = s.recover;
    } else if (this.attackPhase === "recover" && this.attackTimer <= 0) {
      this.attackPhase = null;
      this.state = "chase";
    }
  }

  /** Vocals, facing and animation — the tail of every update. */
  protected finishFrame(dt: number, hunting: boolean): void {
    this.vocalTimer -= dt;
    if (this.vocalTimer <= 0) {
      this.vocalTimer = (hunting ? 2 : 5) + Math.random() * 6;
      // Mimics are silent except when they mean to be heard; frozen things can't make a sound.
      const silent = (this.stats.behaviour === "lurker" && this.state === "lurk") || this.frozen;
      // A puppet's voice comes from the host.
      if (!silent && !this.puppet) this.onVocal?.(this, "idle");
    }
    this.root.rotation.y = this.facing;
    this.animSpeed += (this.speedNow - this.animSpeed) * (1 - Math.exp(-ANIM_EASE * dt));
    this.walkPhase += dt * this.animSpeed * this.stats.stride;
    this.body.pose({
      time: this.time,
      speed: this.animSpeed,
      walkPhase: this.walkPhase,
      hunting: this.isHunting || this.state === "drop",
      attack:
        this.state === "attack" && this.attackPhase
          ? { kind: this.attackKind, phase: this.attackPhase, k: 1 - Math.max(0, this.attackTimer) / this.attackDuration }
          : null,
      stagger: this.stagger,
      frozen: this.frozen,
    });
    const agitation = this.isHunting ? 1 : this.state === "investigate" || this.state === "search" ? 0.5 : this.suspicion * 0.5;
    this.body.glow(this.hitFlash, agitation, this.time);
  }

  private updatePatrol(dt: number, level: LevelGrid, others: Enemy[]): void {
    if (this.stats.behaviour === "lurker") {
      // Mimics go back to their hiding place and wait.
      if (this.followPathTo(dt, level, this.home, this.stats.patrolSpeed, others)) this.state = "lurk";
      return;
    }
    if (this.patrolWait > 0) {
      this.patrolWait -= dt;
      this.speedNow = 0;
      return;
    }
    this.roamTime += dt;
    const arrived = this.followPathTo(dt, level, this.patrolTarget, this.stats.patrolSpeed, others);
    if (arrived || (this.roamer && this.roamTime > ROAM_GIVE_UP)) {
      this.roamTime = 0;
      if (this.roamer) {
        // Somewhere else, from wherever it is now: over time it drifts through the whole level.
        const me = this.position2D;
        this.patrolWait = 0.5 + Math.random() * 2;
        this.patrolTarget = randomFloorNear(level, me.x, me.y, ROAM_RADIUS);
      } else {
        this.patrolWait = 1.5 + Math.random() * 3;
        this.patrolTarget = randomFloorNear(level, this.home.x, this.home.y, 2);
      }
    }
  }

  /** Walk along a BFS path to `target`. Returns true once arrived. */
  protected followPathTo(dt: number, level: LevelGrid, target: THREE.Vector2, speed: number, others: Enemy[]): boolean {
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

  private moveToward(dt: number, level: LevelGrid, me: THREE.Vector2, target: THREE.Vector2, speed: number, others: Enemy[]): void {
    const dir = target.clone().sub(me);
    const d = dir.length();
    if (d < 0.001) return;
    dir.divideScalar(d);

    // Separation so a pack doesn't merge into one blob.
    for (const o of others) {
      if (o === this || o.isDead || o.onCeiling) continue;
      const away = me.clone().sub(o.position2D);
      const od = away.length();
      const minD = this.stats.radius + o.stats.radius + 0.2;
      if (od > 0.001 && od < minD) dir.addScaledVector(away.divideScalar(od), (minD - od) * 2);
    }
    dir.normalize();

    // Just out of the light, a Watcher starts slow and gathers speed.
    const step = Math.min(d, speed * (0.2 + 0.8 * this.thaw) * dt);
    const r = this.stats.radius;
    let nx = me.x + dir.x * step;
    let nz = me.y + dir.y * step;
    if (circleHitsWall(level, nx, me.y, r)) nx = me.x;
    if (circleHitsWall(level, nx, nz, r)) nz = me.y;
    this.root.position.x = nx;
    this.root.position.z = nz;
    this.speedNow = Math.hypot(nx - me.x, nz - me.y) / Math.max(dt, 1e-6);
    this.faceToward(Math.atan2(dir.x, dir.y), dt, 8);
  }

  protected faceToward(angle: number, dt: number, rate: number): void {
    this.facing += wrapAngle(angle - this.facing) * Math.min(1, rate * dt);
  }

  protected animateDeath(dt: number): void {
    this.deathT += dt;
    let t = this.deathT;
    if (this.diedOnCeiling) {
      // Fall from the ceiling first, then collapse.
      const fall = Math.min(1, t / DROP_TIME);
      this.hangFromCeiling(1 - fall);
      if (fall < 1) {
        this.body.glow(this.hitFlash, 0, this.time);
        return;
      }
      t -= DROP_TIME;
    }
    const k = Math.min(1, t / 0.7);
    this.body.die(1 - Math.pow(1 - k, 3));
  }

  // ------------------------------------------------------------------ co-op

  /**
   * This creature's state for the guest, flattened:
   * [x, z, facing, state, speed, attack, attackK, stagger, frozen, hitFlash, suspicion, health].
   * `attack` is 0 (none), 1/2 melee wind-up/recover, 3/4 ranged wind-up/recover.
   */
  netState(): number[] {
    const r = (v: number) => Math.round(v * 100) / 100;
    const attack = this.attackPhase ? (this.attackKind === "ranged" ? 3 : 1) + (this.attackPhase === "recover" ? 1 : 0) : 0;
    const k = this.attackPhase ? 1 - Math.max(0, this.attackTimer) / this.attackDuration : 0;
    return [
      r(this.root.position.x),
      r(this.root.position.z),
      r(this.facing),
      STATES.indexOf(this.state),
      r(this.speedNow),
      this.state === "attack" ? attack : 0,
      r(k),
      r(this.stagger),
      (this.frozen ? 1 : 0) + (this.drawn ? 2 : 0),
      r(this.hitFlash),
      r(this.suspicion),
      Math.round(this.health),
    ];
  }

  /** Puppet: take the host's latest state. */
  applyNet(a: number[]): void {
    const prev = this.net;
    if (prev && this.netAge > 0.01) {
      // Its speed from the last two snapshots, so it keeps moving between them.
      this.netVel.set((a[0] - prev[0]) / this.netAge, (a[1] - prev[1]) / this.netAge);
      if (this.netVel.length() > PUPPET_MAX_SPEED || Math.hypot(a[0] - prev[0], a[1] - prev[1]) > PUPPET_SNAP) this.netVel.set(0, 0);
    }
    this.netAge = 0;
    this.net = a;
    const state = STATES[a[3]] ?? "patrol";
    if (state === "dead" && !this.isDead) {
      this.diedOnCeiling = this.onCeiling || this.state === "drop";
      this.deathT = 0;
    }
    if (state === "drop" && this.state !== "drop") this.dropT = 0;
    this.state = state;
    this.health = a[11];
    this.hitFlash = Math.max(this.hitFlash, a[9]);
  }

  /** Puppet: glide toward the host's copy and animate like it. */
  updatePuppet(dt: number): void {
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    if (this.isDead) {
      this.animateDeath(dt);
      return;
    }
    const a = this.net;
    if (a) {
      this.netAge += dt;
      const k = 1 - Math.exp(-12 * dt);
      const p = this.root.position;
      // Where the host's copy is by now: the last snapshot carried forward at its speed
      // (only briefly, so a late or lost packet doesn't stop it dead, nor send it through a wall).
      const ahead = Math.min(this.netAge, PUPPET_EXTRAPOLATE) * (a[4] > 0.05 ? 1 : 0);
      const tx = a[0] + this.netVel.x * ahead;
      const tz = a[1] + this.netVel.y * ahead;
      if (Math.hypot(tx - p.x, tz - p.z) > PUPPET_SNAP) p.set(tx, p.y, tz);
      else {
        p.x += (tx - p.x) * k;
        p.z += (tz - p.z) * k;
      }
      this.facing += wrapAngle(a[2] - this.facing) * k;
      this.speedNow = a[4];
      const attack = a[5];
      this.attackPhase = attack === 0 ? null : attack % 2 === 1 ? "windup" : "recover";
      this.attackKind = attack >= 3 ? "ranged" : "melee";
      this.attackDuration = 1;
      this.attackTimer = 1 - a[6];
      this.stagger = a[7];
      this.frozen = (a[8] & 1) === 1;
      this.drawn = (a[8] & 2) === 2;
      this.suspicion = a[10];
    }
    if (this.onCeiling) this.hangFromCeiling(1);
    else if (this.state === "drop") {
      this.dropT += dt;
      this.hangFromCeiling(1 - Math.min(1, this.dropT / DROP_TIME));
    } else if (this.stats.behaviour === "ceiling") this.hangFromCeiling(0);
    this.finishFrame(dt, this.isHunting);
  }

  /** Guest: the creature flinches from a hit right away, before the host confirms it. */
  flash(amount = 1): void {
    this.hitFlash = Math.max(this.hitFlash, amount);
  }

  dispose(): void {
    this.scene.remove(this.root);
  }
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
