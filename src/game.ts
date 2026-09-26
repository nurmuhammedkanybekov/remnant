import * as THREE from "three";
import { Engine } from "./core/engine";
import { Input } from "./core/input";
import { Clock } from "./core/clock";
import { loadSettings, saveSettings, type Settings } from "./core/settings";
import { buildLevel, raycastWorld, hasLineOfSight, type LevelData } from "./world/level";
import { LampSystem } from "./world/lamps";
import { LEVELS } from "./world/levels";
import { PlayerController, NOISE_RADIUS } from "./player/playerController";
import { MAX_BATTERY } from "./player/flashlight";
import { EnemyManager } from "./enemies/enemyManager";
import type { Enemy } from "./enemies/enemy";
import { Pickup } from "./items/pickup";
import { createPistol } from "./weapons/pistol";
import type { Weapon } from "./weapons/weapon";
import { Viewmodel } from "./weapons/viewmodel";
import { SoundManager, type Spatial } from "./audio/soundManager";
import { Effects } from "./fx/particles";
import { Hud } from "./ui/hud";
import { Screens, type RunStats } from "./ui/menu";

type GameState = "menu" | "playing" | "paused" | "dead" | "levelComplete" | "victory";

const EXIT_RADIUS = 1.6;
const AMMO_PICKUP = 8;
const MEDKIT_HEAL = 45;
const BATTERY_CHARGE = 45;

/** What carries over from one level to the next. */
interface Carry {
  health: number;
  battery: number;
  mag: number;
  reserve: number;
}

const FRESH_CARRY: Carry = { health: 100, battery: MAX_BATTERY, mag: 8, reserve: 16 };

function freshStats(): RunStats {
  return { time: 0, kills: 0, shots: 0, hits: 0, headshots: 0, damageTaken: 0 };
}

export class Game {
  private readonly engine: Engine;
  private readonly input: Input;
  private readonly clock = new Clock();
  private readonly sound = new SoundManager();
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly viewmodel: Viewmodel;
  private readonly settings: Settings = loadSettings();
  private readonly debug = new URLSearchParams(location.search).has("debug");

  private state: GameState = "menu";
  private levelIndex = 0;
  private level!: LevelData;
  private lamps!: LampSystem;
  private effects!: Effects;
  private player!: PlayerController;
  private enemies!: EnemyManager;
  private pickups: Pickup[] = [];
  private weapon!: Weapon;
  private muzzleLight!: THREE.PointLight;
  private muzzleTime = 0;
  private hasKeycard = false;
  private lockedPromptCooldown = 0;
  private damageFx = 0;
  private time = 0;
  private carry: Carry = { ...FRESH_CARRY };
  private levelStartCarry: Carry = { ...FRESH_CARRY };
  private stats: RunStats = freshStats();
  private totalStats: RunStats = freshStats();
  private menuYaw = 0;

  constructor(container: HTMLElement) {
    this.engine = new Engine(container);
    this.engine.setFov(this.settings.fov);
    this.input = new Input(this.engine.domElement);
    this.hud = new Hud(container);
    this.screens = new Screens(container);
    this.screens.onUiSound = () => this.sound.playUi();
    this.viewmodel = new Viewmodel(this.engine.viewScene, this.engine.camera);
    this.hud.setVisible(false);
    this.sound.setVolume(this.settings.volume);

    document.addEventListener("pointerlockchange", () => {
      if (!this.input.locked && this.state === "playing" && !this.debug) this.pause();
    });
    // Clicking the game view while paused-by-focus-loss resumes.
    this.engine.domElement.addEventListener("click", () => {
      if (this.state === "playing" && !this.input.locked && !this.debug) this.input.requestLock();
    });

    if (this.debug) (window as unknown as { game: Game }).game = this;

    this.showMainMenu();
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ menus

  private showMainMenu(): void {
    this.state = "menu";
    this.hud.setVisible(false);
    this.viewmodel.setVisible(false);
    this.buildMenuBackdrop();
    this.screens.main([
      { label: "New Game", primary: true, action: () => this.newGame() },
      { label: "Settings", action: () => this.showSettings(() => this.showMainMenu()) },
      { label: "Controls", action: () => this.screens.controls(() => this.showMainMenu()) },
    ]);
  }

  private showSettings(back: () => void): void {
    this.screens.settings(
      this.settings,
      (s) => {
        saveSettings(s);
        this.engine.setFov(s.fov);
        this.sound.setVolume(s.volume);
      },
      back
    );
  }

  private pause(): void {
    this.state = "paused";
    this.sound.setPaused(true);
    this.hud.hideTransient();
    const show = () =>
      this.screens.pause([
        { label: "Resume", primary: true, action: () => this.resume() },
        { label: "Restart Level", action: () => this.restartLevel() },
        { label: "Settings", action: () => this.showSettings(show) },
        { label: "Controls", action: () => this.screens.controls(show) },
        { label: "Quit to Menu", action: () => this.showMainMenu() },
      ]);
    show();
  }

  private resume(): void {
    this.screens.hide();
    this.sound.setPaused(false);
    this.input.requestLock();
    this.clock.tick(); // don't let the pause count as a giant frame
    this.state = "playing";
  }

  // ------------------------------------------------------------------ flow

  private newGame(): void {
    this.sound.init();
    this.levelIndex = 0;
    this.carry = { ...FRESH_CARRY };
    this.totalStats = freshStats();
    this.startLevel();
  }

  private restartLevel(): void {
    this.carry = { ...this.levelStartCarry };
    this.startLevel();
  }

  private nextLevel(): void {
    this.levelIndex++;
    this.startLevel();
  }

  private clearScene(): void {
    const { scene, camera } = this.engine;
    for (const child of [...scene.children]) {
      if (child === camera) continue;
      scene.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
    }
    camera.clear(); // drops the previous level's flashlight + muzzle light
  }

  /** A slowly turning view of the first level behind the main menu. */
  private buildMenuBackdrop(): void {
    this.clearScene();
    this.level = buildLevel(this.engine.scene, LEVELS[0]);
    this.lamps = new LampSystem(this.engine.scene, this.level.spawns.lamps);
    this.effects = new Effects(this.engine.scene);
    const s = this.level.spawns.playerStart;
    this.engine.camera.position.set(s.x + 1, 1.6, s.y);
    this.engine.camera.rotation.set(0, -Math.PI / 2, 0, "YXZ");
    this.menuYaw = -Math.PI / 2;
    // A dim "flashlight" so the menu scene isn't pitch black.
    const l = new THREE.SpotLight(0xe8eeff, 30, 20, Math.PI / 5, 0.7, 1.5);
    const target = new THREE.Object3D();
    target.position.set(0, -0.3, -5);
    this.engine.camera.add(l, target);
    l.target = target;
  }

  private startLevel(): void {
    const def = LEVELS[this.levelIndex];
    this.clearScene();
    this.screens.hide();
    this.hud.hideTransient();
    this.levelStartCarry = { ...this.carry };
    this.stats = freshStats();
    this.hasKeycard = false;
    this.damageFx = 0;

    const { scene, camera } = this.engine;
    this.level = buildLevel(scene, def);
    const sp = this.level.spawns;
    this.lamps = new LampSystem(scene, sp.lamps);
    this.effects = new Effects(scene);

    this.player = new PlayerController(camera, this.level, sp.playerStart, def.spawnYaw, this.settings);
    this.player.health.current = this.carry.health;
    this.player.flashlight.battery = this.carry.battery;
    this.player.health.onDeath = () => this.onDeath();
    this.player.health.onDamage = (amount, source) => this.onPlayerDamaged(amount, source);
    this.player.onFootstep = (gait) => this.sound.playFootstep(gait);
    this.player.flashlight.onToggle = (on) => this.sound.playFlashlight(on);

    this.enemies = new EnemyManager(scene, this.level, sp.enemies);
    for (const e of this.enemies.enemies) {
      e.onAttackHit = (dmg, from) => this.player.health.takeDamage(dmg, from);
      e.onAlert = (en) => this.sound.playEnemy("alert", en.kind === "brute", this.spatial(en.position2D));
      e.onVocal = (en, kind) => this.sound.playEnemy(kind, en.kind === "brute", this.spatial(en.position2D));
    }

    this.pickups = [
      ...sp.ammo.map((p) => new Pickup(scene, "ammo", p)),
      ...sp.medkits.map((p) => new Pickup(scene, "medkit", p)),
      ...sp.batteries.map((p) => new Pickup(scene, "battery", p)),
      ...sp.keycards.map((p) => new Pickup(scene, "keycard", p)),
      ...sp.notes.map((n) => new Pickup(scene, "note", n.pos, n.text)),
    ];

    this.weapon = createPistol(this.carry.reserve, this.carry.mag);
    this.weapon.onFire = () => this.sound.playGunshot();
    this.weapon.onEmptyFire = () => this.sound.playEmptyClick();
    this.weapon.onReloadStart = () => this.sound.playReload(this.weapon.config.reloadTime);
    this.hud.setMagSize(this.weapon.config.magSize);

    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 12, 1.6);
    this.muzzleLight.position.set(0.2, -0.1, -0.6);
    camera.add(this.muzzleLight);

    this.hud.setObjective(`${def.name} — ${def.subtitle}`, def.objective);
    this.hud.setVisible(true);
    this.hud.intro(def.name, def.subtitle);
    this.viewmodel.setVisible(true);

    this.sound.init();
    this.sound.setPaused(false);
    if (!this.debug) this.input.requestLock();
    this.clock.tick();
    this.state = "playing";
  }

  private onPlayerDamaged(amount: number, source?: THREE.Vector2): void {
    this.stats.damageTaken += amount;
    this.damageFx = Math.min(1, this.damageFx + 0.6 + amount / 60);
    this.player.addTrauma(0.35 + amount / 80);
    this.sound.playPlayerHurt();
    if (source) this.hud.damageFrom(this.relativeAngle(source));
  }

  private onDeath(): void {
    this.state = "dead";
    this.sound.playDeath();
    this.input.exitLock();
    this.hud.hideTransient();
    this.viewmodel.setVisible(false);
    this.accumulate();
    window.setTimeout(() => {
      this.screens.death(this.stats, [
        { label: "Retry Level", primary: true, action: () => this.restartLevel() },
        { label: "Quit to Menu", action: () => this.showMainMenu() },
      ]);
      this.hud.setVisible(false);
    }, 1400);
  }

  private onExitReached(): void {
    this.sound.playLevelComplete();
    this.input.exitLock();
    this.hud.setVisible(false);
    this.hud.hideTransient();
    this.viewmodel.setVisible(false);
    this.accumulate();
    this.carry = {
      health: Math.max(this.player.health.current, 40), // a breather between levels
      battery: Math.max(this.player.flashlight.battery, 30),
      mag: this.weapon.ammoInMag,
      reserve: this.weapon.reserveAmmo,
    };
    if (this.levelIndex >= LEVELS.length - 1) {
      this.state = "victory";
      this.screens.victory(this.totalStats, [{ label: "Main Menu", primary: true, action: () => this.showMainMenu() }]);
    } else {
      this.state = "levelComplete";
      const def = LEVELS[this.levelIndex];
      this.screens.levelComplete(def.name, def.subtitle, this.stats, [
        { label: "Continue", primary: true, action: () => this.nextLevel() },
        { label: "Quit to Menu", action: () => this.showMainMenu() },
      ]);
    }
  }

  private accumulate(): void {
    const t = this.totalStats;
    const s = this.stats;
    t.time += s.time;
    t.kills += s.kills;
    t.shots += s.shots;
    t.hits += s.hits;
    t.headshots += s.headshots;
    t.damageTaken += s.damageTaken;
  }

  // ------------------------------------------------------------------ helpers

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
    if (!this.player) return { pan: 0, distance: 0, muffled: false };
    const me = this.player.position2D;
    return {
      pan: Math.sin(this.relativeAngle(p)),
      distance: me.distanceTo(p),
      muffled: !hasLineOfSight(this.level, me, p),
    };
  }

  // ------------------------------------------------------------------ gameplay

  private handleShooting(): void {
    if (this.input.wasJustPressed("KeyR")) this.weapon.tryReload();
    if (!this.input.wasMouseJustPressed()) return;
    if (!this.input.locked && !this.debug) return;
    if (this.player.isSprinting) return;

    const shot = this.weapon.tryFire(this.engine.camera, this.player.moveFactor);
    if (!shot) return;
    this.stats.shots++;
    this.viewmodel.fire();
    this.player.addRecoil(0.03 + Math.random() * 0.01);
    this.player.addTrauma(0.12);
    this.muzzleTime = 0.05;
    this.enemies.emitNoise(this.player.position2D, this.weapon.config.noiseRadius);

    const range = this.weapon.config.range;
    const wall = raycastWorld(this.level, shot.origin, shot.dir, range);
    const ray = new THREE.Ray(shot.origin, shot.dir);
    const hit = this.enemies.raycast(ray, wall ? wall.distance : range);
    if (hit) {
      const dmg = this.weapon.config.damage * (hit.headshot ? this.weapon.config.headshotMultiplier : 1);
      const killed = hit.enemy.takeDamage(dmg, this.player.position2D);
      this.stats.hits++;
      if (hit.headshot) this.stats.headshots++;
      if (killed) this.stats.kills++;
      this.effects.bloodBurst(hit.point, shot.dir.clone(), killed ? 28 : 14);
      this.hud.hitMarker(hit.headshot, killed);
      this.sound.playHitmarker(hit.headshot);
    } else if (wall) {
      this.effects.impact(wall.point, wall.normal);
      this.sound.playImpact(this.spatial(new THREE.Vector2(wall.point.x, wall.point.z)));
    }
  }

  private handlePickups(dt: number): void {
    const px = this.player.position.x;
    const pz = this.player.position.z;
    for (const p of this.pickups) {
      if (p.collected) continue;
      p.update(dt);
      if (p.distanceTo(px, pz) > 1.1) continue;

      switch (p.type) {
        case "ammo": {
          if (this.weapon.reserveAmmo >= this.weapon.config.reserveMax) {
            this.throttledPrompt("AMMO FULL");
            continue;
          }
          const got = this.weapon.addReserveAmmo(AMMO_PICKUP);
          this.hud.toast(`+${got} ROUNDS`);
          break;
        }
        case "medkit": {
          if (this.player.health.current >= this.player.health.max) {
            this.throttledPrompt("HEALTH FULL");
            continue;
          }
          this.player.health.heal(MEDKIT_HEAL);
          this.hud.toast(`+${MEDKIT_HEAL} HEALTH`, "var(--ui-red)");
          break;
        }
        case "battery":
          if (this.player.flashlight.battery >= MAX_BATTERY - 1) {
            this.throttledPrompt("BATTERY FULL");
            continue;
          }
          this.player.flashlight.addBattery(BATTERY_CHARGE);
          this.hud.toast("+ BATTERY", "var(--ui-blue)");
          break;
        case "keycard":
          this.hasKeycard = true;
          this.hud.toast("KEYCARD ACQUIRED", "var(--ui-green)");
          this.hud.setObjective(`${this.level.def.name} — ${this.level.def.subtitle}`, "Reach the exit.");
          break;
        case "note":
          if (p.noteText) this.hud.showNote(p.noteText);
          break;
      }
      p.collect();
      this.sound.playPickup(p.type);
    }
  }

  private throttledPrompt(text: string): void {
    if (this.lockedPromptCooldown > 0) return;
    this.lockedPromptCooldown = 2;
    this.hud.prompt(text, 1.6);
  }

  private checkExit(): void {
    const exit = this.level.spawns.exit;
    const locked = this.level.spawns.keycards.length > 0 && !this.hasKeycard;
    // Sign goes red while locked.
    this.level.exitSignMat.color.set(locked ? 0xff3a2a : 0xffffff);
    this.level.exitLight.color.set(locked ? 0xff3a2a : 0x4dff7a);
    const d = Math.hypot(this.player.position.x - exit.x, this.player.position.z - exit.y);
    if (d > EXIT_RADIUS) return;
    if (locked) {
      if (this.lockedPromptCooldown <= 0) this.sound.playLocked();
      this.throttledPrompt("LOCKED — FIND THE KEYCARD");
      return;
    }
    this.onExitReached();
  }

  // ------------------------------------------------------------------ loop

  private readonly loop = (): void => {
    this.step(this.clock.tick());
    this.input.endFrame();
    this.engine.render();
    requestAnimationFrame(this.loop);
  };

  private step(dt: number): void {
    this.time += dt;

    if (this.state === "menu") {
      this.menuYaw += dt * 0.08;
      this.engine.camera.rotation.set(Math.sin(this.time * 0.3) * 0.05 - 0.05, this.menuYaw, 0, "YXZ");
      this.lamps.update(dt, this.engine.camera.position, this.time);
      this.effects.update(dt, this.engine.camera, 0.8, this.time);
      this.engine.setPostFx(0, 0, this.time);
      this.sound.updateAmbient(dt);
    } else if (this.state === "playing") {
      this.stats.time += dt;
      // Pointer lock can be refused (e.g. resuming too quickly after Esc) — tell the player to click.
      if (!this.input.locked && !this.debug) this.hud.prompt("CLICK TO RESUME", 0.25);
      this.lockedPromptCooldown = Math.max(0, this.lockedPromptCooldown - dt);
      const lookDX = this.input.locked ? this.input.mouseDeltaX : 0;
      const lookDY = this.input.locked ? this.input.mouseDeltaY : 0;

      this.player.update(dt, this.input);
      this.enemies.update(dt, {
        playerPos: this.player.position2D,
        playerNoise: this.player.noiseRadius,
        torchOn: this.player.flashlight.on,
        playerDead: this.player.health.isDead,
      });
      this.weapon.update(dt);
      this.handleShooting();
      this.handlePickups(dt);
      this.lamps.update(dt, this.player.position, this.time);
      this.effects.update(dt, this.engine.camera, this.player.flashlight.level, this.time);

      this.muzzleTime -= dt;
      this.muzzleLight.intensity = this.muzzleTime > 0 ? 40 : 0;
      this.viewmodel.update(
        dt,
        lookDX,
        lookDY,
        this.player.moveFactor,
        this.player.isSprinting,
        this.weapon.reloadProgress,
        this.player.flashlight.level
      );

      const hp = this.player.health.fraction;
      this.damageFx = Math.max(0, this.damageFx - dt * 2.2);
      this.engine.setPostFx(this.damageFx, THREE.MathUtils.clamp((0.4 - hp) / 0.4, 0, 1), this.time);
      this.sound.updateHeartbeat(dt, hp);
      this.sound.updateAmbient(dt);

      const noiseBars = Math.round((this.player.noiseRadius / NOISE_RADIUS.sprint) * 5);
      const spread = this.weapon.currentSpread(this.player.moveFactor);
      const spreadPx = (Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(this.engine.camera.fov / 2))) * (window.innerHeight / 2);
      this.hud.update({
        health: hp,
        stamina: this.player.stamina / 100,
        battery: this.player.flashlight.battery / MAX_BATTERY,
        torchOn: this.player.flashlight.on,
        mag: this.weapon.ammoInMag,
        magSize: this.weapon.config.magSize,
        reserve: this.weapon.reserveAmmo,
        reloading: this.weapon.isReloading,
        noise: this.weapon.bloom > 0.6 ? 5 : noiseBars,
        threat: this.enemies.threat,
        spreadPx,
        hasKeycard: this.hasKeycard,
      });

      if (this.state === "playing") this.checkExit();
    } else if (this.state === "dead") {
      // Slump to the floor.
      const cam = this.engine.camera;
      cam.position.y = THREE.MathUtils.lerp(cam.position.y, 0.35, 1 - Math.exp(-dt * 3));
      cam.rotation.z = THREE.MathUtils.lerp(cam.rotation.z, 0.9, 1 - Math.exp(-dt * 2));
      this.enemies.update(dt, {
        playerPos: this.player.position2D,
        playerNoise: 0,
        torchOn: false,
        playerDead: true,
      });
      this.lamps.update(dt, this.player.position, this.time);
      this.effects.update(dt, cam, this.player.flashlight.level, this.time);
      this.damageFx = Math.max(0.4, this.damageFx - dt);
      this.engine.setPostFx(this.damageFx, 1, this.time);
    } else {
      this.engine.setPostFx(0, 0, this.time);
    }
  }

  // ------------------------------------------------------------------ debug hooks (?debug only)

  debugStart(level = 0): void {
    this.sound.init();
    this.levelIndex = level;
    this.carry = { ...FRESH_CARRY };
    this.startLevel();
  }
  debugLook(yaw: number, pitch: number): void {
    this.player.setLook(yaw, pitch);
  }
  debugTeleport(x: number, z: number): void {
    this.player.position.x = x;
    this.player.position.z = z;
  }
  debugEnemies(): Enemy[] {
    return this.enemies.enemies;
  }
  /** Advance the simulation without rendering (headless testing). */
  debugSimulate(seconds: number, keys: string[] = []): void {
    const input = this.input as unknown as { keys: Set<string> };
    for (const k of keys) input.keys.add(k);
    for (let t = 0; t < seconds; t += 1 / 30) {
      this.step(1 / 30);
      this.input.endFrame();
    }
    for (const k of keys) input.keys.delete(k);
  }
  debugFire(): void {
    (this.input as unknown as { mouseJustPressed: boolean }).mouseJustPressed = true;
    this.step(1 / 30);
    this.input.endFrame();
  }
  debugState(): string {
    return this.state;
  }
}
