import * as THREE from "three";
import type { SoundManager, Spatial } from "../audio/soundManager";
import type { DifficultyDef } from "../content/difficulty";
import { ITEMS } from "../content/items";
import { WEAPONS } from "../content/weapons";
import type { Engine } from "../core/engine";
import { EnemyManager } from "../enemies/enemyManager";
import { Effects } from "../fx/particles";
import { Pickup } from "../items/pickup";
import type { PlayerCommand } from "../player/command";
import { MAX_BATTERY } from "../player/flashlight";
import { NOISE_RADIUS, PlayerController } from "../player/playerController";
import type { Hud } from "../ui/hud";
import { Weapon } from "../weapons/weapon";
import type { Viewmodel } from "../weapons/viewmodel";
import { hasLineOfSight, raycastWorld } from "../world/grid";
import { LampSystem } from "../world/lamps";
import { buildLevel, type LevelData } from "../world/levelBuilder";
import type { LevelDef } from "../world/levelDef";
import { parseLevel } from "../world/levelParser";
import type { Loadout } from "./loadout";
import { freshStats, type RunStats } from "./stats";

const EXIT_RADIUS = 1.6;
const PICKUP_RADIUS = 1.1;
const MUZZLE_FLASH_TIME = 0.05;

/** The systems a session renders and plays sound through; owned by `Game`, shared across levels. */
export interface SessionServices {
  engine: Engine;
  sound: SoundManager;
  hud: Hud;
  viewmodel: Viewmodel;
}

/**
 * One level of gameplay: world, player, enemies, weapon, pickups and the
 * rules that connect them. `Game` creates a session per level attempt and
 * throws it away afterwards, so no state can leak between levels.
 */
export class LevelSession {
  readonly level: LevelData;
  readonly player: PlayerController;
  readonly enemies: EnemyManager;
  readonly weapon: Weapon;
  readonly stats: RunStats = freshStats();
  hasKeycard = false;

  /** Fired once when the player's health reaches zero. */
  onDeath: (() => void) | null = null;
  /** Fired once when the player reaches an unlocked exit. */
  onExit: (() => void) | null = null;

  private readonly lamps: LampSystem;
  private readonly effects: Effects;
  private readonly pickups: Pickup[];
  private readonly muzzleLight: THREE.PointLight;
  private muzzleTime = 0;
  private promptCooldown = 0;
  private damageFx = 0;
  private time = 0;
  private finished = false;

  constructor(
    private readonly services: SessionServices,
    readonly def: LevelDef,
    readonly difficulty: DifficultyDef,
    loadout: Loadout
  ) {
    const { engine, sound, hud, viewmodel } = services;
    const { scene, camera } = engine;
    engine.resetWorld();

    this.level = buildLevel(scene, parseLevel(def));
    const sp = this.level.spawns;
    this.lamps = new LampSystem(scene, sp.lamps, this.level.lampFixtures);
    this.effects = new Effects(scene);

    this.player = new PlayerController(camera, this.level, sp.playerStart, def.spawnYaw);
    this.player.health.current = loadout.health;
    this.player.flashlight.battery = loadout.battery;
    this.player.flashlight.drainMultiplier = difficulty.batteryDrain;
    this.player.health.onDeath = () => this.handleDeath();
    this.player.health.onDamage = (amount, source) => this.handleDamage(amount, source);
    this.player.onFootstep = (gait) => sound.playFootstep(gait);
    this.player.flashlight.onToggle = (on) => sound.playFlashlight(on);

    this.enemies = new EnemyManager(scene, this.level, sp.enemies, {
      health: difficulty.enemyHealth,
      damage: difficulty.enemyDamage,
      perception: difficulty.enemyPerception,
    });
    for (const e of this.enemies.enemies) {
      e.onAttackHit = (dmg, from) => this.player.health.takeDamage(dmg, from);
      e.onAlert = (en) => sound.playEnemy("alert", en.stats.voicePitch, this.spatial(en.position2D));
      e.onVocal = (en, kind) => sound.playEnemy(kind, en.stats.voicePitch, this.spatial(en.position2D));
    }

    this.pickups = [
      ...sp.ammo.map((p) => new Pickup(scene, "ammo", p)),
      ...sp.medkits.map((p) => new Pickup(scene, "medkit", p)),
      ...sp.batteries.map((p) => new Pickup(scene, "battery", p)),
      ...sp.keycards.map((p) => new Pickup(scene, "keycard", p)),
      ...sp.notes.map((n) => new Pickup(scene, "note", n.pos, n.text)),
    ];

    this.weapon = new Weapon(WEAPONS.pistol, loadout.reserve, loadout.mag);
    this.weapon.onFire = () => sound.playGunshot();
    this.weapon.onEmptyFire = () => sound.playEmptyClick();
    this.weapon.onReloadStart = () => sound.playReload(this.weapon.config.reloadTime);

    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 12, 1.6);
    this.muzzleLight.position.set(0.2, -0.1, -0.6);
    camera.add(this.muzzleLight);

    hud.setMagSize(this.weapon.config.magSize);
    hud.setObjective(`${def.name} — ${def.subtitle}`, def.objective);
    hud.intro(def.name, def.subtitle);
    viewmodel.setVisible(true);
  }

  /** What the player is carrying right now. */
  get loadout(): Loadout {
    return {
      health: this.player.health.current,
      battery: this.player.flashlight.battery,
      mag: this.weapon.ammoInMag,
      reserve: this.weapon.reserveAmmo,
    };
  }

  // ------------------------------------------------------------------ simulation

  /** Advance one frame of live gameplay. */
  step(dt: number, cmd: PlayerCommand): void {
    const { engine, sound, viewmodel } = this.services;
    this.time += dt;
    this.stats.time += dt;
    this.promptCooldown = Math.max(0, this.promptCooldown - dt);

    this.player.update(dt, cmd);
    this.enemies.update(dt, {
      playerPos: this.player.position2D,
      playerNoise: this.player.noiseRadius,
      torchOn: this.player.flashlight.on,
      playerDead: this.player.health.isDead,
    });
    this.weapon.update(dt);
    if (cmd.reload) this.weapon.tryReload();
    if (cmd.fire) this.fire();
    this.updatePickups(dt);
    this.lamps.update(dt, this.player.position, this.time);
    this.effects.update(dt, engine.camera, this.player.flashlight.level, this.time);

    this.muzzleTime -= dt;
    this.muzzleLight.intensity = this.muzzleTime > 0 ? 40 : 0;
    viewmodel.update(
      dt,
      this.player.lookDelta.x,
      this.player.lookDelta.y,
      this.player.moveFactor,
      this.player.isSprinting,
      this.weapon.reloadProgress,
      this.player.flashlight.level
    );

    const hp = this.player.health.fraction;
    this.damageFx = Math.max(0, this.damageFx - dt * 2.2);
    engine.setPostFx(this.damageFx, THREE.MathUtils.clamp((0.4 - hp) / 0.4, 0, 1), this.time);
    sound.updateHeartbeat(dt, hp);
    sound.updateAmbient(dt);
    this.updateHud();

    if (!this.finished) this.checkExit();
  }

  /** After death: the camera slumps while the world keeps moving. */
  stepDead(dt: number): void {
    const { engine } = this.services;
    this.time += dt;
    const cam = engine.camera;
    cam.position.y = THREE.MathUtils.lerp(cam.position.y, 0.35, 1 - Math.exp(-dt * 3));
    cam.rotation.z = THREE.MathUtils.lerp(cam.rotation.z, 0.9, 1 - Math.exp(-dt * 2));
    this.enemies.update(dt, { playerPos: this.player.position2D, playerNoise: 0, torchOn: false, playerDead: true });
    this.lamps.update(dt, this.player.position, this.time);
    this.effects.update(dt, cam, this.player.flashlight.level, this.time);
    this.damageFx = Math.max(0.4, this.damageFx - dt);
    engine.setPostFx(this.damageFx, 1, this.time);
  }

  private fire(): void {
    const { engine, sound, hud, viewmodel } = this.services;
    if (this.player.isSprinting) return;
    const cam = engine.camera;
    const shot = this.weapon.tryFire(
      cam.getWorldPosition(new THREE.Vector3()),
      cam.getWorldDirection(new THREE.Vector3()),
      this.player.moveFactor
    );
    if (!shot) return;

    this.stats.shots++;
    viewmodel.fire();
    this.player.addRecoil(0.03 + Math.random() * 0.01);
    this.player.addTrauma(0.12);
    this.muzzleTime = MUZZLE_FLASH_TIME;
    this.enemies.emitNoise(this.player.position2D, this.weapon.config.noiseRadius);

    const range = this.weapon.config.range;
    const wall = raycastWorld(this.level, shot.origin, shot.dir, range);
    const hit = this.enemies.raycast(new THREE.Ray(shot.origin, shot.dir), wall ? wall.distance : range);
    if (hit) {
      const dmg = this.weapon.config.damage * (hit.headshot ? this.weapon.config.headshotMultiplier : 1);
      const killed = hit.enemy.takeDamage(dmg, this.player.position2D);
      this.stats.hits++;
      if (hit.headshot) this.stats.headshots++;
      if (killed) this.stats.kills++;
      this.effects.bloodBurst(hit.point, shot.dir.clone(), killed ? 28 : 14);
      hud.hitMarker(hit.headshot, killed);
      sound.playHitmarker(hit.headshot);
    } else if (wall) {
      this.effects.impact(wall.point, wall.normal);
      sound.playImpact(this.spatial(new THREE.Vector2(wall.point.x, wall.point.z)));
    }
  }

  private updatePickups(dt: number): void {
    const { sound, hud } = this.services;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const amount = (base: number) => Math.round(base * this.difficulty.pickupMultiplier);

    for (const p of this.pickups) {
      if (p.collected) continue;
      p.update(dt);
      if (p.distanceTo(px, pz) > PICKUP_RADIUS) continue;

      switch (p.type) {
        case "ammo": {
          if (this.weapon.reserveAmmo >= this.weapon.config.reserveMax) {
            this.throttledPrompt("AMMO FULL");
            continue;
          }
          const got = this.weapon.addReserveAmmo(amount(ITEMS.ammo.amount));
          hud.toast(`+${got} ROUNDS`);
          break;
        }
        case "medkit": {
          const health = this.player.health;
          if (health.current >= health.max) {
            this.throttledPrompt("HEALTH FULL");
            continue;
          }
          const before = health.current;
          health.heal(amount(ITEMS.medkit.amount));
          hud.toast(`+${Math.round(health.current - before)} HEALTH`, "var(--ui-red)");
          break;
        }
        case "battery":
          if (this.player.flashlight.battery >= MAX_BATTERY - 1) {
            this.throttledPrompt("BATTERY FULL");
            continue;
          }
          this.player.flashlight.addBattery(amount(ITEMS.battery.amount));
          hud.toast("+ BATTERY", "var(--ui-blue)");
          break;
        case "keycard":
          this.hasKeycard = true;
          hud.toast("KEYCARD ACQUIRED", "var(--ui-green)");
          hud.setObjective(`${this.def.name} — ${this.def.subtitle}`, "Reach the exit.");
          break;
        case "note":
          if (p.noteText) hud.showNote(p.noteText);
          break;
      }
      p.collect();
      sound.playPickup(p.type);
    }
  }

  private get exitLocked(): boolean {
    return this.level.spawns.keycards.length > 0 && !this.hasKeycard;
  }

  private checkExit(): void {
    const exit = this.level.spawns.exit;
    const locked = this.exitLocked;
    this.level.exitSignMat.color.set(locked ? 0xff3a2a : 0xffffff);
    this.level.exitLight.color.set(locked ? 0xff3a2a : 0x4dff7a);
    if (Math.hypot(this.player.position.x - exit.x, this.player.position.z - exit.y) > EXIT_RADIUS) return;
    if (locked) {
      if (this.promptCooldown <= 0) this.services.sound.playLocked();
      this.throttledPrompt("LOCKED — FIND THE KEYCARD");
      return;
    }
    this.finished = true;
    this.services.sound.playLevelComplete();
    this.onExit?.();
  }

  private handleDamage(amount: number, source?: THREE.Vector2): void {
    this.stats.damageTaken += amount;
    this.damageFx = Math.min(1, this.damageFx + 0.6 + amount / 60);
    this.player.addTrauma(0.35 + amount / 80);
    this.services.sound.playPlayerHurt();
    if (source) this.services.hud.damageFrom(this.relativeAngle(source));
  }

  private handleDeath(): void {
    if (this.finished) return;
    this.finished = true;
    this.services.sound.playDeath();
    this.onDeath?.();
  }

  // ------------------------------------------------------------------ helpers

  private updateHud(): void {
    const { engine, hud } = this.services;
    const noiseBars = Math.round((this.player.noiseRadius / NOISE_RADIUS.sprint) * 5);
    const spread = this.weapon.currentSpread(this.player.moveFactor);
    const halfFov = Math.tan(THREE.MathUtils.degToRad(engine.camera.fov / 2));
    hud.update({
      health: this.player.health.fraction,
      stamina: this.player.stamina / 100,
      battery: this.player.flashlight.battery / MAX_BATTERY,
      torchOn: this.player.flashlight.on,
      mag: this.weapon.ammoInMag,
      magSize: this.weapon.config.magSize,
      reserve: this.weapon.reserveAmmo,
      reloading: this.weapon.isReloading,
      noise: this.weapon.bloom > 0.6 ? 5 : noiseBars,
      threat: this.enemies.threat,
      spreadPx: (Math.tan(spread) / halfFov) * (window.innerHeight / 2),
      hasKeycard: this.hasKeycard,
    });
  }

  private throttledPrompt(text: string): void {
    if (this.promptCooldown > 0) return;
    this.promptCooldown = 2;
    this.services.hud.prompt(text, 1.6);
  }

  /** Angle of a world point relative to where the player faces (0 = ahead, +right). */
  private relativeAngle(p: THREE.Vector2): number {
    const yaw = this.player.facing;
    const dx = p.x - this.player.position.x;
    const dz = p.y - this.player.position.z;
    const fwd = -Math.sin(yaw) * dx + -Math.cos(yaw) * dz;
    const right = Math.cos(yaw) * dx + -Math.sin(yaw) * dz;
    return Math.atan2(right, fwd);
  }

  private spatial(p: THREE.Vector2): Spatial {
    const me = this.player.position2D;
    return {
      pan: Math.sin(this.relativeAngle(p)),
      distance: me.distanceTo(p),
      muffled: !hasLineOfSight(this.level, me, p),
    };
  }
}
