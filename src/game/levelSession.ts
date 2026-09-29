import * as THREE from "three";
import type { SoundManager, Spatial } from "../audio/soundManager";
import type { DifficultyDef } from "../content/difficulty";
import { MIMIC_LINES, type EndingId } from "../content/story";
import { HEAL_TIME, ITEMS, MAX_MEDKITS, MAX_THROWABLES } from "../content/items";
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
import { SMASH_NOISE, throwFrom, Throwables } from "../items/throwables";
import { r2, type PlayerState, type SessionMsg } from "../net/protocol";
import type { Role } from "../net/link";
import { emptyCommand, type PlayerCommand } from "../player/command";
import { MAX_BATTERY } from "../player/flashlight";
import { BREATH_NOISE, EXHALE_NOISE, GASP_NOISE } from "../player/breath";
import { DRY, NOISE_RADIUS, PlayerController, WATER } from "../player/playerController";
import type { Hud } from "../ui/hud";
import { Weapon } from "../weapons/weapon";
import type { Viewmodel } from "../weapons/viewmodel";
import { circleHitsWall, hasLineOfSight, isSolid, randomFloorNear, raycastWorld, worldToCell } from "../world/grid";
import { CheckpointMarker, DetonatorConsole, Door, Generator, Intercom, type Interactable } from "../world/interactables";
import { LampSystem } from "../world/lamps";
import { buildLevel, type LevelData } from "../world/levelBuilder";
import type { LevelDef } from "../world/levelDef";
import { parseLevel } from "../world/levelParser";
import { lootFor } from "../world/loot";
import { reinforcements } from "../world/reinforcements";
import { CHECKPOINT_LAYOUT, type CheckpointState } from "./checkpoint";
import { withAmmoFloor, type Loadout, type WeaponAmmo } from "./loadout";
import { RadioChannel } from "./radio";
import type { RadioLine, ScriptAction } from "./script";
import { isCharacterLook, LOOKS, personalise, type CharacterLook } from "../content/characters";
import { RemotePlayer } from "./remotePlayer";
import { freshStats, type RunStats } from "./stats";

const EXIT_RADIUS = 1.6;
const PICKUP_RADIUS = 1.1;
const MUZZLE_FLASH_TIME = 0.05;
const DOOR_NOISE = 9;
/** Prying a loose panel: a scrape and a thud, much quieter than a door's motor. */
const PANEL_NOISE = 4;
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
/** Co-op: talking carries this far (before a creature's hearing). Whisper, or hold it till you're clear. */
const VOICE_NOISE = 4;
/** Roughly how often (seconds) a creature is drawn towards you, by difficulty. */
const DIRECTOR_INTERVAL: Record<DifficultyDef["id"], number> = { story: 150, normal: 80, nightmare: 55, ironman: 80, aizi: 40 };
/** Creatures further than this (world units) never set your heart going. */
const DREAD_RANGE = 13;
/** The hold-breath hint shows once per page load. */
let breathHinted = false;
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
/**
 * Co-op scaling, by the number of players (index 2 = two players, 3 =
 * three): more creatures, and tougher ones. Supply pickups (ammo, medkits,
 * batteries, bottles) are shared, whoever takes one it's gone for everyone,
 * so a co-op level has this many times the supplies (seeded, the same for
 * every player). Everyone gets the player count with the level's start.
 */
const COOP_EXTRA_ENEMIES = [0, 0, 0.4, 0.7];
const COOP_ENEMY_HEALTH = [1, 1, 1.3, 1.45];
const COOP_LOOT = [1, 1, 1.8, 2.4];
/** Co-op: every player has to be this close to the exit to leave. */
const EXIT_TOGETHER = 4.5;

/** How a session talks to the other player in co-op. `Game` owns the actual connection. */
export interface CoopLink {
  readonly role: Role;
  /** This player's slot: 0 is the host, 1 and 2 the guests. */
  readonly slot: number;
  /** How many players the level was started for (2 or 3): the world is built for that many. */
  readonly players: number;
  /** Still connected to at least one other player. */
  readonly connected: boolean;
  /** To everyone else (a guest's goes to the host, who passes on what the other guest needs). */
  send(msg: SessionMsg, fast?: boolean): void;
  /** Host: to one guest only. */
  sendTo(slot: number, msg: SessionMsg): void;
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
  /** Co-op voice: your microphone, and the other players' voices placed in the world. */
  voice?: {
    /** Every frame, with the push-to-talk key. */
    update(dt: number, talkHeld: boolean): void;
    /** You're talking right now. */
    readonly speaking: boolean;
    /** Your microphone is live. */
    readonly open: boolean;
    /** Where a player's voice comes from this frame (null: they're not here). */
    place(slot: number, sp: Spatial | null): void;
  };
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
  /** Bottles and cans carried, to throw. */
  throwablesHeld: number;
  private readonly throwables: Throwables;
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
  private throwHintShown = false;
  private bottleHintShown = false;
  private armouredHits = 0;
  /** Supplies in the boss arena come back while the fight goes on: [pickup, seconds left]. */
  private readonly restock: [Pickup, number][] = [];
  /** 0..1: something close that you can't see (see `updateDread`). */
  private dread = 0;
  /** Seconds until the next creature is drawn towards you (see `updateDirector`). */
  private directorTimer = 40;
  /** Everything the boss has birthed; it dies with its mother. */
  private readonly brood = new Set<Enemy>();
  private humTimer = 0;
  private muzzleTime = 0;
  private promptCooldown = 0;
  private damageFx = 0;
  private time = 0;
  private finished = false;

  // --- co-op
  /** The other players' figures, by slot (co-op only), made when each is first heard from. */
  private readonly remotes = new Map<number, RemotePlayer>();
  /** Slots that left the game: late messages from them are ignored. */
  private readonly goneSlots = new Set<number>();
  /** Which player each entry of the last `perceptions()` list is (creatures' targets index into it). */
  private perceptionSlots: number[] = [0];
  /** Numbers the states and snapshots this player sends, and the last one applied from each stream. */
  private sentSeq = 0;
  private readonly lastSeq = new Map<string, number>();
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
    private readonly coop: CoopLink | null = null,
    /** Another go after a death: the pistol is topped up to the difficulty's floor. */
    retry = false
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

    // A checkpoint carries the loadout from the moment it was reached. After a
    // death (or resuming at a checkpoint) the pistol is topped up to the
    // difficulty's floor, so an empty gun can't trap you in a loop of deaths.
    const carried = restore?.loadout ?? loadout;
    const start = restore || retry ? withAmmoFloor(carried, difficulty) : carried;
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
    this.throwablesHeld = start.throwables;
    this.throwables = new Throwables(scene, this.level);
    this.player.flashlight.drainMultiplier = difficulty.batteryDrain;
    this.player.health.onDeath = () => this.handleDeath();
    this.player.health.onDamage = (amount, source) => this.handleDamage(amount, source);
    this.player.onFootstep = (gait, wet) => (wet ? sound.playSplash(gait) : sound.playFootstep(gait));
    this.player.flashlight.onToggle = (on) => sound.playFlashlight(on);
    this.player.onBreath = (e) => {
      sound.playBreath(e);
      if (e === "gasp") this.playerNoise(this.player.position2D, GASP_NOISE);
      else if (e === "release") this.playerNoise(this.player.position2D, EXHALE_NOISE);
    };

    // Harder difficulties (and co-op, with two of you) bring extra creatures; co-op ones are tougher too.
    const players = coop ? Math.min(3, Math.max(2, coop.players)) : 1;
    const extras = reinforcements(this.level, difficulty.extraEnemies + COOP_EXTRA_ENEMIES[players]);
    this.enemies = new EnemyManager(scene, this.level, [...sp.enemies, ...extras], {
      health: difficulty.enemyHealth * COOP_ENEMY_HEALTH[players],
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
      ...lootFor(this.level, difficulty.lootSupply * COOP_LOOT[players]).map((i) => new Pickup(scene, i.type, i.pos)),
      ...sp.notes.map((n) => new Pickup(scene, "note", n.pos, n.text, n.key)),
    ];

    // ---- interactables
    this.doors = sp.doors.map((d) => {
      const door = new Door(scene, this.level, d, this.level.wallMaterial);
      door.isUnlocked = () => this.hasKeycard;
      door.onOpen = () => {
        if (door.panel) {
          sound.playPanel(this.spatial(door.pos));
          this.worldNoise(door.pos, PANEL_NOISE);
          this.stats.secrets++;
          hud.toast("SECRET FOUND", "var(--ui-green)");
        } else {
          sound.playDoor(this.spatial(door.pos), door.security);
          this.worldNoise(door.pos, DOOR_NOISE);
        }
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

    // Every partner's figure (and headlamp) exists from the start, so no light is added mid-level.
    if (coop) for (let slot = 0; slot < coop.players; slot++) if (slot !== coop.slot) this.remoteFor(slot);

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
      throwables: this.throwablesHeld,
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
    this.updateThrowables(dt);
    if (!this.downed) {
      this.updateCombat(dt, cmd);
      this.updatePickups(dt);
      this.updateInteraction(dt, cmd.interact);
    }
    this.updateCoop(dt, cmd);
    this.updateGenerators(dt);
    this.radio.update(dt);
    this.lamps.update(dt, this.player.position, this.time, this.creaturePositions());
    this.effects.update(dt, engine.camera, this.player.flashlight.level, this.time);
    this.updateDirector(dt);

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
    this.updateDread(dt);
    sound.updateHeartbeat(dt, hp, this.dread);
    const winded = THREE.MathUtils.clamp((60 - this.player.stamina) / 60, 0, 1);
    sound.updateBreathing(dt, this.dread, winded, this.player.breath.held);
    sound.updateAmbient(dt);
    this.updateHud();
    this.updateBossBar();

    if (!this.finished) this.checkExit();
  }

  /**
   * How close something is that you can't see (0..1): a creature nearby,
   * behind you, around a corner or out in the dark. It drives your heartbeat
   * and breathing. One you're looking at in your light counts for less; one
   * that's hunting you counts for more. Smoothed, so it swells and fades.
   */
  private updateDread(dt: number): void {
    const cam = this.services.engine.camera;
    const me = this.player.position2D;
    const look = cam.getWorldDirection(new THREE.Vector3());
    const facing = new THREE.Vector2(look.x, look.z).normalize();
    const halfFov = THREE.MathUtils.degToRad((cam.fov * cam.aspect) / 2);
    const lit = this.player.flashlight.on && this.player.flashlight.level > 0.3;
    let target = 0;
    for (const e of this.enemies.enemies) {
      if (e.isDead) continue;
      const to = e.position2D.sub(me);
      const d = to.length();
      if (d > DREAD_RANGE) continue;
      const close = THREE.MathUtils.clamp((DREAD_RANGE - d) / (DREAD_RANGE - 3), 0, 1);
      const inView = d > 0.01 && to.divideScalar(d).dot(facing) > Math.cos(halfFov) && hasLineOfSight(this.level, me, e.position2D);
      const seen = inView && (lit || d < 4);
      target = Math.max(target, close * (seen ? 0.35 : 1) * (e.isHunting ? 1 : 0.65));
    }
    if (this.player.health.isDead || this.downed) target = 0;
    this.dread += (target - this.dread) * Math.min(1, dt * (target > this.dread ? 2.5 : 0.8));
    // The first time something gets close, say how to keep quiet.
    if (this.dread > 0.6 && !breathHinted) {
      breathHinted = true;
      this.services.hud.prompt(`Hold ${this.keyLabel("holdBreath") ?? "B"} to hold your breath`, 4);
    }
  }

  /** Where the living creatures are (lamps near them stutter). */
  private creaturePositions(): THREE.Vector2[] {
    return this.enemies.enemies.filter((e) => !e.isDead).map((e) => e.position2D);
  }

  /**
   * The hunt. Every so often (more often on harder settings) one creature
   * that isn't after you yet is drawn towards roughly where you are, as if
   * it could smell you: not straight to you, but close enough that the quiet
   * never lasts. Only the host decides; guests see it happen.
   */
  private updateDirector(dt: number): void {
    if (this.coop?.role === "guest" || this.finished) return;
    this.directorTimer -= dt;
    if (this.directorTimer > 0) return;
    this.directorTimer = DIRECTOR_INTERVAL[this.difficulty.id] * (0.75 + Math.random() * 0.5);
    const targets = [this.player.position2D, ...this.partners.map((r) => r.position2D)];
    const near = (p: THREE.Vector2) => Math.min(...targets.map((t) => t.distanceTo(p)));
    const candidates = this.enemies.enemies.filter(
      (e) => !e.isDead && !e.isHunting && e !== this.boss && e.state === "patrol" && near(e.position2D) > 14 && near(e.position2D) < 60
    );
    if (candidates.length === 0) return;
    // Roamers first, and the closest of those: the hunt should find you, not get lost.
    candidates.sort((a, b) => Number(b.roamer) - Number(a.roamer) || near(a.position2D) - near(b.position2D));
    const e = candidates[0];
    const target = targets.reduce((best, t) => (t.distanceTo(e.position2D) < best.distanceTo(e.position2D) ? t : best));
    e.drawnTo(randomFloorNear(this.level, target.x, target.y, 3));
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
    this.updateThrowables(dt);
    this.lamps.update(dt, this.player.position, this.time, this.creaturePositions());
    this.effects.update(dt, cam, this.player.flashlight.level, this.time);
    this.damageFx = Math.max(0.4, this.damageFx - dt);
    engine.setPostFx(this.damageFx, 1, this.time);
  }

  /** What the creatures can sense this frame: one entry per player (the host senses both). */
  private perceptions(dead: boolean): Perception[] {
    const list = [this.perception(dead)];
    this.perceptionSlots = [this.coop?.slot ?? 0];
    if (this.coop?.role !== "host") return list;
    for (const [slot, r] of this.remotes) {
      const s = r.state;
      if (!r.visible || !s) continue;
      this.perceptionSlots.push(slot);
      list.push({
        playerPos: r.position2D,
        playerNoise: s.down
          ? 0
          : Math.max(NOISE_RADIUS[s.gait] * (s.wet ? WATER.noise : 1), s.held ? 0 : BREATH_NOISE, s.talk ? VOICE_NOISE : 0),
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
      playerNoise: dead ? 0 : Math.max(this.player.noiseRadius, this.services.voice?.speaking && this.coop ? VOICE_NOISE : 0),
      torchOn: !dead && torch.on && torch.level > 0.3,
      playerDead: dead || this.player.health.isDead,
      eye: cam.getWorldPosition(new THREE.Vector3()),
      look: cam.getWorldDirection(new THREE.Vector3()),
    };
  }

  /** A state stream message older than the last one applied (they can arrive out of order): drop it. */
  private stale(stream: string, n: number | undefined): boolean {
    if (n === undefined) return false;
    const last = this.lastSeq.get(stream) ?? 0;
    if (n <= last) return true;
    this.lastSeq.set(stream, n);
    return false;
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
      const slot = this.perceptionSlots[e.target] ?? this.mySlot;
      if (slot !== this.mySlot) {
        this.coop?.sendTo(slot, { t: "hurt", dmg, from: [r2(from.x), r2(from.y)], heavy });
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

  private handleBossPhase(phase: number): void {
    const b = this.boss!;
    if (this.coop?.role === "host") this.coop.send({ t: "bossPhase", phase });
    this.player.addTrauma(0.7);
    this.services.hud.toast(`THE REMNANT — PHASE ${phase}`, "var(--ui-red)");
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
    if (boss.phase >= 3) this.spawnNear("husk", base);
    this.services.sound.playEnemy("spit", 0.5, this.spatial(base));
  }

  private spawnNear(kind: "swarm" | "husk", p: THREE.Vector2): void {
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
      layout: CHECKPOINT_LAYOUT,
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
    if (cmd.throw) this.throwBottle();
    if (cmd.melee) this.melee();
    if (cmd.reload && !this.busy) this.weapon.tryReload();
    if (cmd.fire) this.fire();
  }

  /** Throws a bottle where you're looking: where it breaks, creatures come to look. */
  private throwBottle(): void {
    const { hud, sound } = this.services;
    if (this.throwablesHeld <= 0) {
      this.throttledPrompt("NOTHING TO THROW — LOOK FOR BOTTLES");
      return;
    }
    if (this.busy) return;
    const cam = this.services.engine.camera;
    const { pos, vel } = throwFrom(cam.getWorldPosition(new THREE.Vector3()), cam.getWorldDirection(new THREE.Vector3()));
    this.throwablesHeld--;
    this.throwables.launch(pos, vel, true);
    this.coop?.send({ t: "toss", p: [r2(pos.x), r2(pos.y), r2(pos.z)], v: [r2(vel.x), r2(vel.y), r2(vel.z)] });
    sound.playThrow();
    this.player.addTrauma(0.05);
    if (!this.throwHintShown) {
      this.throwHintShown = true;
      hud.prompt("WHERE IT BREAKS, THEY GO TO LOOK", 3);
    }
  }

  private updateThrowables(dt: number): void {
    for (const l of this.throwables.update(dt)) {
      this.services.sound.playShatter(this.spatial(new THREE.Vector2(l.pos.x, l.pos.z)));
      this.effects.glassBurst(l.pos);
      // Only the thrower's copy is heard by the creatures (the host's, or sent over by the guest).
      if (l.own) this.playerNoise(new THREE.Vector2(l.pos.x, l.pos.z), SMASH_NOISE);
    }
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
  /** `by`: the slot of the player who killed it (another player's kill is credited to them). */
  private onEnemyKilled(enemy: Enemy, by = this.mySlot): void {
    if (by !== this.mySlot) this.coop?.sendTo(by, { t: "killed", i: this.enemies.enemies.indexOf(enemy) });
    else this.stats.kills++;
    if (enemy !== this.boss) return;
    for (const e of this.brood) e.takeDamage(e.health + 1, enemy.position2D);
    this.coop?.send({ t: "bossDead" });
    this.bossDefeated();
  }

  private bossDefeated(): void {
    this.services.hud.toast("THE REMNANT IS DEAD", "var(--ui-red)");
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
        this.pickUpWeapon(item.weapon, amount(WEAPONS[item.weapon].ammoPickup * 4));
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
        case "bottle":
          if (this.throwablesHeld >= MAX_THROWABLES) {
            this.throttledPrompt("CAN'T CARRY MORE BOTTLES");
            continue;
          }
          this.throwablesHeld++;
          hud.toast(`+ BOTTLE (${this.throwablesHeld}/${MAX_THROWABLES})`, "var(--ui-green)");
          if (!this.bottleHintShown) {
            this.bottleHintShown = true;
            hud.prompt(`PRESS ${this.services.keyFor("throw")} TO THROW IT — A NOISE TO LEAD THEM AWAY`, 4);
          }
          break;
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
    // Co-op: nobody leaves alone. The host decides when you all have.
    const partners = this.partners;
    if (partners.some((r) => r.down)) return this.throttledPrompt(partners.length > 1 ? "A PARTNER IS DOWN" : "YOUR PARTNER IS DOWN");
    if (partners.some((r) => r.position2D.distanceTo(exit) > EXIT_TOGETHER))
      return this.throttledPrompt(partners.length > 1 ? "WAITING FOR YOUR PARTNERS" : "WAITING FOR YOUR PARTNER");
    if (this.coop?.role === "guest" && this.coop.connected) return;
    this.finish(this.def.finale ? "leave" : null);
  }

  private finish(ending: EndingId | null): void {
    if (this.finished) return;
    this.finished = true;
    if (this.coop?.role === "host") this.coop.send({ t: "finish", ending });
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
    // Co-op: you go down, and a partner still standing has a while to get you back up.
    if (this.partners.some((r) => !r.down)) return this.goDown();
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

  private get mySlot(): number {
    return this.coop?.slot ?? 0;
  }

  /** The other players who are connected and in the level. */
  private get partners(): RemotePlayer[] {
    if (!this.coop?.connected) return [];
    return [...this.remotes.values()].filter((r) => r.visible);
  }

  /** The figure for another player's slot, made the first time they're heard from. */
  private remoteFor(slot: number): RemotePlayer {
    let r = this.remotes.get(slot);
    if (!r) {
      r = new RemotePlayer(this.services.engine.scene);
      r.onFootstep = (gait, wet, at) => this.services.sound.playFootstepAt(gait, wet, this.spatial(at));
      this.remotes.set(slot, r);
    }
    return r;
  }

  /** A player left the game: their figure goes, and (host) the others are told. */
  partnerLeft(slot: number): void {
    this.goneSlots.add(slot);
    this.remotes.get(slot)?.hide();
    if (this.coop?.role === "host") this.coop.send({ t: "gone", slot });
  }

  /** The downed partner you're standing over, if any: holding the use key gets them up. */
  private get reviveTarget(): number | null {
    if (this.downed || !this.coop?.connected) return null;
    const me = this.player.position2D;
    for (const [slot, r] of this.remotes) if (r.visible && r.down && r.position2D.distanceTo(me) < REVIVE_RANGE) return slot;
    return null;
  }

  private get canRevive(): boolean {
    return this.reviveTarget !== null;
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
      held: p.breath.held,
      talk: this.services.voice?.speaking || undefined,
      n: ++this.sentSeq,
    };
    this.coop?.send(state, true);
  }

  private goDown(): void {
    const { hud, sound, viewmodel } = this.services;
    this.downed = true;
    this.player.breath.reset();
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
    if (!coop) return;
    const { hud, sound } = this.services;
    if (!coop.connected) {
      for (const r of this.remotes.values()) if (r.visible) r.hide();
      if (!this.partnerGoneShown && !this.finished) hud.toast("YOUR PARTNER IS GONE", "var(--ui-red)");
      this.partnerGoneShown = true;
      // Nobody left to get you up.
      if (this.downed) this.die();
      return;
    }
    for (const r of this.remotes.values()) r.update(dt, this.time);
    const voice = this.services.voice;
    voice?.update(dt, cmd.talk && !this.player.health.isDead);
    for (const [slot, r] of this.remotes) voice?.place(slot, r.visible ? this.spatial(r.position2D) : null);
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.stateTimer = STATE_INTERVAL;
      this.sendState();
    }
    if (coop.role === "host") {
      this.snapshotTimer -= dt;
      if (this.snapshotTimer <= 0) {
        this.snapshotTimer = SNAPSHOT_INTERVAL;
        coop.send({ t: "es", e: this.enemies.enemies.map((e) => e.netState()), n: ++this.sentSeq }, true);
      }
    }
    if (this.finished) return;

    const partners = this.partners;
    if (this.downed) {
      this.bleed -= dt;
      hud.prompt(
        `YOU'RE DOWN — ${Math.max(0, Math.ceil(this.bleed))}s — ${partners.length > 1 ? "A PARTNER" : "YOUR PARTNER"} CAN GET YOU UP`,
        0.25
      );
      if (this.bleed <= 0 || partners.every((r) => r.down)) {
        coop.send({ t: "wipe" });
        this.die();
      }
      return;
    }
    const target = this.reviveTarget;
    if (target === null) {
      this.reviveProgress = 0;
      const down = partners.find((r) => r.down);
      if (down)
        hud.prompt(`${partners.length > 1 ? "A PARTNER" : "YOUR PARTNER"} IS DOWN — ${down.state?.bleed ?? 0}s TO REACH THEM`, 0.25);
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
      coop.send({ t: "revive", who: target });
      hud.toast("PARTNER REVIVED", "var(--ui-green)");
      sound.playHeal();
    }
  }

  /** Another player fired: their gun, their muzzle flash, where their bullets landed. */
  private partnerShot(m: Extract<SessionMsg, { t: "shot" }>, from: number): void {
    const r = this.remotes.get(from);
    if (!r) return;
    r.fired();
    this.services.sound.playGunshotAt(m.w, this.spatial(r.position2D));
    for (const [x, y, z, nx, ny, nz] of m.walls) this.effects.impact(new THREE.Vector3(x, y, z), new THREE.Vector3(nx, ny, nz));
    for (const [x, y, z, dx, dy, dz] of m.blood) this.effects.bloodBurst(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, dy, dz), 12);
  }

  /** A message from another player, `from` being their slot (see `net/protocol.ts`). */
  receive(m: SessionMsg, from = 0): void {
    const enemy = (i: number): Enemy | undefined => this.enemies.enemies[i];
    const host = this.coop?.role === "host";
    switch (m.t) {
      case "ps":
        if (this.goneSlots.has(from) || from === this.mySlot || this.stale(`ps${from}`, m.n)) break;
        this.remoteFor(from).apply(m);
        break;
      case "gone":
        if (m.slot !== this.mySlot) this.partnerLeft(m.slot);
        break;
      case "es":
        if (!host && !this.stale("es", m.n)) m.e.forEach((a, i) => enemy(i)?.applyNet(a));
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
        this.partnerShot(m, from);
        break;
      case "noise":
        if (host) this.enemies.emitNoise(new THREE.Vector2(m.x, m.z), m.r);
        break;
      case "hit": {
        const e = enemy(m.i);
        if (!host || !e || e.isDead) break;
        if (e.takeDamage(m.dmg, new THREE.Vector2(m.x, m.z), m.part)) this.onEnemyKilled(e, from);
        break;
      }
      case "takedown": {
        const e = enemy(m.i);
        if (!host || !e || e.isDead) break;
        const at = new THREE.Vector2(m.x, m.z);
        const by = from;
        if (e.canBeTakenDown(at)) {
          e.takedown();
          this.onEnemyKilled(e, by);
        } else if (e.takeDamage(MELEE_DAMAGE, at)) this.onEnemyKilled(e, by);
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
      case "toss":
        // The partner's throw: flown here too, so it's seen and heard, but their copy makes the noise.
        this.throwables.launch(new THREE.Vector3(...m.p), new THREE.Vector3(...m.v), false);
        break;
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
        if (m.who === this.mySlot) this.revived();
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
    hud.setHealKey(this.services.keyFor("heal"), this.services.keyFor("throw"));
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
      breath: this.player.breath.air,
      breathHeld: this.player.breath.held,
      breathKey: this.services.keyFor("holdBreath"),
      throwables: this.throwablesHeld,
      mic: this.coop ? (this.services.voice?.open ? (this.services.voice.speaking ? "talking" : "open") : "off") : "off",
    });
    hud.partners(
      this.partners.flatMap((p) => {
        const r = p.state;
        return r
          ? [
              {
                hp: r.hp,
                down: r.down,
                bleed: r.bleed,
                talking: !!r.talk,
                name: isCharacterLook(r.look) ? LOOKS[r.look].firstName : undefined,
              },
            ]
          : [];
      })
    );
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
