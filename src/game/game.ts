import { MusicDirector } from "../audio/music";
import { SoundManager } from "../audio/soundManager";
import { DIFFICULTIES, type DifficultyDef, type DifficultyId } from "../content/difficulty";
import { cloneBindings, DEFAULT_BINDINGS, keyLabel, type Action } from "../core/actions";
import { ENDINGS, PROLOGUE, TRANSMISSIONS, type EndingId } from "../content/story";
import { PAD, padLabel } from "../core/gamepad";
import { QUALITY } from "../core/quality";
import { Clock } from "../core/clock";
import { Engine } from "../core/engine";
import { Input } from "../core/input";
import { SaveStore } from "./save";
import { loadSettings, saveSettings, type Settings } from "../core/settings";
import type { Enemy } from "../enemies/enemy";
import { CLOSE_REASONS, PeerLink } from "../net/link";
import { makeRoomCode, normalizeRoomCode, PROTOCOL_VERSION, type NetMsg, type SessionMsg } from "../net/protocol";
import { DEFAULT_SIGNAL_URL } from "../net/signaling";
import { buildCommand, emptyCommand, type PlayerCommand } from "../player/command";
import { Hud } from "../ui/hud";
import { Screens, type MenuItem } from "../ui/menu";
import { Viewmodel } from "../weapons/viewmodel";
import { LEVELS } from "../world/levels";
import type { CheckpointState } from "./checkpoint";
import { LevelSession, type SessionServices } from "./levelSession";
import { carryOver, cloneLoadout, startingLoadout, type Loadout } from "./loadout";
import { MenuBackdrop } from "./menuBackdrop";
import { addStats, freshStats, type RunStats } from "./stats";

type GameState = "title" | "menu" | "card" | "playing" | "paused" | "dead" | "levelComplete" | "victory";

/** Radians of look per pixel of mouse movement at sensitivity 1. */
const BASE_LOOK_SPEED = 0.0022;
/** Radians per second at full right-stick tilt, at gamepad look speed 1. */
const BASE_PAD_LOOK_SPEED = 2.8;
/** Gamepad menu navigation: first repeat after holding, then this often. */
const NAV_DELAY = 0.4;
const NAV_REPEAT = 0.14;
/** "Reduced camera shake" keeps this much of the shake and bob. */
const REDUCED_MOTION = 0.2;
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
  /** A co-op run: nothing is written to the save, and the host drives the flow. */
  coop: boolean;
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
  private readonly music = new MusicDirector();
  private readonly container: HTMLElement;
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly viewmodel: Viewmodel;
  private readonly services: SessionServices;
  private readonly settings: Settings = loadSettings();
  private readonly save = new SaveStore(LEVELS.length);
  private readonly debug = new URLSearchParams(location.search).has("debug");

  private state: GameState = "title";
  private navHeld = 0;
  private navTimer = 0;
  private run: Run | null = null;
  private session: LevelSession | null = null;
  private backdrop: MenuBackdrop | null = null;
  /** Debug harness: fire on the next simulated frame. */
  private scriptedFire = false;
  /** Co-op: the connection to the other player, while there is one. */
  private link: PeerLink | null = null;
  /** Matchmaking server; `?signal=wss://…` points at a self-hosted one. */
  private readonly signalUrl = new URLSearchParams(location.search).get("signal") ?? DEFAULT_SIGNAL_URL;

  constructor(container: HTMLElement) {
    this.container = container;
    this.engine = new Engine(container);
    this.engine.setFov(this.settings.fov);
    this.engine.setQuality(QUALITY[this.settings.quality]);
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
        if (this.input.usingPad) return padLabel(action);
        const [primary, alternate] = this.settings.bindings[action];
        return keyLabel(primary ?? alternate);
      },
      quality: () => QUALITY[this.settings.quality],
      motionScale: () => (this.settings.reducedShake ? REDUCED_MOTION : 1),
    };
    this.hud.setVisible(false);
    this.sound.setVolume(this.settings.volume);
    this.sound.setMusicVolume(this.settings.musicVolume);
    this.sound.onReady = (out) => this.music.attach(out);
    this.applyDisplaySettings();

    document.addEventListener("pointerlockchange", () => {
      if (!this.input.locked && this.state === "playing" && !this.debug && !this.input.usingPad) this.pause();
    });
    // Clicking the game view after losing pointer lock resumes control.
    this.engine.domElement.addEventListener("click", () => {
      if (this.state === "playing" && !this.input.locked && !this.debug) this.input.requestLock();
    });

    if (this.debug) (window as unknown as { game: Game }).game = this;

    // The world behind the title and menus.
    this.backdrop = new MenuBackdrop(this.engine, LEVELS[1], QUALITY[this.settings.quality]);
    document.getElementById("boot")?.remove();
    this.showTitle();
    requestAnimationFrame(this.loop);
  }

  /** Settings that change how the HUD and camera behave. */
  private applyDisplaySettings(): void {
    this.hud.applyDisplay(this.settings.hudScale, this.settings.subtitleSize);
    this.container.classList.toggle("cb", this.settings.colorBlind);
    this.session?.applySettings();
  }

  // ------------------------------------------------------------------ menus

  /** Loading is done; wait for a key, which is also what lets the browser start audio. */
  private showTitle(): void {
    this.state = "title";
    this.screens.title(this.input.usingPad ? "PRESS A" : "PRESS ANY KEY", () => {
      this.sound.init();
      this.music.setMode("silent");
      this.showMainMenu();
    });
  }

  private showMainMenu(): void {
    this.endCoop();
    this.state = "menu";
    this.music.setMode("silent");
    this.hud.setVisible(false);
    this.hud.hideTransient();
    this.viewmodel.setVisible(false);
    this.sound.setPaused(false);
    // The maintenance wing's long lamp-lit corridor makes the best establishing shot.
    if (this.session || !this.backdrop) this.backdrop = new MenuBackdrop(this.engine, LEVELS[1], QUALITY[this.settings.quality]);
    this.session = null;
    this.run = null;

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
      { label: "Co-op", detail: "Two players, online", action: () => this.showCoopMenu() },
      { label: "Settings", action: () => this.showSettings(() => this.showMainMenu()) },
      { label: "Controls", action: () => this.showControls(() => this.showMainMenu()) }
    );
    const reached = this.save.progress.unlockedLevel;
    this.screens.main(
      items,
      __APP_VERSION__,
      LEVELS.map((def, i) => ({ name: def.name, subtitle: def.subtitle, reached: i <= reached })),
      TRANSMISSIONS[Math.floor(Math.random() * TRANSMISSIONS.length)]
    );
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
        this.engine.setQuality(QUALITY[s.quality]);
        this.sound.setVolume(s.volume);
        this.sound.setMusicVolume(s.musicVolume);
        this.applyDisplaySettings();
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
    if (this.run.coop) {
      // Online, the world doesn't stop for a menu.
      const show = () =>
        this.screens.pause(
          [
            { label: "Resume", primary: true, action: () => this.resume() },
            { label: "Settings", action: () => this.showSettings(show) },
            { label: "Controls", action: () => this.showControls(show) },
            { label: "Leave Game", detail: "Your partner is left on their own", action: () => this.showMainMenu() },
          ],
          `${this.run!.difficulty.name} · CO-OP — THE GAME KEEPS RUNNING`
        );
      show();
      return;
    }
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
    if (!this.input.usingPad) this.input.requestLock();
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
    this.run = { difficulty: def, levelIndex, loadout, stats: freshStats(), checkpoint: null, coop: false };
    this.startLevel(true);
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
      coop: false,
    };
    this.startLevel(true);
  }

  private restartLevelFresh(): void {
    if (!this.run) return;
    this.run.checkpoint = null;
    this.startLevel();
  }

  private persistRun(): void {
    const run = this.run;
    if (!run || run.coop) return;
    this.save.checkpoint({
      difficulty: run.difficulty.id,
      levelIndex: run.levelIndex,
      loadout: run.loadout,
      stats: run.stats,
      checkpoint: run.checkpoint,
    });
  }

  /**
   * (Re)starts the run's current level — from its mid-level checkpoint if
   * there is one. Coming in from a menu shows the level's title card first;
   * a retry drops straight back in.
   */
  private startLevel(card = false): void {
    const run = this.run;
    if (!run) return;
    this.sound.init();
    this.persistRun();

    this.backdrop = null;
    this.screens.hide();
    this.hud.hideTransient();
    const session = new LevelSession(
      this.services,
      LEVELS[run.levelIndex],
      run.difficulty,
      run.loadout,
      run.checkpoint,
      run.coop ? this.link : null
    );
    session.onDeath = () => this.onDeath();
    session.onExit = (ending) => this.onLevelComplete(ending);
    session.onCheckpoint = (state) => {
      run.checkpoint = state;
      this.persistRun();
    };
    this.session = session;
    this.music.setMode("game");

    // Co-op skips the card: the other player is already on their way in.
    if (card && !this.debug && !run.coop) {
      this.state = "card";
      const def = LEVELS[run.levelIndex];
      this.screens.levelCard(
        {
          index: run.levelIndex,
          name: def.name,
          subtitle: def.subtitle,
          tagline: def.tagline,
          objective: run.checkpoint?.objective ?? def.objective,
          depth: LEVELS.map((d, i) => ({ name: d.name, subtitle: d.subtitle, reached: i <= run.levelIndex })),
          prompt: this.input.usingPad ? "PRESS A" : "CLICK OR PRESS ANY KEY",
        },
        () => this.beginLevel(false)
      );
      return;
    }
    this.beginLevel(true);
  }

  /** Into the level: HUD on, mouse captured, clock running. */
  private beginLevel(intro: boolean): void {
    const session = this.session;
    if (!session) return;
    this.screens.hide();
    this.hud.setVisible(true);
    if (intro) this.hud.intro(session.def.name, session.def.subtitle);
    this.sound.setPaused(false);
    if (!this.debug && !this.input.usingPad) this.input.requestLock();
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
    this.music.setMode("silent");
    this.leaveGameplay();
    const stats = { ...this.session!.stats };
    if (run.coop) {
      window.setTimeout(() => {
        if (this.state !== "dead") return;
        this.hud.setVisible(false);
        this.screens.death(stats, this.isGuest ? this.waitForHost() : this.coopRetryItems(), false);
      }, DEATH_SCREEN_DELAY_MS);
      return;
    }
    const runOver = run.difficulty.permadeath;
    if (runOver) this.save.clearCampaign();
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
    const newBest = !run.coop && this.save.recordLevelTime(session.def.id, session.stats.time);
    this.music.setMode("silent");

    if (run.levelIndex >= LEVELS.length - 1) {
      this.state = "victory";
      const id = ending ?? "leave";
      if (!run.coop) this.save.completeCampaign(run.difficulty.id, id);
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
    const next: MenuItem[] = !run.coop
      ? [
          { label: "Continue", primary: true, action: () => this.startLevel(true) },
          { label: "Quit to Menu", action: () => this.showMainMenu() },
        ]
      : this.isGuest
        ? this.waitForHost()
        : [
            {
              label: "Continue",
              primary: true,
              action: () => {
                this.link?.send({ t: "start", level: run.levelIndex, difficulty: run.difficulty.id, fresh: false });
                this.startLevel(true);
              },
            },
            { label: "Leave Game", action: () => this.showMainMenu() },
          ];
    this.screens.levelComplete(session.def.name, session.def.subtitle, session.stats, newBest, next);
  }

  // ------------------------------------------------------------------ co-op

  private get isGuest(): boolean {
    return this.link?.role === "guest";
  }

  private showCoopMenu(): void {
    this.endCoop();
    this.state = "menu";
    this.screens.lobby(
      "CO-OP",
      "TWO PLAYERS · ONLINE",
      "One of you hosts and picks the sublevel; the other joins with the host's room code.\nYou leave each sublevel together — and when one of you goes down, the other has 45 seconds to get them back up.",
      [
        { label: "Host a Game", primary: true, action: () => this.showCoopChapters() },
        { label: "Join a Game", action: () => this.showJoin() },
        { label: "Back", action: () => this.showMainMenu() },
      ]
    );
  }

  private showCoopChapters(): void {
    const { unlockedLevel, bestTimes } = this.save.progress;
    this.screens.chapters(
      LEVELS.map((def, i) => ({ name: def.name, subtitle: def.subtitle, unlocked: i <= unlockedLevel, bestTime: bestTimes[def.id] })),
      (level) =>
        this.screens.difficulty(
          (difficulty) => this.hostGame(level, difficulty),
          () => this.showCoopChapters(),
          this.save.progress.completed
        ),
      () => this.showCoopMenu()
    );
  }

  /** Opens a room and waits for the partner. Returns the room code. */
  private hostGame(level: number, difficulty: DifficultyId): string {
    const code = makeRoomCode();
    const link = this.openLink("host", code);
    this.screens.lobby(
      "HOST",
      "ROOM CODE",
      "Send this code to your partner.\nWaiting for them to join…",
      [{ label: "Cancel", action: () => this.showCoopMenu() }],
      code
    );
    link.onOpen = () => {
      link.send({ t: "hello", v: PROTOCOL_VERSION });
      this.sound.playCheckpoint();
      const def = LEVELS[level];
      this.screens.lobby(
        "PARTNER CONNECTED",
        `${def.name.toUpperCase()} · ${def.subtitle.toUpperCase()} · ${DIFFICULTIES[difficulty].name.toUpperCase()}`,
        "Start when you're both ready.",
        [
          {
            label: "Start",
            primary: true,
            action: () => {
              link.send({ t: "start", level, difficulty, fresh: true });
              this.startCoopRun(level, difficulty);
            },
          },
          { label: "Cancel", action: () => this.showCoopMenu() },
        ],
        code
      );
    };
    return code;
  }

  private showJoin(error = "", typed = ""): void {
    this.screens.joinForm(
      (input) => this.joinGame(input),
      () => this.showCoopMenu(),
      error,
      typed
    );
  }

  private joinGame(input: string): void {
    const code = normalizeRoomCode(input);
    if (!code) return this.showJoin("Room codes are 5 letters and numbers.", input);
    const link = this.openLink("guest", code);
    this.screens.lobby("JOINING", `ROOM ${code}`, "Connecting to your partner…", [{ label: "Cancel", action: () => this.showCoopMenu() }]);
    link.onOpen = () => {
      link.send({ t: "hello", v: PROTOCOL_VERSION });
      this.sound.playCheckpoint();
      this.screens.lobby("CONNECTED", `ROOM ${code}`, "Waiting for the host to start the game…", [
        { label: "Leave", action: () => this.showCoopMenu() },
      ]);
    };
  }

  private openLink(role: "host" | "guest", code: string): PeerLink {
    this.endCoop();
    const link = new PeerLink(role, code, this.signalUrl);
    this.link = link;
    link.onMessage = (m) => {
      if (this.link === link) this.onNet(m as NetMsg);
    };
    link.onClose = (reason) => {
      if (this.link === link) this.onLinkClosed(link, reason);
    };
    link.start();
    return link;
  }

  /** Hangs up (if connected). Safe to call any time. */
  private endCoop(): void {
    const link = this.link;
    this.link = null;
    link?.close("left");
  }

  private onLinkClosed(link: PeerLink, reason: string): void {
    this.link = null;
    const text = CLOSE_REASONS[reason] ?? CLOSE_REASONS.lost;
    const playing = this.run?.coop && this.state !== "menu" && this.state !== "title";
    if (!playing) {
      this.screens.lobby("CO-OP", "NOT CONNECTED", text, [{ label: "Back", primary: true, action: () => this.showCoopMenu() }]);
      return;
    }
    // The host carries on alone (the session notices the partner is gone).
    if (link.role === "host") {
      if (this.state === "dead" || this.state === "levelComplete") this.hud.toast("YOUR PARTNER LEFT", "var(--ui-red)");
      return;
    }
    // The guest's world was the host's: it can't go on.
    this.leaveGameplay();
    this.hud.setVisible(false);
    this.music.setMode("silent");
    this.state = "menu";
    this.screens.lobby("CONNECTION LOST", "CO-OP", text, [{ label: "Main Menu", primary: true, action: () => this.showMainMenu() }]);
  }

  private onNet(m: NetMsg): void {
    switch (m.t) {
      case "hello":
        if (m.v !== PROTOCOL_VERSION) this.link?.close("version");
        return;
      case "start":
        if (!this.isGuest) return;
        if (m.fresh || !this.run) this.startCoopRun(m.level, m.difficulty);
        else {
          this.run.levelIndex = m.level;
          this.run.checkpoint = null;
          this.startLevel(true);
        }
        return;
      case "restart":
        if (!this.isGuest || !this.run) return;
        if (!m.checkpoint) this.run.checkpoint = null;
        this.startLevel();
        return;
      default:
        this.session?.receive(m as SessionMsg);
    }
  }

  private startCoopRun(level: number, difficulty: DifficultyId): void {
    const def = DIFFICULTIES[difficulty];
    const loadout = startingLoadout(
      def,
      LEVELS.map((l) => l.id),
      level
    );
    this.run = { difficulty: def, levelIndex: level, loadout, stats: freshStats(), checkpoint: null, coop: true };
    this.startLevel(true);
  }

  /** Host, after a wipe: both of you go again. */
  private coopRetryItems(): MenuItem[] {
    const run = this.run!;
    const retry = (checkpoint: boolean) => () => {
      if (!checkpoint) run.checkpoint = null;
      this.link?.send({ t: "restart", checkpoint });
      this.startLevel();
    };
    return [
      { label: run.checkpoint ? "Retry from Checkpoint" : "Retry Level", primary: true, action: retry(!!run.checkpoint) },
      ...(run.checkpoint ? [{ label: "Restart Level", action: retry(false) }] : []),
      { label: "Leave Game", action: () => this.showMainMenu() },
    ];
  }

  /** Guest: the host picks what happens next. */
  private waitForHost(): MenuItem[] {
    return [
      { label: "Waiting for the host…", disabled: true, action: () => {} },
      { label: "Leave Game", action: () => this.showMainMenu() },
    ];
  }

  // ------------------------------------------------------------------ loop

  private readonly loop = (): void => {
    const dt = this.clock.tick();
    this.input.pollGamepad();
    this.handlePadMenus(dt);
    this.step(dt);
    this.music.update(dt, this.state === "playing" ? (this.session?.threat ?? 0) : 0);
    this.input.endFrame();
    this.engine.render();
    requestAnimationFrame(this.loop);
  };

  private readCommand(dt: number): PlayerCommand {
    const active = this.input.locked || this.debug || this.input.usingPad;
    const cmd = buildCommand(
      this.input,
      this.settings.bindings,
      active
        ? {
            radiansPerPixel: BASE_LOOK_SPEED * this.settings.sensitivity,
            padRadiansPerSecond: BASE_PAD_LOOK_SPEED * this.settings.padSensitivity,
            invertY: this.settings.invertY,
          }
        : null,
      dt
    );
    // The click that re-captures the mouse must not also fire the gun.
    if (!active) cmd.fire = false;
    if (this.scriptedFire) cmd.fire = true;
    this.scriptedFire = false;
    return cmd;
  }

  /** Gamepad: Menu pauses and resumes; in menus the d-pad or stick moves, A picks, B goes back. */
  private handlePadMenus(dt: number): void {
    const i = this.input;
    if (this.state === "playing") {
      if (i.padPressed(PAD.START)) this.pause();
      return;
    }
    if (this.state === "paused" && i.padPressed(PAD.START)) {
      this.resume();
      return;
    }
    const y = i.padAxis(1);
    const x = i.padAxis(0);
    const vertical = i.padDown(PAD.UP) || y < -0.5 ? -1 : i.padDown(PAD.DOWN) || y > 0.5 ? 1 : 0;
    const horizontal = i.padDown(PAD.LEFT) || x < -0.5 ? -1 : i.padDown(PAD.RIGHT) || x > 0.5 ? 1 : 0;
    const dir = vertical !== 0 ? vertical * 2 : horizontal;
    if (dir === 0) {
      this.navHeld = 0;
    } else if (dir !== this.navHeld) {
      this.navHeld = dir;
      this.navTimer = NAV_DELAY;
      this.padNavigate(dir);
    } else {
      this.navTimer -= dt;
      if (this.navTimer <= 0) {
        this.navTimer = NAV_REPEAT;
        this.padNavigate(dir);
      }
    }
    if (i.padPressed(PAD.A)) this.screens.activate();
    else if (i.padPressed(PAD.B)) this.screens.back();
  }

  /** ±2 = up/down, ±1 = left/right. */
  private padNavigate(dir: number): void {
    if (Math.abs(dir) === 2) this.screens.navigate(dir > 0 ? 1 : -1);
    else this.screens.adjust(dir > 0 ? 1 : -1);
  }

  private step(dt: number): void {
    switch (this.state) {
      case "title":
      case "menu":
        this.backdrop?.update(dt);
        this.sound.updateAmbient(dt);
        break;
      case "playing":
        // Pointer lock can be refused (e.g. resuming too quickly after Esc) — tell the player to click.
        if (!this.input.locked && !this.debug && !this.input.usingPad) this.hud.prompt("CLICK TO RESUME", 0.25);
        this.session?.step(dt, this.readCommand(dt));
        break;
      case "dead":
        this.session?.stepDead(dt);
        break;
      case "paused":
        // Co-op keeps running under the pause menu (you just stand there).
        if (this.run?.coop) this.session?.step(dt, emptyCommand());
        else this.engine.setPostFx(0, 0, performance.now() / 1000);
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
  /** Advance the simulation at a fixed 30 Hz without rendering, holding the given key codes (and gamepad buttons). */
  debugSimulate(seconds: number, codes: string[] = [], padButtons: number[] | null = null): void {
    for (const c of codes) this.input.simulateDown(c, true);
    if (padButtons) this.input.simulatePad(padButtons);
    for (let t = 0; t < seconds; t += 1 / 30) {
      this.input.pollGamepad();
      this.handlePadMenus(1 / 30);
      this.step(1 / 30);
      this.music.update(1 / 30, this.state === "playing" ? (this.session?.threat ?? 0) : 0);
      this.input.endFrame();
    }
    for (const c of codes) this.input.simulateDown(c, false);
    if (padButtons) {
      this.input.simulatePad(null);
      this.input.pollGamepad();
    }
  }
  debugMusicLevel(): number {
    return this.music.level;
  }
  debugFire(): void {
    this.scriptedFire = true;
    this.step(1 / 30);
    this.input.endFrame();
  }
  debugState(): string {
    return this.state;
  }
  /** Leave a co-op game as if from the pause menu. */
  debugLeave(): void {
    this.showMainMenu();
  }
}
