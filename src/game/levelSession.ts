import * as THREE from "three";
import type { SoundManager, Spatial } from "../audio/soundManager";
import type { DifficultyDef } from "../content/difficulty";
import type { EndingId } from "../content/story";
import { ITEMS } from "../content/items";
import { WEAPONS } from "../content/weapons";
import { ACTIONS, type Action } from "../core/actions";
import type { Engine } from "../core/engine";
import { EnemyManager } from "../enemies/enemyManager";
import { Effects } from "../fx/particles";
import { Pickup } from "../items/pickup";
import type { PlayerCommand } from "../player/command";
import { MAX_BATTERY } from "../player/flashlight";
import { DRY, NOISE_RADIUS, PlayerController, WATER } from "../player/playerController";
import type { Hud } from "../ui/hud";
import { Weapon } from "../weapons/weapon";
import type { Viewmodel } from "../weapons/viewmodel";
import { hasLineOfSight, raycastWorld, worldToCell } from "../world/grid";
import { CheckpointMarker, DetonatorConsole, Door, Generator, Intercom, type Interactable } from "../world/interactables";
import { LampSystem } from "../world/lamps";
import { buildLevel, type LevelData } from "../world/levelBuilder";
import type { LevelDef } from "../world/levelDef";
import { parseLevel } from "../world/levelParser";
import type { CheckpointState } from "./checkpoint";
import type { Loadout } from "./loadout";
import { RadioChannel } from "./radio";
import type { ScriptAction } from "./script";
import { freshStats, type RunStats } from "./stats";

const EXIT_RADIUS = 1.6;
const PICKUP_RADIUS = 1.1;
const MUZZLE_FLASH_TIME = 0.05;
const DOOR_NOISE = 9;
const GENERATOR_START_NOISE = 26;
const GENERATOR_HUM_NOISE = 11;
const GENERATOR_HUM_INTERVAL = 4.5;
/** cos of the widest angle off-centre you can be looking and still use something. */
const INTERACT_FACING = Math.cos(THREE.MathUtils.degToRad(55));

/** The systems a session renders and plays sound through; owned by `Game`, shared across levels. */
export interface SessionServices {
  engine: Engine;
  sound: SoundManager;
  hud: Hud;
  viewmodel: Viewmodel;
  /** Current key label for an action, for prompts and hints ("E", "Left Mouse"). */
  keyFor: (action: Action) => string;
}

/**
 * One level of gameplay: world, player, enemies, weapon, pickups, scripted
 * events and the rules that connect them. `Game` creates a session per level
 * attempt and throws it away afterwards, so no state can leak between levels.
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
  /** Fired once when the level is finished. The finale reports which ending was chosen. */
  onExit: ((ending: EndingId | null) => void) | null = null;
  /** Fired when progress should be saved mid-level. */
  onCheckpoint: ((state: CheckpointState) => void) | null = null;

  private readonly lamps: LampSystem;
  private readonly effects: Effects;
  private readonly pickups: Pickup[];
  private readonly doors: Door[];
  private readonly generators: Generator[];
  private readonly intercoms: Intercom[];
  private readonly consoles: DetonatorConsole[];
  private readonly interactables: Interactable[];
  private readonly markers: CheckpointMarker[];
  /** Trigger letter per cell index, for triggers not yet fired. */
  private readonly triggerCells = new Map<number, string>();
  private readonly firedTriggers = new Set<string>();
  private readonly waterCells = new Set<number>();
  private readonly radio: RadioChannel;
  private readonly muzzleLight: THREE.PointLight;
  private objective: string;
  private humTimer = 0;
  private muzzleTime = 0;
  private promptCooldown = 0;
  private damageFx = 0;
  private time = 0;
  private finished = false;

  constructor(
    private readonly services: SessionServices,
    readonly def: LevelDef,
    readonly difficulty: DifficultyDef,
    loadout: Loadout,
    restore: CheckpointState | null = null
  ) {
    const { engine, sound, hud, viewmodel } = services;
    const { scene, camera } = engine;
    engine.resetWorld();

    this.level = buildLevel(scene, parseLevel(def));
    const sp = this.level.spawns;
    const cellIndex = (c: { col: number; row: number }) => c.row * this.level.cols + c.col;
    this.lamps = new LampSystem(scene, sp.lamps, this.level.lampFixtures);
    this.effects = new Effects(scene);
    this.radio = new RadioChannel(hud, sound);
    this.objective = def.objective;

    this.player = new PlayerController(camera, this.level, sp.playerStart, def.spawnYaw);
    this.player.health.current = loadout.health;
    this.player.flashlight.battery = loadout.battery;
    this.player.flashlight.drainMultiplier = difficulty.batteryDrain;
    this.player.health.onDeath = () => this.handleDeath();
    this.player.health.onDamage = (amount, source) => this.handleDamage(amount, source);
    this.player.onFootstep = (gait, wet) => (wet ? sound.playSplash(gait) : sound.playFootstep(gait));
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

    // ---- interactables
    this.doors = sp.doors.map((d) => {
      const door = new Door(scene, this.level, d);
      door.isUnlocked = () => this.hasKeycard;
      door.onOpen = () => {
        sound.playDoor(this.spatial(door.pos), door.security);
        this.enemies.emitNoise(door.pos, DOOR_NOISE);
      };
      door.onLocked = () => {
        sound.playLocked();
        this.throttledPrompt("NEEDS THE KEYCARD");
      };
      return door;
    });
    this.generators = sp.generators.map((g) => {
      const gen = new Generator(scene, g);
      gen.onStart = () => this.handleGeneratorStarted(gen);
      return gen;
    });
    this.intercoms = sp.intercoms.map((s, i) => {
      const ic = new Intercom(scene, s, i);
      ic.onUse = () => {
        sound.playIntercom(this.spatial(ic.pos));
        this.run(def.intercoms?.[i] ?? []);
      };
      return ic;
    });
    this.consoles = sp.consoles.map((s) => {
      const c = new DetonatorConsole(scene, s);
      c.onUse = () => this.finish("seal");
      return c;
    });
    this.interactables = [...this.doors, ...this.generators, ...this.intercoms, ...this.consoles];
    this.markers = sp.checkpoints.map((c) => new CheckpointMarker(scene, c));
    for (const t of sp.triggers) this.triggerCells.set(cellIndex(t.cell), t.key);
    for (const w of sp.water) this.waterCells.add(cellIndex(w.cell));

    this.weapon = new Weapon(WEAPONS.pistol, loadout.reserve, loadout.mag);
    this.weapon.onFire = () => sound.playGunshot();
    this.weapon.onEmptyFire = () => sound.playEmptyClick();
    this.weapon.onReloadStart = () => sound.playReload(this.weapon.config.reloadTime);

    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 12, 1.6);
    this.muzzleLight.position.set(0.2, -0.1, -0.6);
    camera.add(this.muzzleLight);

    hud.setMagSize(this.weapon.config.magSize);
    hud.intro(def.name, def.subtitle);
    viewmodel.setVisible(true);

    if (restore) this.restore(restore);
    else this.run(def.events?.start ?? []);
    this.refreshObjective();
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

  private get powerOn(): boolean {
    return this.generators.every((g) => g.running);
  }

  /** The keycard opens security doors if there are any, otherwise the exit. */
  private get keycardLocksExit(): boolean {
    return this.level.spawns.keycards.length > 0 && !this.doors.some((d) => d.security);
  }

  // ------------------------------------------------------------------ simulation

  /** Advance one frame of live gameplay. */
  step(dt: number, cmd: PlayerCommand): void {
    const { engine, sound, viewmodel } = this.services;
    this.time += dt;
    this.stats.time += dt;
    this.promptCooldown = Math.max(0, this.promptCooldown - dt);

    const cell = worldToCell(this.player.position.x, this.player.position.z);
    const cellI = cell.row * this.level.cols + cell.col;
    this.player.terrain = this.waterCells.has(cellI) ? WATER : DRY;
    this.player.update(dt, cmd);
    this.checkTriggers();

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
    this.updateInteraction(dt, cmd.interact);
    this.updateGenerators(dt);
    this.radio.update(dt);
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

  // ------------------------------------------------------------------ scripting

  /** Runs level script actions in order. */
  run(actions: ScriptAction[]): void {
    const { hud, sound } = this.services;
    for (const a of actions) {
      switch (a.type) {
        case "radio":
          this.radio.say(a.lines);
          break;
        case "objective":
          this.objective = a.text;
          this.refreshObjective();
          break;
        case "hint":
          hud.prompt(
            a.text.replace(/\{(\w+)\}/g, (m, name: string) => this.keyLabel(name) ?? m),
            5
          );
          break;
        case "checkpoint":
          this.saveCheckpoint();
          break;
        case "alarm":
          this.enemies.emitNoise(this.player.position2D, a.radius);
          sound.playLocked();
          break;
      }
    }
  }

  private keyLabel(name: string): string | null {
    return (ACTIONS as readonly string[]).includes(name) ? this.services.keyFor(name as Action) : null;
  }

  private checkTriggers(): void {
    const { col, row } = worldToCell(this.player.position.x, this.player.position.z);
    const i = row * this.level.cols + col;
    const key = this.triggerCells.get(i);
    if (key && !this.firedTriggers.has(key)) {
      this.firedTriggers.add(key);
      this.run(this.def.triggers?.[key] ?? []);
    }
    for (const m of this.markers) {
      if (m.reached || m.spawn.cell.col !== col || m.spawn.cell.row !== row) continue;
      m.reached = true;
      this.saveCheckpoint();
    }
  }

  private saveCheckpoint(): void {
    this.services.sound.playCheckpoint();
    this.services.hud.toast("CHECKPOINT", "var(--ui-green)");
    this.onCheckpoint?.(this.snapshot());
  }

  /** The current state as a checkpoint. */
  snapshot(): CheckpointState {
    const idx = <T>(list: T[], pred: (t: T) => boolean) => list.flatMap((t, i) => (pred(t) ? [i] : []));
    return {
      x: this.player.position.x,
      z: this.player.position.z,
      yaw: this.player.facing,
      loadout: this.loadout,
      stats: { ...this.stats },
      collected: idx(this.pickups, (p) => p.collected),
      killed: idx(this.enemies.enemies, (e) => e.isDead),
      doorsOpen: idx(this.doors, (d) => d.isOpen),
      generatorsOn: idx(this.generators, (g) => g.running),
      intercomsUsed: idx(this.intercoms, (i) => i.used),
      markersReached: idx(this.markers, (m) => m.reached),
      firedTriggers: [...this.firedTriggers],
      hasKeycard: this.hasKeycard,
      objective: this.objective,
    };
  }

  private restore(s: CheckpointState): void {
    const at = <T>(list: T[], indices: number[], fn: (t: T) => void) => indices.forEach((i) => list[i] && fn(list[i]));
    this.player.position.x = s.x;
    this.player.position.z = s.z;
    this.player.setLook(s.yaw, 0);
    Object.assign(this.stats, s.stats);
    at(this.pickups, s.collected, (p) => p.collect());
    at(this.enemies.enemies, s.killed, (e) => e.removeFromPlay());
    at(this.doors, s.doorsOpen, (d) => d.open(true));
    at(this.generators, s.generatorsOn, (g) => g.start());
    at(this.intercoms, s.intercomsUsed, (i) => (i.used = true));
    at(this.markers, s.markersReached, (m) => (m.reached = true));
    for (const t of s.firedTriggers) this.firedTriggers.add(t);
    this.hasKeycard = s.hasKeycard;
    this.objective = s.objective;
  }

  // ------------------------------------------------------------------ interaction

  /** The thing the player is looking at and close enough to use, if any. */
  private focusedInteractable(): Interactable | null {
    const p = this.player.position2D;
    const yaw = this.player.facing;
    const fwd = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw));
    let best: Interactable | null = null;
    let bestScore = -Infinity;
    for (const it of this.interactables) {
      if (it.prompt === null) continue;
      const to = it.pos.clone().sub(p);
      const d = to.length();
      if (d > it.reach) continue;
      const facing = d < 0.8 ? 1 : to.divideScalar(d).dot(fwd);
      if (facing < INTERACT_FACING) continue;
      const score = facing - d * 0.2;
      if (score > bestScore) {
        best = it;
        bestScore = score;
      }
    }
    return best;
  }

  private updateInteraction(dt: number, pressed: boolean): void {
    for (const it of this.interactables) it.update(dt, this.time);
    for (const m of this.markers) m.update(this.time);
    const target = this.focusedInteractable();
    this.services.hud.interactPrompt(target ? this.services.keyFor("interact") : null, target?.prompt ?? null);
    if (target && pressed) target.interact();
  }

  private handleGeneratorStarted(gen: Generator): void {
    const { sound, hud } = this.services;
    sound.playGeneratorStart(this.spatial(gen.pos));
    this.enemies.emitNoise(gen.pos, GENERATOR_START_NOISE);
    const running = this.generators.filter((g) => g.running).length;
    if (this.powerOn) {
      hud.toast("POWER RESTORED", "var(--ui-green)");
      this.run(this.def.events?.power ?? []);
    } else {
      hud.toast(`GENERATOR ${running}/${this.generators.length} ONLINE`, "var(--ui-green)");
    }
    this.refreshObjective();
  }

  /** Running generators thrum every few seconds — and every thrum is a noise creatures can follow. */
  private updateGenerators(dt: number): void {
    if (!this.generators.some((g) => g.running)) return;
    this.humTimer -= dt;
    if (this.humTimer > 0) return;
    this.humTimer = GENERATOR_HUM_INTERVAL;
    for (const g of this.generators) {
      if (!g.running) continue;
      this.services.sound.playGeneratorHum(this.spatial(g.pos));
      this.enemies.emitNoise(g.pos, GENERATOR_HUM_NOISE);
    }
  }

  private refreshObjective(): void {
    const n = this.generators.length;
    const on = this.generators.filter((g) => g.running).length;
    const text = n > 0 && on < n ? `${this.objective} (${on}/${n})` : this.objective;
    this.services.hud.setObjective(`${this.def.name} — ${this.def.subtitle}`, text);
  }

  // ------------------------------------------------------------------ combat & pickups

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
          if (this.def.events?.keycard) this.run(this.def.events.keycard);
          else if (this.keycardLocksExit) {
            this.objective = "Reach the exit.";
            this.refreshObjective();
          }
          break;
        case "note":
          if (p.noteText) hud.showNote(p.noteText);
          break;
      }
      p.collect();
      sound.playPickup(p.type);
    }
  }

  // ------------------------------------------------------------------ exit & endings

  private exitLockReason(): string | null {
    if (this.keycardLocksExit && !this.hasKeycard) return "LOCKED — FIND THE KEYCARD";
    if (!this.powerOn) return "NO POWER — START THE GENERATORS";
    return null;
  }

  private checkExit(): void {
    const exit = this.level.spawns.exit;
    const reason = this.exitLockReason();
    this.level.exitSignMat.color.set(reason ? 0xff3a2a : 0xffffff);
    this.level.exitLight.color.set(reason ? 0xff3a2a : 0x4dff7a);
    if (Math.hypot(this.player.position.x - exit.x, this.player.position.z - exit.y) > EXIT_RADIUS) return;
    if (reason) {
      if (this.promptCooldown <= 0) this.services.sound.playLocked();
      this.throttledPrompt(reason);
      return;
    }
    this.finish(this.def.finale ? "leave" : null);
  }

  private finish(ending: EndingId | null): void {
    if (this.finished) return;
    this.finished = true;
    this.radio.clear();
    if (ending === "seal") this.services.sound.playDetonation();
    else this.services.sound.playLevelComplete();
    this.onExit?.(ending);
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
    this.radio.clear();
    this.services.sound.playDeath();
    this.onDeath?.();
  }

  // ------------------------------------------------------------------ helpers

  private updateHud(): void {
    const { engine, hud } = this.services;
    const noiseBars = Math.min(5, Math.round((this.player.noiseRadius / NOISE_RADIUS.sprint) * 5));
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
