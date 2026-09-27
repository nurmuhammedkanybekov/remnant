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
import type { Enemy, Perception, VocalKind } from "../enemies/enemy";
import { EnemyManager } from "../enemies/enemyManager";
import { Projectiles } from "../enemies/projectiles";
import { Effects } from "../fx/particles";
import { Pickup } from "../items/pickup";
import { r2, type PlayerState, type SessionMsg } from "../net/protocol";
import type { Role } from "../net/link";
import { emptyCommand, type PlayerCommand } from "../player/command";
import { MAX_BATTERY } from "../player/flashlight";
import { DRY, NOISE_RADIUS, PlayerController, WATER } from "../player/playerController";
import type { Hud } from "../ui/hud";
import { Weapon } from "../weapons/weapon";
import type { Viewmodel } from "../weapons/viewmodel";
import { circleHitsWall, hasLineOfSight, isSolid, raycastWorld, worldToCell } from "../world/grid";
import { CheckpointMarker, DetonatorConsole, Door, Generator, Intercom, type Interactable } from "../world/interactables";
import { LampSystem } from "../world/lamps";
import { buildLevel, type LevelData } from "../world/levelBuilder";
import type { LevelDef } from "../world/levelDef";
import { parseLevel } from "../world/levelParser";
import { lootFor } from "../world/loot";
import { reinforcements } from "../world/reinforcements";
import type { CheckpointState } from "./checkpoint";
import type { Loadout, WeaponAmmo } from "./loadout";
import { RadioChannel } from "./radio";
import type { RadioLine, ScriptAction } from "./script";
import { isCharacterLook, LOOKS, personalise, type CharacterLook } from "../content/characters";
import { RemotePlayer } from "./remotePlayer";
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
/** The boss stops summoning while this many of its brood are still alive. */
const MAX_BROOD = 12;
/** Co-op: player states go out this often, creature snapshots (host) this often. */
const STATE_INTERVAL = 1 / 20;
const SNAPSHOT_INTERVAL = 1 / 15;
/** Co-op: seconds you can stay down before you bleed out, how close and how long a revive takes, and what you get back. */
const BLEED_TIME = 45;
const REVIVE_RANGE = 2;
const REVIVE_TIME = 3;
const REVIVE_HEALTH = 35;
/** Co-op: more creatures, and tougher ones, for two players. */
const COOP_EXTRA_ENEMIES = 0.4;
const COOP_ENEMY_HEALTH = 1.3;
/** Every creature this close to a Howler's scream comes looking. */
const HOWL_RADIUS = 40;
/**
 * Co-op: supply pickups (ammo, medkits, batteries) are shared — whoever takes
 * one, it's gone for both — while there are more, tougher creatures. So a
 * co-op level has this many times the supplies (seeded, same for both).
 */
const COOP_LOOT = 1.8;
/** Co-op: both players have to be this close to the exit to leave. */
const EXIT_TOGETHER = 4.5;

/** How a session talks to the other player in co-op. `Game` owns the actual connection. */
export interface CoopLink {
  readonly role: Role;
  /** Still connected to the other player. */
  readonly connected: boolean;
  send(msg: SessionMsg, fast?: boolean): void;
}

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
  /** The player's chosen look, sent to the partner. */
  look?: () => CharacterLook;
  /** A note was picked up (its key goes in the journal). */
  noteRead?: (key: string) => void;
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

  // --- co-op
  /** The other player's figure (co-op only). */
  private readonly remote: RemotePlayer | null = null;
  /** Down and waiting for the partner, instead of dead. */
  private downed = false;
  private bleed = 0;
  private reviveProgress = 0;
  private stateTimer = 0;
  private snapshotTimer = 0;
  private partnerGoneShown = false;

  constructor(
    private readonly services: SessionServices,
    readonly def: LevelDef,
    readonly difficulty: DifficultyDef,
    loadout: Loadout,
    restore: CheckpointState | null = null,
    /** The link to the other player, in co-op. */
    private readonly coop: CoopLink | null = null
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
    this.player = new PlayerController(
      camera,
      this.level,
      this.startPoint(sp.playerStart, def.spawnYaw, coop?.role === "guest"),
      def.spawnYaw
    );
    this.player.motionScale = services.motionScale();
    this.player.health.current = start.health;
    this.player.flashlight.battery = start.battery;
    this.medkits = start.medkits;
    this.player.flashlight.drainMultiplier = difficulty.batteryDrain;
    this.player.health.onDeath = () => this.handleDeath();
    this.player.health.onDamage = (amount, source) => this.handleDamage(amount, source);
    this.player.onFootstep = (gait, wet) => (wet ? sound.playSplash(gait) : sound.playFootstep(gait));
    this.player.flashlight.onToggle = (on) => sound.playFlashlight(on);

    // Harder difficulties (and co-op, with two of you) bring extra creatures; co-op ones are tougher too.
    const extras = reinforcements(this.level, difficulty.extraEnemies + (coop ? COOP_EXTRA_ENEMIES : 0));
    this.enemies = new EnemyManager(scene, this.level, [...sp.enemies, ...extras], {
      health: difficulty.enemyHealth * (coop ? COOP_ENEMY_HEALTH : 1),
      damage: difficulty.enemyDamage,
      perception: difficulty.enemyPerception,
      speed: difficulty.enemySpeed,
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
      ...lootFor(this.level, difficulty.lootSupply * (coop ? COOP_LOOT : 1)).map((i) => new Pickup(scene, i.type, i.pos)),
      ...sp.notes.map((n) => new Pickup(scene, "note", n.pos, n.text, n.key)),
    ];

    // ---- interactables
    this.doors = sp.doors.map((d) => {
      const door = new Door(scene, this.level, d);
      door.isUnlocked = () => this.hasKeycard;
      door.onOpen = () => {
        sound.playDoor(this.spatial(door.pos), door.security);
        this.worldNoise(door.pos, DOOR_NOISE);
        this.broadcastUse(door);
      };
      door.onLocked = () => {
        sound.playLocked();
        this.throttledPrompt("NEEDS THE KEYCARD");
      };
      return door;
    });
    this.generators = sp.generators.map((g) => {
      const gen = new Generator(scene, g);
      gen.onStart = () => {
        this.handleGeneratorStarted(gen);
        this.broadcastUse(gen);
      };
      return gen;
    });
    this.intercoms = sp.intercoms.map((s, i) => {
      const ic = new Intercom(scene, s, i);
      ic.onUse = () => {
        sound.playIntercom(this.spatial(ic.pos));
        this.run(def.intercoms?.[i] ?? []);
        this.broadcastUse(ic);
      };
      return ic;
    });
    this.consoles = sp.consoles.map((s) => {
      const c = new DetonatorConsole(scene, s);
      c.onUse = () => this.finish(def.endings?.console ?? "seal");
      c.lockedReason = () => (this.boss && !this.boss.isDead ? `${this.boss.stats.name.toUpperCase()} GUARDS THE CHARGES` : null);
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

    if (coop) {
      this.remote = new RemotePlayer(scene);
      this.remote.onFootstep = (gait, wet, at) => sound.playFootstepAt(gait, wet, this.spatial(at));
    }

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

  /** The guest starts a step beside the host (to the right, left or behind — whichever is clear). */
  private startPoint(start: THREE.Vector2, yaw: number, guest: boolean): THREE.Vector2 {
    if (!guest) return start;
    const right = new THREE.Vector2(Math.cos(yaw), -Math.sin(yaw));
    const back = new THREE.Vector2(Math.sin(yaw), Math.cos(yaw));
    for (const dir of [right, right.clone().negate(), back]) {
      const p = start.clone().addScaledVector(dir, 1.2);
      if (!circleHitsWall(this.level, p.x, p.y, 0.45)) return p;
    }
    return start;
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

  /** For the inventory: the current objective, the radio heard on this level, and the notes found on it. */
  get objectiveText(): string {
    return this.objective;
  }
  get radioLog(): readonly RadioLine[] {
    return this.radio.log;
  }
  readonly notesFound = new Set<string>();

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
    // Down: you can look around, and that's all.
    this.player.update(dt, this.downed ? { ...emptyCommand(), turn: cmd.turn, tilt: cmd.tilt } : cmd);
    if (this.downed) engine.camera.position.y = 0.4;
    this.keepOutOfBoss();
    this.checkTriggers();

    this.enemies.update(dt, this.perceptions(false));
    this.projectiles.update(dt, this.player.position, this.player.position.y, this.player.health.isDead);
    if (!this.downed) {
      this.updateCombat(dt, cmd);
      this.updatePickups(dt);
      this.updateInteraction(dt, cmd.interact);
    }
    this.updateCoop(dt, cmd);
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
    this.enemies.update(dt, this.perceptions(true));
    this.updateCoop(dt, emptyCommand());
    this.projectiles.update(dt, this.player.position, this.player.position.y, true);
    this.lamps.update(dt, this.player.position, this.time);
    this.effects.update(dt, cam, this.player.flashlight.level, this.time);
    this.damageFx = Math.max(0.4, this.damageFx - dt);
    engine.setPostFx(this.damageFx, 1, this.time);
  }

  /** What the creatures can sense this frame: one entry per player (the host senses both). */
  private perceptions(dead: boolean): Perception[] {
    const list = [this.perception(dead)];
    const r = this.remote;
    if (this.coop?.role === "host" && this.partnerHere && r?.state) {
      const s = r.state;
      list.push({
        playerPos: r.position2D,
        playerNoise: s.down ? 0 : NOISE_RADIUS[s.gait] * (s.wet ? WATER.noise : 1),
        torchOn: !s.down && s.torch > 0.3,
        playerDead: s.down || s.hp <= 0,
        eye: r.eyePosition,
        look: r.lookDirection,
      });
    }
    return list;
  }

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
    // The guest's creatures are puppets of the host's: they don't think, so none of this fires for them.
    if (this.coop?.role === "guest") e.puppet = true;
    const heavy = e.stats.behaviour === "boss";
    e.onAttackHit = (dmg, from) => {
      if (e.target === 1 && this.remote) {
        this.coop?.send({ t: "hurt", dmg, from: [r2(from.x), r2(from.y)], heavy });
        return;
      }
      this.player.health.takeDamage(dmg, from);
      if (heavy) this.player.addTrauma(0.6);
    };
    e.onAlert = (en) => this.enemyVocal(en, "alert");
    e.onVocal = (en, kind) => this.enemyVocal(en, kind);
    e.onRanged = (en, from, target) => {
      const r = en.stats.ranged;
      if (!r) return;
      const dmg = r.damage * this.difficulty.enemyDamage;
      this.projectiles.spawn(from, target, r.speed, dmg);
      // The guest gets its own copy of the glob: it can only hurt the guest there, and only the host here.
      const v = (p: THREE.Vector3) => [r2(p.x), r2(p.y), r2(p.z)];
      this.coop?.send({ t: "proj", from: v(from), to: v(target), speed: r.speed, dmg });
    };
    e.onLure = (en) => this.handleLure(en);
    e.onHowl = (en) => this.handleHowl(en);
    if (e instanceof RemnantBoss) {
      e.onPhase = (phase) => this.handleBossPhase(phase);
      e.onSummon = (boss) => this.handleSummon(boss);
    }
  }

  /** A creature makes a sound; the host passes it on so the guest hears it too. */
  private enemyVocal(en: Enemy, kind: "alert" | VocalKind): void {
    this.services.sound.playEnemy(kind, en.stats.voicePitch, this.spatial(en.position2D));
    if (kind === "slam" && en.position2D.distanceTo(this.player.position2D) < 14) this.player.addTrauma(0.35);
    if (this.coop?.role === "host") this.coop.send({ t: "vocal", i: this.enemies.enemies.indexOf(en), k: kind });
  }

  /** A Mimic makes a sound to draw you in: your own footsteps, a pickup, or the Operator's voice. */
  private handleLure(e: Enemy, r = Math.random()): void {
    if (this.coop?.role === "host") this.coop.send({ t: "lure", i: this.enemies.enemies.indexOf(e), r });
    const pos = e.position2D;
    if (pos.distanceTo(this.player.position2D) > 26) return;
    const sp = this.spatial(pos);
    if (r < 0.45 && this.radio.sayFrom({ speaker: "echo", text: MIMIC_LINES[Math.floor(Math.random() * MIMIC_LINES.length)] }, sp)) return;
    this.services.sound.playLure(r < 0.75 ? "footsteps" : "pickup", sp);
  }

  /**
   * A Howler has found a player: it screams (a roar everyone hears) and every
   * creature within HOWL_RADIUS comes to where it saw them.
   */
  private handleHowl(e: Enemy): void {
    this.enemyVocal(e, "roar");
    this.player.addTrauma(0.25);
    this.worldNoise(e.lastKnownPosition, HOWL_RADIUS);
  }

  private handleBossPhase(phase: number): void {
    const b = this.boss!;
    if (this.coop?.role === "host") this.coop.send({ t: "bossPhase", phase });
    this.player.addTrauma(0.7);
    this.services.hud.toast(`${b.stats.name.toUpperCase()} — PHASE ${phase}`, "var(--ui-red)");
    // The scream reaches every creature on the level.
    this.worldNoise(b.position2D, 60);
    this.run((phase === 2 ? this.def.events?.bossPhase2 : this.def.events?.bossPhase3) ?? []);
  }

  /** The mass births a swarm (and later, a husk) between itself and the player. */
  private handleSummon(boss: RemnantBoss): void {
    // A long fight mustn't pile up an endless horde: it only calls for more while few of its brood are left.
    let alive = 0;
    for (const e of this.brood) if (!e.isDead) alive++;
    if (alive >= MAX_BROOD) return;
    const b = boss.position2D;
    const toward = this.player.position2D.sub(b).normalize();
    const base = b.clone().addScaledVector(toward, boss.stats.radius + 1.6);
    const count = boss.phase >= 3 ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const p = base.clone().add(new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(0.7));
      this.spawnNear("swarm", p);
    }
    // The Choir's last phase calls Howlers: every one that sees you screams for the rest.
    if (boss.phase >= 3) this.spawnNear(boss.stats.id === "choir" ? "howler" : "husk", base);
    this.services.sound.playEnemy("spit", 0.5, this.spatial(base));
  }

  private spawnNear(kind: "swarm" | "husk" | "howler", p: THREE.Vector2): void {
    const c = worldToCell(p.x, p.y);
    if (isSolid(this.level, c.col, c.row)) return;
    const e = this.enemies.spawn(kind, p);
    e.alertTo(this.player.position2D);
    this.brood.add(e);
    this.coop?.send({ t: "spawn", kind, x: r2(p.x), z: r2(p.y) });
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
          this.worldNoise(this.player.position2D, a.radius);
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
    if (key && this.fireTrigger(key)) this.coop?.send({ t: "trigger", key });
    this.markers.forEach((m, mi) => {
      if (m.spawn.cell.col !== col || m.spawn.cell.row !== row) return;
      if (this.reachMarker(mi)) this.coop?.send({ t: "marker", i: mi });
    });
  }

  /** Script triggers fire once, for both players, whoever walks in. Returns false if it already had. */
  private fireTrigger(key: string): boolean {
    if (this.firedTriggers.has(key)) return false;
    this.firedTriggers.add(key);
    this.run(this.def.triggers?.[key] ?? []);
    return true;
  }

  private reachMarker(i: number): boolean {
    const m = this.markers[i];
    if (!m || m.reached) return false;
    m.reached = true;
    this.saveCheckpoint();
    return true;
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
    // Reviving a downed partner takes the use key (see updateCoop).
    if (this.canRevive) return;
    const target = this.focusedInteractable();
    this.services.hud.interactPrompt(target ? this.services.keyFor("interact") : null, target?.prompt ?? null);
    if (!target || !pressed) return;
    // The guest asks the host, who runs the world — except to hear that a door is locked.
    const lockedDoor = target instanceof Door && target.security && !this.hasKeycard;
    if (this.coop?.role === "guest" && !lockedDoor) this.coop.send({ t: "use", i: this.interactables.indexOf(target) });
    else target.interact();
  }

  /** Host: tell the guest something was used (it happens there too). */
  private broadcastUse(it: Interactable): void {
    if (this.coop?.role === "host") this.coop.send({ t: "used", i: this.interactables.indexOf(it) });
  }

  private handleGeneratorStarted(gen: Generator): void {
    const { sound, hud } = this.services;
    sound.playGeneratorStart(this.spatial(gen.pos));
    this.worldNoise(gen.pos, GENERATOR_START_NOISE);
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
      this.worldNoise(g.pos, GENERATOR_HUM_NOISE);
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
    this.playerNoise(this.player.position2D, cfg.noiseRadius);

    let anyHit = false;
    let anyHead = false;
    let anyKill = false;
    let allArmoured = true;
    let impactSound = false;
    const walls: number[][] = [];
    const blood: number[][] = [];
    const v3 = (a: THREE.Vector3, b: THREE.Vector3) => [a.x, a.y, a.z, b.x, b.y, b.z].map(r2);
    for (const dir of shot.dirs) {
      const wall = raycastWorld(this.level, shot.origin, dir, cfg.range);
      const hit = this.enemies.raycast(new THREE.Ray(shot.origin, dir), wall ? wall.distance : cfg.range);
      if (hit) {
        const dmg = cfg.damage * (hit.headshot ? cfg.headshotMultiplier : 1);
        const part = hit.headshot ? "head" : "body";
        if (!(hit.enemy instanceof RemnantBoss && hit.enemy.isArmoured(part))) allArmoured = false;
        const killed = this.damageEnemy(hit.enemy, dmg, part);
        this.effects.bloodBurst(hit.point, dir.clone(), (killed ? 28 : 14) / Math.sqrt(cfg.pellets));
        blood.push(v3(hit.point, dir));
        anyHit = true;
        anyHead ||= hit.headshot;
        anyKill ||= killed;
      } else if (wall) {
        this.effects.impact(wall.point, wall.normal);
        walls.push(v3(wall.point, wall.normal));
        if (!impactSound) sound.playImpact(this.spatial(new THREE.Vector2(wall.point.x, wall.point.z)));
        impactSound = true;
      }
    }
    this.coop?.send({ t: "shot", w: this.currentWeapon, walls: walls.slice(0, 4), blood: blood.slice(0, 4) });
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

  /**
   * All player damage to creatures goes through here. Returns true on a kill.
   * The guest's creatures are only copies: the guest tells the host, which
   * reports the kill back (`killed`).
   */
  private damageEnemy(enemy: Enemy, amount: number, part: "head" | "body"): boolean {
    if (this.coop?.role === "guest") {
      const me = this.player.position2D;
      this.coop.send({ t: "hit", i: this.enemies.enemies.indexOf(enemy), dmg: amount, part, x: r2(me.x), z: r2(me.y) });
      enemy.flash();
      return false;
    }
    const killed = enemy.takeDamage(amount, this.player.position2D, part);
    if (killed) this.onEnemyKilled(enemy);
    return killed;
  }

  /** Host: a creature died. `byPartner` if the guest landed the blow (it counts in their stats). */
  private onEnemyKilled(enemy: Enemy, byPartner = false): void {
    if (byPartner) this.coop?.send({ t: "killed", i: this.enemies.enemies.indexOf(enemy) });
    else this.stats.kills++;
    if (enemy !== this.boss) return;
    for (const e of this.brood) e.takeDamage(e.health + 1, enemy.position2D);
    this.coop?.send({ t: "bossDead" });
    this.bossDefeated();
  }

  private bossDefeated(): void {
    this.services.hud.toast(`${(this.boss?.stats.name ?? "The Remnant").toUpperCase()} IS DEAD`, "var(--ui-red)");
    this.player.addTrauma(0.8);
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
      this.stats.takedowns++;
      if (this.coop?.role === "guest") this.coop.send({ t: "takedown", i: this.enemies.enemies.indexOf(target), x: r2(me.x), z: r2(me.y) });
      else {
        target.takedown();
        this.onEnemyKilled(target);
      }
      sound.playTakedown();
      this.effects.bloodBurst(chest, new THREE.Vector3(fwd.x, 0.2, fwd.y), 10);
      hud.hitMarker(true, true);
      this.playerNoise(me, TAKEDOWN_NOISE);
      return;
    }
    sound.playMelee(true);
    this.player.addTrauma(0.15);
    const killed = this.damageEnemy(target, MELEE_DAMAGE, "body");
    if (this.coop?.role === "guest") this.coop.send({ t: "shove", i: this.enemies.enemies.indexOf(target), dx: r2(fwd.x), dz: r2(fwd.y) });
    else if (!killed) target.shove(fwd, 0.8, this.level);
    this.effects.bloodBurst(chest, new THREE.Vector3(fwd.x, 0.2, fwd.y), 8);
    hud.hitMarker(false, killed);
    this.playerNoise(me, MELEE_NOISE);
  }

  private updatePickups(dt: number): void {
    const { sound, hud } = this.services;
    // Arena supplies restock until the Remnant is dead, so the fight can never run you dry.
    for (let i = this.restock.length - 1; i >= 0; i--) {
      this.restock[i][1] -= dt;
      if (this.boss?.isDead) this.restock.splice(i, 1);
      else if (this.restock[i][1] <= 0) {
        const p = this.restock[i][0];
        p.restore();
        this.coop?.send({ t: "restock", i: this.pickups.indexOf(p) });
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
        this.maybeRestock(p);
        this.collect(p);
        sound.playPickup(p.type);
        continue;
      }
      if (item.weapon) {
        this.pickUpWeapon(item.weapon, amount(WEAPONS[item.weapon].ammoPickup * 2));
        this.collect(p);
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
          this.gotKeycard("KEYCARD ACQUIRED");
          break;
        case "note":
          if (p.noteText) hud.showNote(personalise(p.noteText));
          if (p.noteKey) {
            this.notesFound.add(p.noteKey);
            this.services.noteRead?.(p.noteKey);
          }
          hud.prompt(`NOTE ADDED TO THE JOURNAL — ${this.services.keyFor("inventory")} TO READ IT AGAIN`, 3);
          break;
      }
      this.collect(p);
      sound.playPickup(p.type);
    }
  }

  /** Takes a pickup out of the world — for both players. */
  private collect(p: Pickup): void {
    p.collect();
    this.coop?.send({ t: "pickup", i: this.pickups.indexOf(p) });
  }

  /** Ammo taken in the boss arena while the fight is on comes back later (the host keeps the clock). */
  private maybeRestock(p: Pickup): void {
    if (this.coop?.role === "guest") return;
    const b = this.boss;
    if (b && b.awake && !b.isDead && p.distanceTo(b.position2D.x, b.position2D.y) < RESTOCK_RADIUS) this.restock.push([p, RESTOCK_TIME]);
  }

  /** The keycard is shared: whoever finds it opens the doors for both. */
  private gotKeycard(toast: string): void {
    if (this.hasKeycard) return;
    this.hasKeycard = true;
    this.services.hud.toast(toast, "var(--ui-green)");
    if (this.def.events?.keycard) this.run(this.def.events.keycard);
    else if (this.keycardLocksExit) {
      this.objective = "Reach the exit.";
      this.refreshObjective();
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
    if (this.boss && !this.boss.isDead) return `SEALED — ${this.boss.stats.name.toUpperCase()} HOLDS THE DOOR`;
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
    // Co-op: nobody leaves alone. The host decides when you both have.
    if (this.partnerHere) {
      const r = this.remote!;
      if (r.down) return this.throttledPrompt("YOUR PARTNER IS DOWN");
      if (r.position2D.distanceTo(exit) > EXIT_TOGETHER) return this.throttledPrompt("WAITING FOR YOUR PARTNER");
    }
    if (this.coop?.role === "guest" && this.coop.connected) return;
    this.finish(this.def.finale ? (this.def.endings?.exit ?? "leave") : null);
  }

  private finish(ending: EndingId | null): void {
    if (this.finished) return;
    this.finished = true;
    if (this.coop?.role === "host") this.coop.send({ t: "finish", ending });
    this.radio.clear();
    if (ending && ending === (this.def.endings?.console ?? "seal")) this.services.sound.playDetonation();
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
    // Co-op: you go down, and your partner has a while to get you back up.
    if (this.partnerHere && !this.remote!.down) return this.goDown();
    this.coop?.send({ t: "wipe" });
    this.die();
  }

  /** The level is lost. */
  private die(): void {
    if (this.finished) return;
    this.downed = false;
    this.finished = true;
    this.radio.clear();
    this.services.hud.boss(null);
    this.services.sound.playDeath();
    this.onDeath?.();
  }

  // ------------------------------------------------------------------ co-op

  /** The other player is connected and in the level. */
  private get partnerHere(): boolean {
    return !!this.coop?.connected && !!this.remote?.visible;
  }

  /** Standing over a downed partner: holding the use key gets them up. */
  private get canRevive(): boolean {
    const r = this.remote;
    return !this.downed && this.partnerHere && !!r?.down && r.position2D.distanceTo(this.player.position2D) < REVIVE_RANGE;
  }

  /** Noise the world makes (doors, generators, alarms, the boss): the host's creatures hear it. */
  private worldNoise(pos: THREE.Vector2, radius: number): void {
    if (this.coop?.role !== "guest") this.enemies.emitNoise(pos, radius);
  }

  /** Noise the player makes (shots, melee): a guest's goes over to the host's creatures. */
  private playerNoise(pos: THREE.Vector2, radius: number): void {
    if (this.coop?.role === "guest") this.coop.send({ t: "noise", x: r2(pos.x), z: r2(pos.y), r: radius });
    else this.enemies.emitNoise(pos, radius);
  }

  private sendState(): void {
    const p = this.player;
    const torch = p.flashlight;
    const state: PlayerState = {
      t: "ps",
      x: r2(p.position.x),
      y: r2(p.position.y),
      z: r2(p.position.z),
      yaw: r2(p.facing),
      pitch: r2(p.lookPitch),
      gait: p.gait,
      wet: p.terrain.wet,
      torch: torch.on ? r2(torch.level) : 0,
      weapon: this.currentWeapon,
      hp: r2(p.health.fraction),
      down: this.downed || p.health.isDead,
      bleed: Math.ceil(this.bleed),
      look: this.services.look?.(),
    };
    this.coop?.send(state, true);
  }

  private goDown(): void {
    const { hud, sound, viewmodel } = this.services;
    this.downed = true;
    this.bleed = BLEED_TIME;
    this.healTimer = 0;
    this.weapon.cancelReload();
    viewmodel.setVisible(false);
    hud.interactPrompt(null, null);
    sound.playDeath();
    hud.toast("YOU'RE DOWN", "var(--ui-red)");
    this.sendState();
  }

  private revived(): void {
    if (!this.downed || this.finished) return;
    this.downed = false;
    this.player.health.current = REVIVE_HEALTH;
    this.services.viewmodel.setVisible(true);
    this.services.sound.playHeal();
    this.services.hud.toast("BACK ON YOUR FEET", "var(--ui-green)");
    this.sendState();
  }

  private updateCoop(dt: number, cmd: PlayerCommand): void {
    const coop = this.coop;
    const r = this.remote;
    if (!coop || !r) return;
    const { hud, sound } = this.services;
    if (!coop.connected) {
      if (r.visible) r.hide();
      if (!this.partnerGoneShown && !this.finished) hud.toast("YOUR PARTNER IS GONE", "var(--ui-red)");
      this.partnerGoneShown = true;
      // Nobody left to get you up.
      if (this.downed) this.die();
      return;
    }
    r.update(dt, this.time);
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.stateTimer = STATE_INTERVAL;
      this.sendState();
    }
    if (coop.role === "host") {
      this.snapshotTimer -= dt;
      if (this.snapshotTimer <= 0) {
        this.snapshotTimer = SNAPSHOT_INTERVAL;
        coop.send({ t: "es", e: this.enemies.enemies.map((e) => e.netState()) }, true);
      }
    }
    if (this.finished) return;

    if (this.downed) {
      this.bleed -= dt;
      hud.prompt(`YOU'RE DOWN — ${Math.max(0, Math.ceil(this.bleed))}s — YOUR PARTNER CAN GET YOU UP`, 0.25);
      if (this.bleed <= 0 || r.down) {
        coop.send({ t: "wipe" });
        this.die();
      }
      return;
    }
    if (!this.canRevive) {
      this.reviveProgress = 0;
      if (r.down) hud.prompt(`YOUR PARTNER IS DOWN — ${r.state?.bleed ?? 0}s TO REACH THEM`, 0.25);
      return;
    }
    hud.interactPrompt(
      this.services.keyFor("interact"),
      this.reviveProgress > 0 ? `REVIVING… ${Math.round(this.reviveProgress * 100)}%` : "HOLD TO REVIVE YOUR PARTNER"
    );
    if (!cmd.interactHeld) {
      this.reviveProgress = 0;
      return;
    }
    this.reviveProgress += dt / REVIVE_TIME;
    if (this.reviveProgress >= 1) {
      this.reviveProgress = 0;
      coop.send({ t: "revive" });
      hud.toast("PARTNER REVIVED", "var(--ui-green)");
      sound.playHeal();
    }
  }

  /** The other player fired: their gun, their muzzle flash, where their bullets landed. */
  private partnerShot(m: Extract<SessionMsg, { t: "shot" }>): void {
    const r = this.remote;
    if (!r) return;
    r.fired();
    this.services.sound.playGunshotAt(m.w, this.spatial(r.position2D));
    for (const [x, y, z, nx, ny, nz] of m.walls) this.effects.impact(new THREE.Vector3(x, y, z), new THREE.Vector3(nx, ny, nz));
    for (const [x, y, z, dx, dy, dz] of m.blood) this.effects.bloodBurst(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, dy, dz), 12);
  }

  /** A message from the other player (see `net/protocol.ts`). */
  receive(m: SessionMsg): void {
    const enemy = (i: number): Enemy | undefined => this.enemies.enemies[i];
    const host = this.coop?.role === "host";
    switch (m.t) {
      case "ps":
        this.remote?.apply(m);
        break;
      case "es":
        if (!host) m.e.forEach((a, i) => enemy(i)?.applyNet(a));
        break;
      case "vocal": {
        const e = enemy(m.i);
        if (e && !host) this.enemyVocal(e, m.k as VocalKind);
        break;
      }
      case "spawn":
        if (!host) this.enemies.spawn(m.kind, new THREE.Vector2(m.x, m.z));
        break;
      case "proj":
        this.projectiles.spawn(
          new THREE.Vector3(m.from[0], m.from[1], m.from[2]),
          new THREE.Vector3(m.to[0], m.to[1], m.to[2]),
          m.speed,
          m.dmg
        );
        break;
      case "lure": {
        const e = enemy(m.i);
        if (e && !host) this.handleLure(e, m.r);
        break;
      }
      case "hurt":
        this.player.health.takeDamage(m.dmg, new THREE.Vector2(m.from[0], m.from[1]));
        if (m.heavy) this.player.addTrauma(0.6);
        break;
      case "killed":
        this.stats.kills++;
        this.services.hud.hitMarker(false, true);
        break;
      case "bossPhase":
        if (this.boss && !host) this.handleBossPhase(m.phase);
        break;
      case "bossDead":
        if (!host) this.bossDefeated();
        break;
      case "shot":
        this.partnerShot(m);
        break;
      case "noise":
        if (host) this.enemies.emitNoise(new THREE.Vector2(m.x, m.z), m.r);
        break;
      case "hit": {
        const e = enemy(m.i);
        if (!host || !e || e.isDead) break;
        if (e.takeDamage(m.dmg, new THREE.Vector2(m.x, m.z), m.part)) this.onEnemyKilled(e, true);
        break;
      }
      case "takedown": {
        const e = enemy(m.i);
        if (!host || !e || e.isDead) break;
        const from = new THREE.Vector2(m.x, m.z);
        if (e.canBeTakenDown(from)) {
          e.takedown();
          this.onEnemyKilled(e, true);
        } else if (e.takeDamage(MELEE_DAMAGE, from)) this.onEnemyKilled(e, true);
        break;
      }
      case "shove":
        if (host) enemy(m.i)?.shove(new THREE.Vector2(m.dx, m.dz), 0.8, this.level);
        break;
      case "use": {
        const it = this.interactables[m.i];
        if (!host || !it || (it instanceof Door && it.security && !this.hasKeycard)) break;
        it.interact();
        break;
      }
      case "used": {
        const it = this.interactables[m.i];
        if (host || !it) break;
        if (!(it instanceof Door)) it.interact();
        else if (!it.isOpen) {
          it.open();
          it.onOpen?.(it);
        }
        break;
      }
      case "pickup": {
        const p = this.pickups[m.i];
        if (!p || p.collected) break;
        p.collect();
        if (p.type === "keycard") this.gotKeycard("YOUR PARTNER FOUND THE KEYCARD");
        else if (ITEMS[p.type].ammoFor) this.maybeRestock(p);
        break;
      }
      case "restock":
        this.pickups[m.i]?.restore();
        break;
      case "trigger":
        this.fireTrigger(m.key);
        break;
      case "marker":
        this.reachMarker(m.i);
        break;
      case "revive":
        this.revived();
        break;
      case "wipe":
        this.die();
        break;
      case "finish":
        this.finish(m.ending);
        break;
    }
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
    const r = this.partnerHere ? this.remote?.state : null;
    hud.partner(r ? { hp: r.hp, down: r.down, bleed: r.bleed, name: isCharacterLook(r.look) ? LOOKS[r.look].firstName : undefined } : null);
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
