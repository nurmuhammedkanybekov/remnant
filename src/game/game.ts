import { SoundManager } from "../audio/soundManager";
import { DIFFICULTIES, type DifficultyDef, type DifficultyId } from "../content/difficulty";
import { cloneBindings, DEFAULT_BINDINGS, keyLabel, type Action } from "../core/actions";
import { ENDINGS, PROLOGUE, type EndingId } from "../content/story";
import { Clock } from "../core/clock";
import { Engine } from "../core/engine";
import { Input } from "../core/input";
import { SaveStore } from "./save";
import { loadSettings, saveSettings, type Settings } from "../core/settings";
import type { Enemy } from "../enemies/enemy";
import { buildCommand, type PlayerCommand } from "../player/command";
import { Hud } from "../ui/hud";
import { Screens, type MenuItem } from "../ui/menu";
import { Viewmodel } from "../weapons/viewmodel";
import { LEVELS } from "../world/levels";
import type { CheckpointState } from "./checkpoint";
import { LevelSession, type SessionServices } from "./levelSession";
import { carryOver, cloneLoadout, startingLoadout, type Loadout } from "./loadout";
import { MenuBackdrop } from "./menuBackdrop";
import { addStats, freshStats, type RunStats } from "./stats";

type GameState = "menu" | "playing" | "paused" | "dead" | "levelComplete" | "victory";

/** Radians of look per pixel of mouse movement at sensitivity 1. */
const BASE_LOOK_SPEED = 0.0022;
const DEATH_SCREEN_DELAY_MS = 1400;

/** The campaign run in progress. Mirrors what is checkpointed to the save. */
interface Run {
  difficulty: DifficultyDef;
  levelIndex: number;
  /** The loadout the current level was entered with (what "Retry" restores). */
  loadout: Loadout;
  /** Totals across finished levels. */
  stats: RunStats;
  /** Mid-level checkpoint in the current level, if one was reached. */
  checkpoint: CheckpointState | null;
}

/**
 * The application shell: owns the long-lived systems (renderer, audio, UI,
 * input, saves), runs the main loop and moves between menus and levels.
 * Gameplay itself lives in `LevelSession`.
 */
export class Game {
  private readonly engine: Engine;
  private readonly input: Input;
  private readonly clock = new Clock();
  private readonly sound = new SoundManager();
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly viewmodel: Viewmodel;
  private readonly services: SessionServices;
  private readonly settings: Settings = loadSettings();
  private readonly save = new SaveStore(LEVELS.length);
  private readonly debug = new URLSearchParams(location.search).has("debug");

  private state: GameState = "menu";
  private run: Run | null = null;
  private session: LevelSession | null = null;
  private backdrop: MenuBackdrop | null = null;
  /** Debug harness: fire on the next simulated frame. */
  private scriptedFire = false;

  constructor(container: HTMLElement) {
    this.engine = new Engine(container);
    this.engine.setFov(this.settings.fov);
    this.input = new Input(this.engine.domElement);
    this.hud = new Hud(container);
    this.screens = new Screens(container);
    this.screens.onUiSound = () => this.sound.playUi();
    this.viewmodel = new Viewmodel(this.engine.viewScene, this.engine.camera);
    this.services = {
      engine: this.engine,
      sound: this.sound,
      hud: this.hud,
      viewmodel: this.viewmodel,
      keyFor: (action: Action) => {
        const [primary, alternate] = this.settings.bindings[action];
        return keyLabel(primary ?? alternate);
      },
    };
    this.hud.setVisible(false);
    this.sound.setVolume(this.settings.volume);

    document.addEventListener("pointerlockchange", () => {
      if (!this.input.locked && this.state === "playing" && !this.debug) this.pause();
    });
    // Clicking the game view after losing pointer lock resumes control.
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
    this.session = null;
    this.run = null;
    this.hud.setVisible(false);
    this.hud.hideTransient();
    this.viewmodel.setVisible(false);
    this.sound.setPaused(false);
    // The maintenance wing's long lamp-lit corridor makes the best establishing shot.
    this.backdrop = new MenuBackdrop(this.engine, LEVELS[1]);

    const saved = this.save.campaign;
    const items: MenuItem[] = [];
    if (saved) {
      const def = LEVELS[saved.levelIndex];
      items.push({
        label: "Continue",
        primary: true,
        detail: `${def.name} · ${def.subtitle} — ${DIFFICULTIES[saved.difficulty].name}`,
        action: () => this.continueCampaign(),
      });
    }
    items.push(
      { label: "New Game", primary: !saved, action: () => this.confirmReplaceRun(() => this.showDifficulty(0)) },
      { label: "Chapters", disabled: this.save.progress.unlockedLevel === 0, action: () => this.showChapters() },
      { label: "Settings", action: () => this.showSettings(() => this.showMainMenu()) },
      { label: "Controls", action: () => this.showControls(() => this.showMainMenu()) }
    );
    this.screens.main(items, __APP_VERSION__);
  }

  /** Starting a new run replaces the saved one — ask first. */
  private confirmReplaceRun(proceed: () => void): void {
    if (!this.save.campaign) return proceed();
    this.screens.confirm(
      "START OVER?",
      "Starting a new run replaces your saved progress in the current one.",
      "Start New Run",
      proceed,
      () => this.showMainMenu()
    );
  }

  private showDifficulty(levelIndex: number): void {
    this.screens.difficulty(
      (id) => (levelIndex === 0 ? this.showPrologue(id) : this.startCampaign(id, levelIndex)),
      () => this.showMainMenu(),
      this.save.progress.completed
    );
  }

  private showPrologue(difficulty: DifficultyId): void {
    this.screens.story(PROLOGUE.title, PROLOGUE.lines, [
      { label: "Begin", primary: true, action: () => this.startCampaign(difficulty, 0) },
    ]);
  }

  private showChapters(): void {
    const { unlockedLevel, bestTimes } = this.save.progress;
    this.screens.chapters(
      LEVELS.map((def, i) => ({ name: def.name, subtitle: def.subtitle, unlocked: i <= unlockedLevel, bestTime: bestTimes[def.id] })),
      (i) => this.confirmReplaceRun(() => this.showDifficulty(i)),
      () => this.showMainMenu()
    );
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

  private showControls(back: () => void): void {
    this.screens.controls(
      this.settings.bindings,
      (b) => {
        this.settings.bindings = b;
        saveSettings(this.settings);
      },
      () => {
        this.settings.bindings = cloneBindings(DEFAULT_BINDINGS);
        saveSettings(this.settings);
        this.showControls(back);
      },
      back
    );
  }

  private pause(): void {
    if (!this.run) return;
    this.state = "paused";
    this.sound.setPaused(true);
    this.hud.hideTransient();
    const show = () =>
      this.screens.pause(
        [
          { label: "Resume", primary: true, action: () => this.resume() },
          ...(this.run!.checkpoint ? [{ label: "Restart from Checkpoint", action: () => this.startLevel() }] : []),
          { label: "Restart Level", action: () => this.restartLevelFresh() },
          { label: "Settings", action: () => this.showSettings(show) },
          { label: "Controls", action: () => this.showControls(show) },
          { label: "Quit to Menu", detail: "Progress is saved at the start of each level", action: () => this.showMainMenu() },
        ],
        this.run!.difficulty.name
      );
    show();
  }

  private resume(): void {
    this.screens.hide();
    this.sound.setPaused(false);
    this.input.requestLock();
    this.clock.tick(); // don't let the pause count as a giant frame
    this.state = "playing";
  }

  // ------------------------------------------------------------------ campaign flow

  private startCampaign(difficulty: DifficultyId, levelIndex: number): void {
    const def = DIFFICULTIES[difficulty];
    const loadout = startingLoadout(
      def,
      LEVELS.map((l) => l.id),
      levelIndex
    );
    this.run = { difficulty: def, levelIndex, loadout, stats: freshStats(), checkpoint: null };
    this.startLevel();
  }

  private continueCampaign(): void {
    const saved = this.save.campaign;
    if (!saved) return;
    this.run = {
      difficulty: DIFFICULTIES[saved.difficulty],
      levelIndex: saved.levelIndex,
      loadout: cloneLoadout(saved.loadout),
      stats: { ...saved.stats },
      checkpoint: saved.checkpoint ? structuredClone(saved.checkpoint) : null,
    };
    this.startLevel();
  }

  private restartLevelFresh(): void {
    if (!this.run) return;
    this.run.checkpoint = null;
    this.startLevel();
  }

  private persistRun(): void {
    const run = this.run;
    if (!run) return;
    this.save.checkpoint({
      difficulty: run.difficulty.id,
      levelIndex: run.levelIndex,
      loadout: run.loadout,
      stats: run.stats,
      checkpoint: run.checkpoint,
    });
  }

  /** (Re)starts the run's current level — from its mid-level checkpoint if there is one. */
  private startLevel(): void {
    const run = this.run;
    if (!run) return;
    this.sound.init();
    this.persistRun();

    this.backdrop = null;
    this.screens.hide();
    this.hud.hideTransient();
    const session = new LevelSession(this.services, LEVELS[run.levelIndex], run.difficulty, run.loadout, run.checkpoint);
    session.onDeath = () => this.onDeath();
    session.onExit = (ending) => this.onLevelComplete(ending);
    session.onCheckpoint = (state) => {
      run.checkpoint = state;
      this.persistRun();
    };
    this.session = session;

    this.hud.setVisible(true);
    this.sound.setPaused(false);
    if (!this.debug) this.input.requestLock();
    this.clock.tick();
    this.state = "playing";
  }

  private leaveGameplay(): void {
    this.input.exitLock();
    this.hud.hideTransient();
    this.viewmodel.setVisible(false);
  }

  private onDeath(): void {
    const run = this.run!;
    this.state = "dead";
    this.leaveGameplay();
    const runOver = run.difficulty.permadeath;
    if (runOver) this.save.clearCampaign();
    const stats = { ...this.session!.stats };
    window.setTimeout(() => {
      if (this.state !== "dead") return;
      this.hud.setVisible(false);
      this.screens.death(
        stats,
        runOver
          ? [{ label: "Main Menu", primary: true, action: () => this.showMainMenu() }]
          : [
              { label: run.checkpoint ? "Retry from Checkpoint" : "Retry Level", primary: true, action: () => this.startLevel() },
              ...(run.checkpoint ? [{ label: "Restart Level", action: () => this.restartLevelFresh() }] : []),
              { label: "Quit to Menu", action: () => this.showMainMenu() },
            ],
        runOver
      );
    }, DEATH_SCREEN_DELAY_MS);
  }

  private onLevelComplete(ending: EndingId | null): void {
    const run = this.run!;
    const session = this.session!;
    this.leaveGameplay();
    this.hud.setVisible(false);
    addStats(run.stats, session.stats);
    const newBest = this.save.recordLevelTime(session.def.id, session.stats.time);

    if (run.levelIndex >= LEVELS.length - 1) {
      this.state = "victory";
      const id = ending ?? "leave";
      this.save.completeCampaign(run.difficulty.id, id);
      this.screens.ending(ENDINGS[id], run.stats, run.difficulty.name, [
        { label: "Main Menu", primary: true, action: () => this.showMainMenu() },
      ]);
      return;
    }

    this.state = "levelComplete";
    run.levelIndex++;
    run.loadout = carryOver(session.loadout, run.difficulty);
    run.checkpoint = null;
    // Save now, so quitting from the results screen resumes at the next level.
    this.persistRun();
    this.screens.levelComplete(session.def.name, session.def.subtitle, session.stats, newBest, [
      { label: "Continue", primary: true, action: () => this.startLevel() },
      { label: "Quit to Menu", action: () => this.showMainMenu() },
    ]);
  }

  // ------------------------------------------------------------------ loop

  private readonly loop = (): void => {
    this.step(this.clock.tick());
    this.input.endFrame();
    this.engine.render();
    requestAnimationFrame(this.loop);
  };

  private readCommand(): PlayerCommand {
    const active = this.input.locked || this.debug;
    const cmd = buildCommand(
      this.input,
      this.settings.bindings,
      active ? { radiansPerPixel: BASE_LOOK_SPEED * this.settings.sensitivity, invertY: this.settings.invertY } : null
    );
    // The click that re-captures the mouse must not also fire the gun.
    if (!active) cmd.fire = false;
    if (this.scriptedFire) cmd.fire = true;
    this.scriptedFire = false;
    return cmd;
  }

  private step(dt: number): void {
    switch (this.state) {
      case "menu":
        this.backdrop?.update(dt);
        this.sound.updateAmbient(dt);
        break;
      case "playing":
        // Pointer lock can be refused (e.g. resuming too quickly after Esc) — tell the player to click.
        if (!this.input.locked && !this.debug) this.hud.prompt("CLICK TO RESUME", 0.25);
        this.session?.step(dt, this.readCommand());
        break;
      case "dead":
        this.session?.stepDead(dt);
        break;
      default:
        this.engine.setPostFx(0, 0, performance.now() / 1000);
    }
  }

  // ------------------------------------------------------------------ debug hooks (?debug only)

  debugStart(level = 0, difficulty: DifficultyId = "normal"): void {
    this.startCampaign(difficulty, level);
  }
  debugLook(yaw: number, pitch: number): void {
    this.session?.player.setLook(yaw, pitch);
  }
  debugTeleport(x: number, z: number): void {
    if (!this.session) return;
    this.session.player.position.x = x;
    this.session.player.position.z = z;
  }
  debugEnemies(): Enemy[] {
    return this.session?.enemies.enemies ?? [];
  }
  /** Advance the simulation at a fixed 30 Hz without rendering, holding the given key codes. */
  debugSimulate(seconds: number, codes: string[] = []): void {
    for (const c of codes) this.input.simulateDown(c, true);
    for (let t = 0; t < seconds; t += 1 / 30) {
      this.step(1 / 30);
      this.input.endFrame();
    }
    for (const c of codes) this.input.simulateDown(c, false);
  }
  debugFire(): void {
    this.scriptedFire = true;
    this.step(1 / 30);
    this.input.endFrame();
  }
  debugState(): string {
    return this.state;
  }
}
