import * as THREE from "three";
import type { SoundManager, Spatial } from "../audio/soundManager";
import type { DifficultyDef } from "../content/difficulty";
import { MIMIC_LINES, type EndingId } from "../content/story";
import { HEAL_TIME, ITEMS, MAX_MEDKITS } from "../content/items";
import { WEAPON_ORDER, WEAPONS, type WeaponId } from "../content/weapons";
import { ACTIONS, type Action } from "../core/actions";
import type { Engine } from "../core/engine";
import type { QualityPreset } from "../core/quality";
import { RemnantBoss } from "../enemies/boss";
import type { Enemy, Perception } from "../enemies/enemy";
import { EnemyManager } from "../enemies/enemyManager";
import { Projectiles } from "../enemies/projectiles";
import { Effects } from "../fx/particles";
import { Pickup } from "../items/pickup";
import type { PlayerCommand } from "../player/command";
import { MAX_BATTERY } from "../player/flashlight";
import { DRY, NOISE_RADIUS, PlayerController, WATER } from "../player/playerController";
import type { Hud } from "../ui/hud";
import { Weapon } from "../weapons/weapon";
import type { Viewmodel } from "../weapons/viewmodel";
import { hasLineOfSight, isSolid, raycastWorld, worldToCell } from "../world/grid";
import { CheckpointMarker, DetonatorConsole, Door, Generator, Intercom, type Interactable } from "../world/interactables";
import { LampSystem } from "../world/lamps";
import { buildLevel, type LevelData } from "../world/levelBuilder";
import type { LevelDef } from "../world/levelDef";
import { parseLevel } from "../world/levelParser";
import type { CheckpointState } from "./checkpoint";
import type { Loadout, WeaponAmmo } from "./loadout";
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
const SWITCH_TIME = 0.45;
const MELEE_COOLDOWN = 0.55;
const MELEE_RANGE = 1.9;
const MELEE_DAMAGE = 20;
const MELEE_NOISE = 4;
const TAKEDOWN_NOISE = 1.5;
const MELEE_FACING = Math.cos(THREE.MathUtils.degToRad(50));
/** Ammo picked up this close to the boss while it is awake comes back after RESTOCK_TIME seconds. */
const RESTOCK_RADIUS = 40;
const RESTOCK_TIME = 25;
const AMMO_LABEL: Record<WeaponId, string> = { pistol: "ROUNDS", rivet: "RIVETS", shotgun: "SHELLS" };

/** The systems a session renders and plays sound through; owned by `Game`, shared across levels. */
export interface SessionServices {
  engine: Engine;
  sound: SoundManager;
  hud: Hud;
  viewmodel: Viewmodel;
  /** Current key label for an action, for prompts and hints ("E", "Left Mouse", or "A" on a gamepad). */
  keyFor: (action: Action) => string;
  /** Graphics quality, read when the level is built. */
  quality: () => QualityPreset;
  /** 1 normally; lower with "reduced camera shake". */
  motionScale: () => number;
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
  readonly stats: RunStats = freshStats();
  hasKeycard = false;
  medkits: number;
  /** Carried weapons, by id. */
  private readonly weapons = new Map<WeaponId, Weapon>();
  private currentWeapon: WeaponId;

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
  private readonly projectiles: Projectiles;
  private readonly boss: RemnantBoss | null;
  private objective: string;
  private switchTimer = 0;
  private healTimer = 0;
  private meleeCooldown = 0;
  private healHintShown = false;
  private armouredHits = 0;
  /** Supplies in the boss arena come back while the fight goes on: [pickup, seconds left]. */
  private readonly restock: [Pickup, number][] = [];
  /** Everything the boss has birthed; it dies with its mother. */
  private readonly brood = new Set<Enemy>();
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

    const quality = services.quality();
    this.level = buildLevel(scene, parseLevel(def), quality.bumpMaps);
    const sp = this.level.spawns;
    const cellIndex = (c: { col: number; row: number }) => c.row * this.level.cols + c.col;
    this.lamps = new LampSystem(scene, sp.lamps, this.level.lampFixtures, quality.lampLights);
    this.effects = new Effects(scene, quality.dustMotes);
    this.radio = new RadioChannel(hud, sound);
    this.objective = def.objective;

    // A checkpoint carries the loadout from the moment it was reached.
    const start = restore?.loadout ?? loadout;
    this.player = new PlayerController(camera, this.level, sp.playerStart, def.spawnYaw);
    this.player.motionScale = services.motionScale();
    this.player.health.current = start.health;
    this.player.flashlight.battery = start.battery;
    this.medkits = start.medkits;
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
    this.projectiles = new Projectiles(scene, this.level);
    this.projectiles.onHitPlayer = (dmg, from) => this.player.health.takeDamage(dmg, from);
    this.projectiles.onSplash = (at) => {
      this.effects.acidSplash(at);
      sound.playAcidSplash(this.spatial(new THREE.Vector2(at.x, at.z)));
    };
    this.enemies.onSpawned = (e) => this.wireEnemy(e);
    this.enemies.wireAll();
    this.boss = this.enemies.boss;

    this.pickups = [
      ...sp.items.map((i) => new Pickup(scene, i.type, i.pos)),
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

    for (const id of WEAPON_ORDER) {
      const ammo = start.weapons[id];
      if (ammo) this.addWeapon(id, ammo);
    }
    this.currentWeapon = this.weapons.has(start.current) ? start.current : "pistol";

    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 12, 1.6);
    this.muzzleLight.position.set(0.2, -0.1, -0.6);
    camera.add(this.muzzleLight);

    hud.setMagSize(this.weapon.config.magSize);
    hud.setHealKey(services.keyFor("heal"));
    this.refreshWeaponStrip();
    viewmodel.equip(this.currentWeapon, true);
    viewmodel.setVisible(true);

    if (restore) this.restore(restore);
    else this.run(def.events?.start ?? []);
    this.refreshObjective();
  }

  /** 0..1 danger for the music: 1 while anything hunts you (or the Remnant is awake). */
  get threat(): number {
    if (this.boss?.awake && !this.boss.isDead) return 1;
    return this.player.health.isDead ? 0 : this.enemies.threat;
  }

  /** Re-reads settings that can change mid-level. */
  applySettings(): void {
    this.player.motionScale = this.services.motionScale();
  }

  /** The weapon in hand. */
  get weapon(): Weapon {
    return this.weapons.get(this.currentWeapon)!;
  }

  /** What the player is carrying right now. */
  get loadout(): Loadout {
    const weapons: Loadout["weapons"] = {};
    for (const [id, w] of this.weapons) weapons[id] = { mag: w.ammoInMag, reserve: w.reserveAmmo };
    return {
      health: this.player.health.current,
      battery: this.player.flashlight.battery,
      medkits: this.medkits,
      weapons,
      current: this.currentWeapon,
    };
  }

  private get powerOn(): boolean {
    return this.generators.every((g) => g.running);
  }

  /** The keycard opens security doors if there are any, otherwise the exit. */
  private get keycardLocksExit(): boolean {
    return this.level.spawns.items.some((i) => i.type === "keycard") && !this.doors.some((d) => d.security);
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
    this.keepOutOfBoss();
    this.checkTriggers();

    this.enemies.update(dt, this.perception(false));
    this.projectiles.update(dt, this.player.position, this.player.position.y, this.player.health.isDead);
    this.updateCombat(dt, cmd);
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
      this.switchTimer > 0 ? 0 : this.weapon.reloadProgress,
      this.player.flashlight.level
    );

    const hp = this.player.health.fraction;
    this.damageFx = Math.max(0, this.damageFx - dt * 2.2);
    engine.setPostFx(this.damageFx, THREE.MathUtils.clamp((0.4 - hp) / 0.4, 0, 1), this.time);
    sound.updateHeartbeat(dt, hp);
    sound.updateAmbient(dt);
    this.updateHud();
    this.updateBossBar();

    if (!this.finished) this.checkExit();
  }

  /** After death: the camera slumps while the world keeps moving. */
  stepDead(dt: number): void {
    const { engine } = this.services;
    this.time += dt;
    const cam = engine.camera;
    cam.position.y = THREE.MathUtils.lerp(cam.position.y, 0.35, 1 - Math.exp(-dt * 3));
    cam.rotation.z = THREE.MathUtils.lerp(cam.rotation.z, 0.9, 1 - Math.exp(-dt * 2));
    this.enemies.update(dt, this.perception(true));
    this.projectiles.update(dt, this.player.position, this.player.position.y, true);
    this.lamps.update(dt, this.player.position, this.time);
    this.effects.update(dt, cam, this.player.flashlight.level, this.time);
    this.damageFx = Math.max(0.4, this.damageFx - dt);
    engine.setPostFx(this.damageFx, 1, this.time);
  }

  /** What the creatures can sense this frame. */
  private perception(dead: boolean): Perception {
    const cam = this.services.engine.camera;
    const torch = this.player.flashlight;
    return {
      playerPos: this.player.position2D,
      playerNoise: dead ? 0 : this.player.noiseRadius,
      torchOn: !dead && torch.on && torch.level > 0.3,
      playerDead: dead || this.player.health.isDead,
      eye: cam.getWorldPosition(new THREE.Vector3()),
      look: cam.getWorldDirection(new THREE.Vector3()),
    };
  }

  /** The Remnant is solid: you can't walk into it. */
  private keepOutOfBoss(): void {
    const b = this.boss;
    if (!b || b.isDead) return;
    const d = this.player.position2D.sub(b.position2D);
    const min = b.stats.radius + 0.4;
    const len = d.length();
    if (len >= min || len < 1e-6) return;
    d.multiplyScalar(min / len);
    this.player.position.x = b.position2D.x + d.x;
    this.player.position.z = b.position2D.y + d.y;
  }

  private wireEnemy(e: Enemy): void {
    const { sound } = this.services;
    e.onAttackHit = (dmg, from) => {
      this.player.health.takeDamage(dmg, from);
      if (e.stats.behaviour === "boss") this.player.addTrauma(0.6);
    };
    e.onAlert = (en) => sound.playEnemy("alert", en.stats.voicePitch, this.spatial(en.position2D));
    e.onVocal = (en, kind) => {
      sound.playEnemy(kind, en.stats.voicePitch, this.spatial(en.position2D));
      if (kind === "slam" && en.position2D.distanceTo(this.player.position2D) < 14) this.player.addTrauma(0.35);
    };
    e.onRanged = (en, from, target) => {
      const r = en.stats.ranged;
      if (r) this.projectiles.spawn(from, target, r.speed, r.damage * this.difficulty.enemyDamage);
    };
    e.onLure = (en) => this.handleLure(en);
    if (e instanceof RemnantBoss) {
      e.onPhase = (phase) => this.handleBossPhase(phase);
      e.onSummon = (boss) => this.handleSummon(boss);
    }
  }

  /** A Mimic makes a sound to draw you in: your own footsteps, a pickup, or the Operator's voice. */
  private handleLure(e: Enemy): void {
    const pos = e.position2D;
    if (pos.distanceTo(this.player.position2D) > 26) return;
    const sp = this.spatial(pos);
    const r = Math.random();
    if (r < 0.45 && this.radio.sayFrom({ speaker: "echo", text: MIMIC_LINES[Math.floor(Math.random() * MIMIC_LINES.length)] }, sp)) return;
    this.services.sound.playLure(r < 0.75 ? "footsteps" : "pickup", sp);
  }

  private handleBossPhase(phase: number): void {
    const b = this.boss!;
    this.player.addTrauma(0.7);
    this.services.hud.toast(`THE REMNANT — PHASE ${phase}`, "var(--ui-red)");
    // The scream reaches every creature on the level.
    this.enemies.emitNoise(b.position2D, 60);
    this.run((phase === 2 ? this.def.events?.bossPhase2 : this.def.events?.bossPhase3) ?? []);
  }

  /** The mass births a swarm (and later, a husk) between itself and the player. */
  private handleSummon(boss: RemnantBoss): void {
    const b = boss.position2D;
    const toward = this.player.position2D.sub(b).normalize();
    const base = b.clone().addScaledVector(toward, boss.stats.radius + 1.6);
    const count = boss.phase >= 3 ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const p = base.clone().add(new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(0.7));
      this.spawnNear("swarm", p);
    }
    if (boss.phase >= 3) this.spawnNear("husk", base);
    this.services.sound.playEnemy("spit", 0.5, this.spatial(base));
  }

  private spawnNear(kind: "swarm" | "husk", p: THREE.Vector2): void {
    const c = worldToCell(p.x, p.y);
    if (isSolid(this.level, c.col, c.row)) return;
    const e = this.enemies.spawn(kind, p);
    e.alertTo(this.player.position2D);
    this.brood.add(e);
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

  // ------------------------------------------------------------------ weapons

  private addWeapon(id: WeaponId, ammo: WeaponAmmo): Weapon {
    const { sound } = this.services;
    const w = new Weapon(WEAPONS[id], ammo.reserve, ammo.mag);
    w.onFire = () => sound.playGunshot(id);
    w.onEmptyFire = () => sound.playEmptyClick();
    w.onReloadStart = () => (w.config.reload === "single" ? undefined : sound.playReload(w.config.reloadTime));
    w.onRoundLoaded = () => sound.playShellLoad();
    this.weapons.set(id, w);
    return w;
  }

  private refreshWeaponStrip(): void {
    this.services.hud.setWeapons(
      WEAPON_ORDER.map((id) => ({ slot: WEAPONS[id].slot, name: WEAPONS[id].name, owned: this.weapons.has(id) }))
    );
  }

  private get busy(): boolean {
    return this.switchTimer > 0 || this.healTimer > 0;
  }

  private updateCombat(dt: number, cmd: PlayerCommand): void {
    this.switchTimer = Math.max(0, this.switchTimer - dt);
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    if (this.healTimer > 0) {
      this.healTimer -= dt;
      if (this.healTimer <= 0) this.finishHeal();
    }
    this.weapon.update(dt);

    if (cmd.selectSlot) {
      const id = WEAPON_ORDER.find((w) => WEAPONS[w].slot === cmd.selectSlot);
      if (id) this.switchTo(id);
    } else if (cmd.cycleWeapon) {
      const owned = WEAPON_ORDER.filter((w) => this.weapons.has(w));
      const i = owned.indexOf(this.currentWeapon);
      this.switchTo(owned[(i + cmd.cycleWeapon + owned.length) % owned.length]);
    }
    if (cmd.heal) this.startHeal();
    if (cmd.melee) this.melee();
    if (cmd.reload && !this.busy) this.weapon.tryReload();
    if (cmd.fire) this.fire();
  }

  private switchTo(id: WeaponId): void {
    if (id === this.currentWeapon || !this.weapons.has(id) || this.healTimer > 0) return;
    this.weapon.cancelReload();
    this.currentWeapon = id;
    this.switchTimer = SWITCH_TIME;
    this.services.viewmodel.equip(id);
    this.services.sound.playWeaponSwitch();
    this.services.hud.setMagSize(this.weapon.config.magSize);
  }

  private startHeal(): void {
    const { hud, sound, viewmodel } = this.services;
    const health = this.player.health;
    if (this.healTimer > 0 || this.switchTimer > 0) return;
    if (this.medkits <= 0) return this.throttledPrompt("NO MEDKITS");
    if (health.current >= health.max) return this.throttledPrompt("HEALTH FULL");
    this.medkits--;
    this.healTimer = HEAL_TIME;
    this.weapon.cancelReload();
    viewmodel.heal(HEAL_TIME);
    sound.playHeal();
    hud.prompt("HEALING…", HEAL_TIME);
  }

  private finishHeal(): void {
    const health = this.player.health;
    const before = health.current;
    health.heal(Math.round(ITEMS.medkit.amount * this.difficulty.pickupMultiplier));
    this.services.hud.toast(`+${Math.round(health.current - before)} HEALTH`, "var(--ui-red)");
  }

  private fire(): void {
    const { engine, sound, hud, viewmodel } = this.services;
    if (this.player.isSprinting || this.busy) return;
    const cam = engine.camera;
    const w = this.weapon;
    const shot = w.tryFire(cam.getWorldPosition(new THREE.Vector3()), cam.getWorldDirection(new THREE.Vector3()), this.player.moveFactor);
    if (!shot) return;

    const cfg = w.config;
    this.stats.shots++;
    viewmodel.fire();
    this.player.addRecoil(cfg.recoil * (1 + Math.random() * 0.3));
    this.player.addTrauma(0.04 + cfg.recoil * 2.5);
    // The rivet gun has no muzzle blast to light the room.
    if (this.currentWeapon !== "rivet") this.muzzleTime = MUZZLE_FLASH_TIME;
    this.enemies.emitNoise(this.player.position2D, cfg.noiseRadius);

    let anyHit = false;
    let anyHead = false;
    let anyKill = false;
    let allArmoured = true;
    let impactSound = false;
    for (const dir of shot.dirs) {
      const wall = raycastWorld(this.level, shot.origin, dir, cfg.range);
      const hit = this.enemies.raycast(new THREE.Ray(shot.origin, dir), wall ? wall.distance : cfg.range);
      if (hit) {
        const dmg = cfg.damage * (hit.headshot ? cfg.headshotMultiplier : 1);
        const part = hit.headshot ? "head" : "body";
        if (!(hit.enemy instanceof RemnantBoss && hit.enemy.isArmoured(part))) allArmoured = false;
        const killed = this.damageEnemy(hit.enemy, dmg, part);
        this.effects.bloodBurst(hit.point, dir.clone(), (killed ? 28 : 14) / Math.sqrt(cfg.pellets));
        anyHit = true;
        anyHead ||= hit.headshot;
        anyKill ||= killed;
      } else if (wall) {
        this.effects.impact(wall.point, wall.normal);
        if (!impactSound) sound.playImpact(this.spatial(new THREE.Vector2(wall.point.x, wall.point.z)));
        impactSound = true;
      }
    }
    if (anyHit) {
      this.stats.hits++;
      if (anyHead && !allArmoured) this.stats.headshots++;
      if (allArmoured) {
        // The hide soaked it. Say so, so nobody empties their ammo into it.
        hud.hitMarker(false, anyKill, true);
        sound.playImpact(this.spatial(this.boss!.position2D));
        this.armouredHits++;
        if (this.armouredHits === 4) hud.prompt("ITS HIDE STOPS BULLETS — SHOOT THE CORE WHEN IT OPENS", 4);
      } else {
        hud.hitMarker(anyHead, anyKill);
        sound.playHitmarker(anyHead);
      }
    }
  }

  /** All player damage to creatures goes through here. Returns true on a kill. */
  private damageEnemy(enemy: Enemy, amount: number, part: "head" | "body"): boolean {
    const killed = enemy.takeDamage(amount, this.player.position2D, part);
    if (killed) this.onEnemyKilled(enemy);
    return killed;
  }

  private onEnemyKilled(enemy: Enemy): void {
    this.stats.kills++;
    if (enemy !== this.boss) return;
    this.services.hud.toast("THE REMNANT IS DEAD", "var(--ui-red)");
    this.player.addTrauma(0.8);
    for (const e of this.brood) e.takeDamage(e.health + 1, enemy.position2D);
    this.run(this.def.events?.bossDefeated ?? []);
  }

  /**
   * Melee: a quick strike with the weapon in hand. From behind an unaware
   * creature (or one frozen in the light) it's a silent takedown; otherwise
   * it's a shove that buys a moment.
   */
  private melee(): void {
    const { sound, hud, viewmodel } = this.services;
    if (this.meleeCooldown > 0 || this.busy) return;
    this.meleeCooldown = MELEE_COOLDOWN;
    this.weapon.cancelReload();
    viewmodel.melee();

    const me = this.player.position2D;
    const yaw = this.player.facing;
    const fwd = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw));
    let target: Enemy | null = null;
    let best = Infinity;
    for (const e of this.enemies.enemies) {
      if (e.isDead || e.onCeiling || e.state === "drop") continue;
      const to = e.position2D.sub(me);
      const d = to.length() - e.stats.radius;
      if (d > MELEE_RANGE || d >= best) continue;
      if (d > 0.3 && to.normalize().dot(fwd) < MELEE_FACING) continue;
      if (!hasLineOfSight(this.level, me, e.position2D)) continue;
      target = e;
      best = d;
    }
    if (!target) {
      sound.playMelee(false);
      return;
    }
    const chest = new THREE.Vector3(target.root.position.x, 1.1 * target.stats.scale, target.root.position.z);
    if (target.canBeTakenDown(me)) {
      target.takedown();
      this.stats.takedowns++;
      this.onEnemyKilled(target);
      sound.playTakedown();
      this.effects.bloodBurst(chest, new THREE.Vector3(fwd.x, 0.2, fwd.y), 10);
      hud.hitMarker(true, true);
      this.enemies.emitNoise(me, TAKEDOWN_NOISE);
      return;
    }
    sound.playMelee(true);
    this.player.addTrauma(0.15);
    const killed = this.damageEnemy(target, MELEE_DAMAGE, "body");
    if (!killed) target.shove(fwd, 0.8, this.level);
    this.effects.bloodBurst(chest, new THREE.Vector3(fwd.x, 0.2, fwd.y), 8);
    hud.hitMarker(false, killed);
    this.enemies.emitNoise(me, MELEE_NOISE);
  }

  private updatePickups(dt: number): void {
    const { sound, hud } = this.services;
    // Arena supplies restock until the Remnant is dead, so the fight can never run you dry.
    for (let i = this.restock.length - 1; i >= 0; i--) {
      this.restock[i][1] -= dt;
      if (this.boss?.isDead) this.restock.splice(i, 1);
      else if (this.restock[i][1] <= 0) {
        this.restock[i][0].restore();
        this.restock.splice(i, 1);
      }
    }
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const amount = (base: number) => Math.round(base * this.difficulty.pickupMultiplier);

    for (const p of this.pickups) {
      if (p.collected) continue;
      p.update(dt);
      if (p.distanceTo(px, pz) > PICKUP_RADIUS) continue;

      const item = ITEMS[p.type];
      if (item.ammoFor) {
        const w = this.weapons.get(item.ammoFor);
        if (!w) {
          this.throttledPrompt(`NEEDS THE ${WEAPONS[item.ammoFor].name.toUpperCase()}`);
          continue;
        }
        if (w.reserveAmmo >= w.config.reserveMax) {
          this.throttledPrompt(`${AMMO_LABEL[item.ammoFor]} FULL`);
          continue;
        }
        const got = w.addReserveAmmo(amount(w.config.ammoPickup));
        hud.toast(`+${got} ${AMMO_LABEL[item.ammoFor]}`);
        const b = this.boss;
        if (b && b.awake && !b.isDead && b.position2D.distanceTo(new THREE.Vector2(px, pz)) < RESTOCK_RADIUS)
          this.restock.push([p, RESTOCK_TIME]);
        p.collect();
        sound.playPickup(p.type);
        continue;
      }
      if (item.weapon) {
        this.pickUpWeapon(item.weapon, amount(WEAPONS[item.weapon].ammoPickup * 2));
        p.collect();
        sound.playPickup(p.type);
        continue;
      }

      switch (p.type) {
        case "medkit": {
          if (this.medkits >= MAX_MEDKITS) {
            this.throttledPrompt("MEDKITS FULL");
            continue;
          }
          this.medkits++;
          hud.toast(`+ MEDKIT (${this.medkits}/${MAX_MEDKITS})`, "var(--ui-red)");
          if (!this.healHintShown) {
            this.healHintShown = true;
            hud.prompt(`MEDKITS ARE CARRIED — PRESS ${this.services.keyFor("heal")} TO USE ONE`, 4);
          }
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

  private pickUpWeapon(id: WeaponId, rounds: number): void {
    const { hud } = this.services;
    const have = this.weapons.get(id);
    if (have) {
      const got = have.addReserveAmmo(rounds);
      hud.toast(`+${got} ${AMMO_LABEL[id]}`);
      return;
    }
    const def = WEAPONS[id];
    this.addWeapon(id, { mag: def.magSize, reserve: Math.min(def.reserveMax, rounds) });
    this.refreshWeaponStrip();
    this.switchTo(id);
    hud.toast(`${def.name.toUpperCase()} ACQUIRED`, "var(--ui-green)");
    const slotKey = this.keyLabel(`weapon${def.slot}`);
    const key = slotKey && slotKey !== "—" ? slotKey : this.services.keyFor("nextWeapon");
    const tip = id === "rivet" ? "Almost silent, but weak — " : id === "shotgun" ? "Devastating up close, and very loud — " : "";
    hud.prompt(`${tip}press ${key} to select it`.toUpperCase(), 5);
  }

  // ------------------------------------------------------------------ exit & endings

  private exitLockReason(): string | null {
    if (this.boss && !this.boss.isDead) return "SEALED — THE REMNANT HOLDS THE DOOR";
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
    this.services.hud.boss(null);
    this.services.sound.playDeath();
    this.onDeath?.();
  }

  // ------------------------------------------------------------------ helpers

  private updateHud(): void {
    const { engine, hud } = this.services;
    hud.setHealKey(this.services.keyFor("heal"));
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
      singleLoad: this.weapon.config.reload === "single",
      weapon: this.weapon.config.name,
      slot: this.weapon.config.slot,
      medkits: this.medkits,
      healing: this.healTimer > 0,
      reloadKey: this.services.keyFor("reload"),
      canFire: !this.busy && !this.player.isSprinting,
      noise: this.weapon.bloom > 0.6 ? 5 : noiseBars,
      threat: this.enemies.threat,
      spreadPx: (Math.tan(spread) / halfFov) * (window.innerHeight / 2),
      hasKeycard: this.hasKeycard,
    });
  }

  private updateBossBar(): void {
    const b = this.boss;
    if (b && b.awake && !b.isDead) this.services.hud.boss(b.stats.name, b.health / b.maxHealth);
    else this.services.hud.boss(null);
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
