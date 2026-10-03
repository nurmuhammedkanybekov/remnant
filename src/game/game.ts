import { BUILD_ID } from "../net/build";
import { MusicDirector } from "../audio/music";
import { SoundManager, type VoicePlayer } from "../audio/soundManager";
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyDef, type DifficultyId } from "../content/difficulty";
import { cloneBindings, DEFAULT_BINDINGS, keyLabel, type Action } from "../core/actions";
import { ENDINGS, PROLOGUE, TRANSMISSIONS, type EndingId } from "../content/story";
import { PAD, padLabel } from "../core/gamepad";
import { QUALITY, QUALITY_ORDER } from "../core/quality";
import { QualityGuard } from "../core/qualityGuard";
import { Clock } from "../core/clock";
import { Engine } from "../core/engine";
import { Input } from "../core/input";
import { SaveStore } from "./save";
import { loadSettings, saveSettings, type Settings } from "../core/settings";
import type { Enemy } from "../enemies/enemy";
import { hasRelay, relayState } from "../net/ice";
import { CloudSync } from "../net/cloud";
import { VoiceChat } from "../net/voice";
import { boardKey, Leaderboard, ranking, type BoardMode } from "../net/leaderboard";
import { firebaseBackend, firebaseConfig } from "../net/firebaseBackend";
import { describeClose, PeerLink, type Role } from "../net/link";
import { makeRoomCode, MAX_GUESTS, normalizeRoomCode, PROTOCOL_VERSION, RELAYED, type NetMsg } from "../net/protocol";
import { buildCommand, emptyCommand, type PlayerCommand } from "../player/command";
import { fullName, LOOKS, personalise, setCharacter } from "../content/characters";
import { MAX_MEDKITS, MAX_THROWABLES } from "../content/items";
import { WEAPON_ORDER, WEAPONS } from "../content/weapons";
import { MAX_BATTERY } from "../player/flashlight";
import { Hud, speakerName } from "../ui/hud";
import type { InventoryView } from "../ui/inventory";
import { Screens, type MenuItem } from "../ui/menu";
import { Viewmodel } from "../weapons/viewmodel";
import { LEVELS } from "../world/levels";
import type { CheckpointState } from "./checkpoint";
import { LevelSession, type CoopLink, type SessionServices } from "./levelSession";
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
  private readonly cloud: CloudSync;
  private readonly board: Leaderboard;
  /** Which board the leaderboard screen shows. */
  private boardView: { difficulty: DifficultyId; mode: BoardMode } = { difficulty: "normal", mode: "solo" };
  private boardToken = 0;
  /** A one-off line for the saves screen ("Save file loaded."). */
  private savesNote = "";
  private readonly debug = new URLSearchParams(location.search).has("debug");

  private state: GameState = "title";
  private navHeld = 0;
  private navTimer = 0;
  private run: Run | null = null;
  private session: LevelSession | null = null;
  private backdrop: MenuBackdrop | null = null;
  /** Debug harness: fire on the next simulated frame. */
  private scriptedFire = false;
  /** "Use Medkit" was picked in the inventory: heal on the next frame of play. */
  private pendingHeal = false;
  private inventoryOpen = false;
  /** Co-op: host or guest, while in a co-op game or lobby. */
  private coopRole: Role | null = null;
  /** Co-op: open connections by player slot. A host has one per guest (1, 2); a guest has the host's (0). */
  private readonly links = new Map<number, PeerLink>();
  /** Co-op host: the room open for the next guest, until the game starts or it's full. */
  private room: PeerLink | null = null;
  private roomCode = "";
  /** Co-op: this player's slot (0 the host, 1 or 2 a guest). */
  private mySlot = 0;
  /** Co-op: how many players the current level was started for. */
  private coopPlayers = 2;
  /** Co-op host: how each guest is connected ("directly", "through the relay"), for the lobby. */
  private readonly routes = new Map<number, string>();
  /** Co-op voice: your microphone. */
  private readonly voice: VoiceChat;
  /** Co-op voice: the other players' voices, by slot. */
  private readonly remoteVoices = new Map<number, VoicePlayer>();
  /** Bumped whenever the co-op menu is shown or left, so a late relay check can't redraw another screen. */
  private coopMenuToken = 0;
  /** Co-op: which level attempt this is (see `start` in net/protocol.ts). */
  private epoch = 0;
  /** Co-op host: what the room is for, to reopen it under a new code if the old one was taken. */
  private hosting: { level: number; difficulty: DifficultyId; tries: number } | null = null;
  /** Co-op: keeps the world running while this tab is in the background (browsers stop animation frames there). */
  private backgroundTicker: Worker | null = null;
  /** Matchmaking server; `?signal=wss://…` points at a self-hosted one. */
  private readonly signalUrl = new URLSearchParams(location.search).get("signal");

  constructor(container: HTMLElement) {
    this.container = container;
    const fb = firebaseConfig();
    this.cloud = new CloudSync(this.save, LEVELS.length, fb ? () => firebaseBackend(fb) : null);
    this.cloud.onStatus = () => {
      if (this.screens?.showing("saves")) this.showSaves();
      if (this.screens?.showing("leaderboard")) this.showLeaderboard();
    };
    this.board = new Leaderboard(this.cloud);
    this.cloud.onSignedIn = () => void this.board.upload();
    // A run or unlocks arrived from another device: show them.
    this.cloud.onMerged = () => {
      if (this.state === "menu" && this.screens.showing("main-menu")) this.showMainMenu();
    };
    this.engine = new Engine(container);
    this.engine.setFov(this.settings.fov);
    this.engine.setQuality(QUALITY[this.settings.quality]);
    this.input = new Input(this.engine.domElement);
    this.hud = new Hud(container);
    this.voice = new VoiceChat(this.sound);
    this.voice.mode = this.settings.voice;
    const voice = this.voice;
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
      noteRead: (key) => this.save.noteRead(key),
      look: () => this.settings.look,
      voice: {
        update: (dt, talk) => this.voice.update(dt, talk),
        get speaking() {
          return voice.speaking;
        },
        get open() {
          return voice.open;
        },
        place: (slot, sp) => this.remoteVoices.get(slot)?.place(sp),
      },
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
    document.addEventListener("visibilitychange", () => this.onVisibilityChange());
    // A graphics driver reset (or the GPU being taken away) ends WebGL for this page.
    this.engine.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.input.exitLock();
      this.screens.lobby(
        "GRAPHICS RESET",
        "THE GRAPHICS DRIVER STOPPED RESPONDING",
        "Your progress is saved at the start of each level and at checkpoints.\nReload the page to carry on.",
        [{ label: "Reload", primary: true, action: () => location.reload() }]
      );
      this.state = "menu";
    });

    // The world behind the title and menus.
    this.backdrop = new MenuBackdrop(this.engine, QUALITY[this.settings.quality]);
    document.getElementById("boot")?.remove();
    this.showTitle();
    this.cloud.start();
    requestAnimationFrame(this.loop);
  }

  /** Settings that change how the HUD and camera behave. */
  private applyDisplaySettings(): void {
    this.engine.setBrightness(this.settings.brightness);
    setCharacter(this.settings.look);
    this.viewmodel.setSkin(LOOKS[this.settings.look].skin);
    this.hud.applyDisplay(this.settings.hudScale, this.settings.subtitleSize);
    this.container.classList.toggle("cb", this.settings.colorBlind);
    this.session?.applySettings();
  }

  // ------------------------------------------------------------------ menus

  /** Loading is done; wait for a key, which is also what lets the browser start audio. */
  private showTitle(): void {
    this.state = "title";
    // Phones and tablets: say so up front rather than leave them stuck at the first corridor.
    const touchOnly = matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
    const prompt = this.input.usingPad ? "PRESS A" : touchOnly ? "NEEDS A KEYBOARD AND MOUSE, OR A GAMEPAD" : "PRESS ANY KEY";
    this.screens.title(prompt, () => {
      this.sound.init();
      this.sound.setPaused(false);
      this.music.setMode("silent");
      if (this.settings.calibrated) this.showMainMenu();
      else this.showCalibration(() => this.showMainMenu());
    });
  }

  /** First launch: the brightness screen, before anything else. */
  private showCalibration(done: () => void): void {
    this.screens.calibrate(
      this.settings.brightness,
      (v) => {
        this.settings.brightness = v;
        this.engine.setBrightness(v);
      },
      () => {
        this.settings.calibrated = true;
        saveSettings(this.settings);
        done();
      }
    );
  }

  private showMainMenu(): void {
    this.coopMenuToken++;
    this.endCoop();
    this.state = "menu";
    this.music.setMode("silent");
    // Behind the menu: only the building, very quietly.
    this.sound.setRoomTone(0.07, 0);
    this.hud.setVisible(false);
    this.hud.hideTransient();
    this.viewmodel.setVisible(false);
    this.sound.setPaused(false);
    // The maintenance wing's long lamp-lit corridor makes the best establishing shot.
    if (this.session || !this.backdrop) this.backdrop = new MenuBackdrop(this.engine, QUALITY[this.settings.quality]);
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
      { label: "Co-op", detail: "Two or three players, online", action: () => this.showCoopMenu() },
      {
        label: "Saves",
        detail: this.cloud.user ? `Cloud: ${this.cloud.user.name}` : this.cloud.available ? "Cloud sync, save files" : "Save files",
        action: () => {
          this.savesNote = "";
          this.showSaves();
        },
      },
      {
        label: "Leaderboard",
        detail: this.cloud.available ? "Best times of everyone signed in" : "Needs cloud saves",
        disabled: !this.cloud.available,
        action: () => this.showLeaderboard(),
      },
      { label: "Settings", action: () => this.showSettings(() => this.showMainMenu()) },
      { label: "Controls", action: () => this.showControls(() => this.showMainMenu()) },
      { label: "Exit", detail: "Back to the title screen", action: () => this.exitToTitle() }
    );
    const reached = this.save.progress.unlockedLevel;
    this.screens.main(
      items,
      __APP_VERSION__,
      LEVELS.map((def, i) => ({ name: def.name, subtitle: def.subtitle, reached: i <= reached })),
      personalise(TRANSMISSIONS[Math.floor(Math.random() * TRANSMISSIONS.length)])
    );
  }

  /** The online leaderboard, for one difficulty and mode at a time. */
  private showLeaderboard(): void {
    const v = this.boardView;
    const token = ++this.boardToken;
    const tag = `${DIFFICULTIES[v.difficulty].name.toUpperCase()} · ${v.mode === "solo" ? "SOLO" : "CO-OP"}`;
    const cycle = (dir: 1 | -1) => {
      const i = DIFFICULTY_ORDER.indexOf(v.difficulty);
      v.difficulty = DIFFICULTY_ORDER[(i + dir + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length];
      this.showLeaderboard();
    };
    const controls: MenuItem[] = [
      { label: "Difficulty", detail: DIFFICULTIES[v.difficulty].name, action: () => cycle(1) },
      {
        label: "Mode",
        detail: v.mode === "solo" ? "Solo" : "Co-op",
        action: () => {
          v.mode = v.mode === "solo" ? "coop" : "solo";
          this.showLeaderboard();
        },
      },
    ];
    const back: MenuItem = { label: "Back", action: () => this.showMainMenu() };
    if (!this.cloud.user) {
      this.screens.leaderboard(
        "NOT SIGNED IN",
        null,
        "Sign in with Google to see everyone's best times and put yours up. Times you set before signing in are kept and uploaded then.",
        [
          {
            label: "Sign In with Google",
            primary: true,
            disabled: this.cloud.status === "connecting",
            action: () => void this.cloud.signIn(),
          },
          back,
        ]
      );
      return;
    }
    this.screens.leaderboard(tag, null, "Loading…", [...controls, back]);
    void this.board
      .entries()
      .then((entries) => {
        if (token !== this.boardToken || !this.screens.showing("leaderboard")) return;
        const me = this.cloud.user?.uid;
        const rows = LEVELS.map((def) => {
          const ranked = ranking(entries, boardKey(def.id, v.difficulty, v.mode));
          const at = ranked.findIndex((r) => r.uid === me);
          const own = this.board.best(boardKey(def.id, v.difficulty, v.mode));
          return {
            level: `${def.name} · ${def.subtitle}`,
            top: ranked.slice(0, 3).map((r) => ({ name: r.name, time: r.time, me: r.uid === me })),
            mine:
              at >= 0
                ? { time: ranked[at].time, rank: at + 1 }
                : own !== undefined
                  ? { time: own, rank: ranked.filter((r) => r.time < own).length + 1 }
                  : null,
          };
        });
        const players = entries.length;
        this.screens.leaderboard(
          tag,
          rows,
          `${players} ${players === 1 ? "player" : "players"} on the board. A level's time counts from its start to the exit, deaths not included.`,
          [...controls, { label: "Refresh", action: () => void this.board.entries(true).then(() => this.showLeaderboard()) }, back]
        );
      })
      .catch((e: unknown) => {
        if (token !== this.boardToken || !this.screens.showing("leaderboard")) return;
        this.screens.leaderboard(tag, null, e instanceof Error ? e.message : "The leaderboard can't be reached right now.", [
          ...controls,
          back,
        ]);
      });
  }

  /** Cloud sign-in and sync, and exporting / importing a save file. */
  private showSaves(): void {
    const c = this.cloud;
    const lines: string[] = [];
    const items: MenuItem[] = [];
    let tag = "ON THIS DEVICE";
    if (!c.available) {
      lines.push("Your progress is saved in this browser. To move it to another computer, export a save file and import it there.");
    } else if (!c.user) {
      tag = c.status === "connecting" ? "SIGNING IN…" : "NOT SIGNED IN";
      lines.push(
        "Sign in to keep your progress in the cloud and carry on from any computer. Your progress is saved in this browser either way."
      );
      items.push({ label: "Sign In with Google", primary: true, disabled: c.status === "connecting", action: () => void c.signIn() });
    } else {
      tag = `SIGNED IN · ${c.user.name.toUpperCase()}`;
      lines.push(
        c.status === "syncing"
          ? "Syncing…"
          : c.status === "synced"
            ? `Saved to the cloud at ${new Date(c.lastSynced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Every change uploads by itself.`
            : "Not synced yet. Your progress is safe in this browser and uploads when the cloud is reachable."
      );
      items.push(
        { label: "Sync Now", primary: true, disabled: c.status === "syncing", action: () => void c.syncNow() },
        { label: "Sign Out", detail: "Progress stays on this device", action: () => void c.signOut() }
      );
    }
    if (c.problem) lines.push(c.problem);
    if (this.savesNote) lines.push(this.savesNote);
    items.push(
      { label: "Export Save File", detail: "Download your progress", action: () => this.exportSave() },
      { label: "Import Save File", detail: "Load progress from a file", action: () => this.importSave() },
      { label: "Back", action: () => this.showMainMenu() }
    );
    this.screens.saves(tag, lines.join("\n\n"), items);
  }

  private exportSave(): void {
    const url = URL.createObjectURL(new Blob([this.save.exportJson()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `remnant-save-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.savesNote = "Save file downloaded.";
    this.showSaves();
  }

  private importSave(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = file.size < 1_000_000 ? await file.text().catch(() => "") : "";
      this.savesNote = this.save.importJson(text)
        ? "Save file loaded: its run is now yours to continue, and its progress is added to yours."
        : "That file isn't a REMNANT save.";
      if (this.screens.showing("saves")) this.showSaves();
    };
    input.click();
  }

  /** Leave the menus for the silent title screen (a browser tab can't close itself). Progress is already saved. */
  private exitToTitle(): void {
    this.coopMenuToken++;
    this.endCoop();
    this.music.setMode("silent");
    this.sound.silence();
    this.showTitle();
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
      (id) => this.showCharacter(id, levelIndex),
      () => this.showMainMenu(),
      this.save.progress.completed
    );
  }

  /** New game: who you play, then the prologue (or the chosen chapter). */
  private showCharacter(difficulty: DifficultyId, levelIndex: number): void {
    this.screens.character(
      this.settings.look,
      (look) => {
        this.settings.look = look;
        saveSettings(this.settings);
        this.applyDisplaySettings();
        if (levelIndex === 0) this.showPrologue(difficulty);
        else this.startCampaign(difficulty, levelIndex);
      },
      () => this.showDifficulty(levelIndex)
    );
  }

  private showPrologue(difficulty: DifficultyId): void {
    this.screens.story(
      PROLOGUE.title,
      PROLOGUE.lines.map((l) => personalise(l)),
      [{ label: "Begin", primary: true, action: () => this.startCampaign(difficulty, 0) }]
    );
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
        if (this.voice.mode !== s.voice) {
          this.voice.mode = s.voice;
          if (s.voice === "off") this.voice.stop();
          if (this.coopRole) void this.startVoice();
        }
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

  /** The inventory: gear, the journal of notes, the radio log. Pauses the game offline; online the world keeps going. */
  private openInventory(): void {
    if (!this.run || !this.session) return;
    this.state = "paused";
    this.inventoryOpen = true;
    if (!this.run.coop) this.sound.setPaused(true);
    this.input.exitLock();
    this.screens.inventory(() => this.inventoryView(), {
      onClose: () => this.resume(),
      onHeal: () => {
        this.pendingHeal = true;
        this.resume();
      },
      closeCodes: this.settings.bindings.inventory.filter((c): c is string => c !== null),
    });
  }

  private inventoryView(): InventoryView {
    const s = this.session!;
    const loadout = s.loadout;
    const byId = new Map(LEVELS.map((d) => [d.id, d]));
    const notes = this.save.progress.notes.flatMap((key) => {
      const [levelId, ch] = key.split(":");
      const def = byId.get(levelId);
      const text = def?.notes[ch];
      return def && text
        ? [{ place: `${def.name} · ${def.subtitle}`, text: personalise(text), fresh: s.notesFound.has(key), order: LEVELS.indexOf(def) }]
        : [];
    });
    // Newest level first, so this level's notes are at the top.
    notes.sort((a, b) => b.order - a.order);
    return {
      place: `${s.def.name} · ${s.def.subtitle}`,
      objective: s.objectiveText,
      difficulty: this.run!.difficulty.name,
      health: loadout.health,
      maxHealth: s.player.health.max,
      battery: loadout.battery,
      maxBattery: MAX_BATTERY,
      medkits: loadout.medkits,
      maxMedkits: MAX_MEDKITS,
      throwables: loadout.throwables,
      maxThrowables: MAX_THROWABLES,
      keycard: s.hasKeycard,
      weapons: WEAPON_ORDER.map((id) => {
        const w = WEAPONS[id];
        const a = loadout.weapons[id];
        return {
          name: w.name,
          slot: w.slot,
          owned: !!a,
          inHand: loadout.current === id,
          mag: a?.mag ?? 0,
          magSize: w.magSize,
          reserve: a?.reserve ?? 0,
          reserveMax: w.reserveMax,
        };
      }),
      notes,
      radio: [...s.radioLog].reverse().map((l) => ({ who: speakerName(l.speaker), speaker: l.speaker, text: l.text })),
      healKey: this.services.keyFor("heal"),
      throwKey: this.services.keyFor("throw"),
      closeKey: this.services.keyFor("inventory"),
      live: this.run!.coop,
    };
  }

  private resume(): void {
    this.inventoryOpen = false;
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
    this.startLevel(false, true);
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
  private startLevel(card = false, retry = false): void {
    const run = this.run;
    if (!run) return;
    this.sound.init();
    this.persistRun();

    this.backdrop = null;
    this.engine.setBars(false);
    this.qualityGuard.reset();
    this.screens.hide();
    this.hud.hideTransient();
    const session = new LevelSession(
      this.services,
      LEVELS[run.levelIndex],
      run.difficulty,
      run.loadout,
      run.checkpoint,
      run.coop ? this.sessionLink() : null,
      retry
    );
    session.onDeath = () => this.onDeath();
    if (run.coop) this.wireVoices();
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
    this.inventoryOpen = false;
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
        this.screens.death(stats, this.isGuest ? this.waitForHost() : this.coopRetryItems(), null);
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
              {
                label: run.checkpoint ? "Retry from Checkpoint" : "Retry Level",
                primary: true,
                action: () => this.startLevel(false, true),
              },
              ...(run.checkpoint ? [{ label: "Restart Level", action: () => this.restartLevelFresh() }] : []),
              { label: "Quit to Menu", action: () => this.showMainMenu() },
            ],
        runOver ? run.difficulty.name : null
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
    this.board.record(session.def.id, run.difficulty.id, run.coop ? "coop" : "solo", session.stats.time);
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
                this.hostBegins({ t: "start", level: run.levelIndex, difficulty: run.difficulty.id, fresh: false });
                this.startLevel(true);
              },
            },
            { label: "Leave Game", action: () => this.showMainMenu() },
          ];
    this.screens.levelComplete(session.def.name, session.def.subtitle, session.stats, newBest, next);
  }

  // ------------------------------------------------------------------ co-op

  private get isGuest(): boolean {
    return this.coopRole === "guest";
  }

  /** The level session's view of the connections: its messages are stamped with this attempt's number. */
  private sessionLink(): CoopLink | null {
    const role = this.coopRole;
    if (!role) return null;
    const ep = this.epoch;
    const links = this.links;
    return {
      role,
      slot: this.mySlot,
      players: this.coopPlayers,
      get connected() {
        return [...links.values()].some((l) => l.open);
      },
      send: (m, fast) => {
        for (const l of links.values()) l.send({ ...m, ep }, fast);
      },
      sendTo: (slot, m) => links.get(slot)?.send({ ...m, ep }),
    };
  }

  /** Host: start a level attempt for everyone (a new run, the next level or a retry). Nobody new joins after this. */
  private hostBegins(
    msg: { t: "start"; level: number; difficulty: DifficultyId; fresh: boolean } | { t: "restart"; checkpoint: boolean }
  ): void {
    this.closeRoom();
    this.epoch++;
    this.coopPlayers = 1 + this.links.size;
    const players = this.coopPlayers;
    for (const [slot, l] of this.links)
      l.send(msg.t === "start" ? { ...msg, ep: this.epoch, slot, players } : { ...msg, ep: this.epoch, players });
  }

  private showCoopMenu(): void {
    this.endCoop();
    this.state = "menu";
    const token = ++this.coopMenuToken;
    const show = (relay: string) =>
      this.screens.lobby(
        "CO-OP",
        "TWO OR THREE PLAYERS · ONLINE",
        "One of you hosts and picks the sublevel; the others join with the host's room code.\nYou leave each sublevel together — and when one of you goes down, the others have 45 seconds to get them back up.\n" +
          relay +
          ` · build ${BUILD_ID}`,
        [
          { label: "Host a Game", primary: true, action: () => this.showCoopChapters() },
          { label: "Join a Game", action: () => this.showJoin() },
          {
            label: `Playing as ${fullName(this.settings.look)}`,
            detail: "Change character",
            action: () =>
              this.screens.character(
                this.settings.look,
                (look) => {
                  this.settings.look = look;
                  saveSettings(this.settings);
                  this.applyDisplaySettings();
                  this.showCoopMenu();
                },
                () => this.showCoopMenu()
              ),
          },
          { label: "Back", action: () => this.showMainMenu() },
        ]
      );
    if (!hasRelay()) return show("Relay: off — strict school or office networks may not connect.");
    show("Relay: checking…");
    // Ask the relay now, so a wrong key shows up here rather than as a failed game later.
    void relayState().then((r) => {
      if (token !== this.coopMenuToken || this.state !== "menu") return;
      show(
        r === "ready"
          ? "Relay: on — works even on strict networks."
          : r === "rejected"
            ? "Relay: key refused — use the API key shown next to a TURN credential in the Metered dashboard."
            : "Relay: unreachable right now — direct connections still work."
      );
    });
  }

  private showCoopChapters(): void {
    this.coopMenuToken++;
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

  /** Opens a room and waits for partners. Returns the room code. */
  private hostGame(level: number, difficulty: DifficultyId, tries = 0, note = ""): string {
    this.endCoop();
    this.coopMenuToken++;
    this.coopRole = "host";
    this.mySlot = 0;
    this.hosting = { level, difficulty, tries };
    this.roomCode = makeRoomCode();
    this.openRoom();
    this.showHostLobby(note);
    return this.roomCode;
  }

  /**
   * Host: listens for the next guest under the room code. Each guest gets a
   * connection of their own; once one is in, the room opens again (same
   * code) for another, until there are two or the game starts.
   */
  private openRoom(attempt = 0): void {
    if (this.coopRole !== "host" || this.room || this.links.size >= MAX_GUESTS || this.run) return;
    const code = this.roomCode;
    const link = new PeerLink("host", code, this.signalUrl);
    this.room = link;
    let joining = false;
    let slot = 0;
    link.onJoinFailed = () => {
      joining = false;
      this.showHostLobby(`Someone tried to join but couldn't get through.\n${describeClose("timeout")}\nThe room is still open.\n`);
    };
    link.onJoining = () => {
      joining = true;
      this.showHostLobby("", "setting up");
    };
    link.onStatus = (step) => {
      if (link.open || this.room !== link) return;
      // Before anyone knocks, only show trouble with the room itself (e.g. matchmaking dropping).
      if (joining) this.showHostLobby("", step);
      else if (step !== "room open, waiting" && this.links.size === 0) this.showHostLobby(`(${step})\n`);
    };
    link.onOpen = () => {
      if (this.room !== link) return;
      this.room = null;
      slot = [1, 2].find((s) => !this.links.has(s)) ?? 1;
      this.links.set(slot, link);
      link.send({ t: "hello", v: PROTOCOL_VERSION, app: __APP_VERSION__ });
      this.sound.playCheckpoint();
      link.onVoice = () => this.wireVoices();
      void this.startVoice();
      this.showHostLobby();
      void this.describeRoute(link).then((route) => {
        if (this.links.get(slot) !== link) return;
        this.routes.set(slot, route);
        if (this.state === "menu" && !this.run && this.screens.showing("host-lobby")) this.showHostLobby();
      });
      // Room for one more: open the door again (a moment later, once the code is free).
      window.setTimeout(() => this.openRoom(), 1200);
    };
    link.onMessage = (m) => {
      if (this.links.get(slot) === link) this.onHostNet(m as NetMsg, slot, link);
    };
    link.onClose = (reason) => {
      if (this.room === link) {
        // The room itself failed (nobody was in it through this connection).
        this.room = null;
        const h = this.hosting;
        if (this.links.size === 0) {
          // Someone else's room has this code: quietly open ours under another.
          if (reason === "id-taken" && h && h.tries < 3 && !this.run) this.hostGame(h.level, h.difficulty, h.tries + 1);
          else if (reason !== "left") this.showCoopError(link, reason);
          return;
        }
        // A room for a third player: try again a couple of times (the code may still be settling).
        if (reason !== "left" && attempt < 3) window.setTimeout(() => this.openRoom(attempt + 1), 2000);
        return;
      }
      if (this.links.get(slot) === link) this.guestLeft(slot, reason);
    };
    link.start();
  }

  private closeRoom(): void {
    const room = this.room;
    this.room = null;
    room?.close("left");
  }

  /** Host: the lobby, with the room code, who's in, and Start once someone is. */
  private showHostLobby(note = "", step = ""): void {
    if (this.coopRole !== "host" || this.run) return;
    const h = this.hosting;
    const guests = this.links.size;
    const def = h ? LEVELS[h.level] : null;
    const lines: string[] = [];
    if (note) lines.push(note.trimEnd());
    if (guests === 0) {
      lines.push(step ? `A partner is connecting…\n(${step})` : "Send this code to your partners.\nWaiting for them to join…");
    } else {
      const who = [...this.links.keys()].sort().map((s) => `Player ${s + 1}: ${this.routes.get(s) ?? "connected."}`);
      lines.push(`${guests + 1} of ${MAX_GUESTS + 1} players in the room.`, ...who);
      if (step) lines.push(`Another player is connecting… (${step})`);
      else if (guests < MAX_GUESTS) lines.push("A third player can still join with the same code.");
      lines.push("Start when you're all ready.");
    }
    lines.push(`(build ${BUILD_ID})`);
    this.screens.lobby(
      guests > 0 ? `${guests + 1} PLAYERS` : "HOST",
      def && h
        ? `${def.name.toUpperCase()} · ${def.subtitle.toUpperCase()} · ${DIFFICULTIES[h.difficulty].name.toUpperCase()}`
        : "ROOM CODE",
      lines.join("\n"),
      [
        {
          label: "Start",
          primary: guests > 0,
          disabled: guests === 0,
          action: () => {
            // A double click must not start two games.
            if (this.run || this.links.size === 0 || !h) return;
            this.hostBegins({ t: "start", level: h.level, difficulty: h.difficulty, fresh: true });
            this.startCoopRun(h.level, h.difficulty);
          },
        },
        { label: "Cancel", action: () => this.showCoopMenu() },
      ],
      this.roomCode,
      "host-lobby"
    );
  }

  /** Host: a guest's connection ended. */
  private guestLeft(slot: number, reason: string): void {
    this.links.delete(slot);
    this.routes.delete(slot);
    this.wireVoices();
    const playing = this.run?.coop && this.state !== "menu" && this.state !== "title";
    if (!playing) {
      // Still in the lobby: keep the room open for whoever comes next.
      if (this.coopRole === "host" && !this.run) {
        this.openRoom();
        this.showHostLobby(reason === "version" ? `${describeClose("version")}\n` : "A player left. The room is still open.\n");
      }
      return;
    }
    // The game goes on without them.
    this.session?.partnerLeft(slot);
    this.hud.toast(this.links.size > 0 ? "A PLAYER LEFT" : "YOUR PARTNER LEFT", "var(--ui-red)");
  }

  /** "Connected directly" or "through the relay", for the lobby. */
  private async describeRoute(link: PeerLink): Promise<string> {
    // The selected route is known a moment after the channel opens.
    await new Promise((r) => setTimeout(r, 400));
    const route = await link.route();
    return route === "relay" ? "Connected through the relay." : route === "direct" ? "Connected directly." : "Connected.";
  }

  private showJoin(error = "", typed = ""): void {
    this.coopMenuToken++;
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
    this.endCoop();
    this.coopRole = "guest";
    this.mySlot = 1;
    const link = new PeerLink("guest", code, this.signalUrl);
    this.links.set(0, link);
    link.onMessage = (m) => {
      if (this.links.get(0) === link) this.onGuestNet(m as NetMsg, link);
    };
    link.onClose = (reason) => {
      if (this.links.get(0) === link) this.onHostLost(link, reason);
    };
    const showStep = (step: string) =>
      this.screens.lobby("JOINING", `ROOM ${code}`, `Connecting to the host…\n(${step})`, [
        { label: "Cancel", action: () => this.showCoopMenu() },
      ]);
    showStep("finding the room");
    link.onStatus = (step) => {
      if (!link.open && this.links.get(0) === link) showStep(step);
    };
    link.onVoice = () => this.wireVoices();
    link.onOpen = async () => {
      link.send({ t: "hello", v: PROTOCOL_VERSION, app: __APP_VERSION__ });
      this.sound.playCheckpoint();
      void this.startVoice();
      const show = (route: string) =>
        this.screens.lobby("CONNECTED", `ROOM ${code}`, `${route}\nWaiting for the host to start the game…`, [
          { label: "Leave", action: () => this.showCoopMenu() },
        ]);
      show("Connected.");
      const route = await this.describeRoute(link);
      // Only if nothing has moved on (the host may have started already).
      if (this.links.get(0) === link && this.state === "menu" && !this.run) show(route);
    };
    link.start();
  }

  /** Hangs up everything (if connected). Safe to call any time. */
  private endCoop(): void {
    this.closeRoom();
    const links = [...this.links.values()];
    this.links.clear();
    this.routes.clear();
    this.coopRole = null;
    for (const l of links) l.close("left");
    this.voice.stop();
    this.wireVoices();
  }

  /** Co-op: asks for the microphone (once) and puts it on the connections. */
  private async startVoice(): Promise<void> {
    if (this.voice.mode === "off") return this.wireVoices();
    const had = this.voice.denied;
    await this.voice.start();
    if (this.voice.denied && !had) this.hud.toast("NO MICROPHONE — VOICE CHAT IS OFF", "var(--ui-red)");
    this.wireVoices();
  }

  /**
   * Co-op voice routing. Your microphone goes out on every connection's
   * "direct" channel. A guest hears the host on "direct" and the other guest
   * on "relay"; the host hears each guest on their own connection, and
   * passes each guest's voice on to the other on "relay".
   */
  private wireVoices(): void {
    // The track itself goes silent when you're not talking (see `VoiceChat`).
    const mic = this.voice.mode !== "off" ? this.voice.track : null;
    const heard = new Map<number, MediaStreamTrack>();
    if (this.coopRole === "host") {
      for (const [slot, link] of this.links) {
        const t = link.voices.get("direct");
        if (t) heard.set(slot, t);
      }
      for (const [slot, link] of this.links) {
        link.setVoice("direct", mic);
        const other = [...heard].find(([s]) => s !== slot)?.[1] ?? null;
        link.setVoice("relay", other);
      }
    } else if (this.coopRole === "guest") {
      const link = this.links.get(0);
      if (link) {
        link.setVoice("direct", mic);
        const host = link.voices.get("direct");
        const other = link.voices.get("relay");
        if (host) heard.set(0, host);
        if (other && this.coopPlayers > 2) heard.set(this.mySlot === 1 ? 2 : 1, other);
      }
    }
    // Players for new voices, and goodbye to the ones that left.
    for (const [slot, player] of this.remoteVoices)
      if (heard.get(slot) !== player.track) {
        player.dispose();
        this.remoteVoices.delete(slot);
      }
    for (const [slot, track] of heard) {
      if (this.remoteVoices.has(slot)) continue;
      const player = this.sound.voice(track);
      if (player) this.remoteVoices.set(slot, player);
    }
  }

  /** A connection problem outside a game: say what happened. */
  private showCoopError(link: PeerLink, reason: string): void {
    // For failed connections, add how far it got — a screenshot of this pins the problem down.
    const text =
      describeClose(reason) +
      (["timeout", "no-answer", "lost", "closed"].includes(reason)
        ? `\n\nWhat happened (build ${BUILD_ID}):\n${link.log.slice(-5).join("\n")}`
        : "");
    this.endCoop();
    this.screens.lobby("CO-OP", "NOT CONNECTED", text, [{ label: "Back", primary: true, action: () => this.showCoopMenu() }]);
  }

  /** Guest: the connection to the host ended. The world was the host's, so it can't go on. */
  private onHostLost(link: PeerLink, reason: string): void {
    const playing = this.run?.coop && this.state !== "menu" && this.state !== "title";
    if (!playing) return this.showCoopError(link, reason);
    const text = describeClose(reason);
    this.endCoop();
    this.leaveGameplay();
    this.hud.setVisible(false);
    this.music.setMode("silent");
    this.state = "menu";
    this.screens.lobby("CONNECTION LOST", "CO-OP", text, [{ label: "Main Menu", primary: true, action: () => this.showMainMenu() }]);
  }

  /** Host: a message from the guest in `slot`. What the other guest needs is passed on to them. */
  private onHostNet(m: NetMsg, slot: number, link: PeerLink): void {
    if (m.t === "hello") {
      if (m.v !== PROTOCOL_VERSION || m.app !== __APP_VERSION__) link.close("version");
      return;
    }
    if (m.t === "start" || m.t === "restart") return;
    // Only messages for the level attempt in progress.
    if (m.ep !== this.epoch) return;
    this.session?.receive(m, slot);
    if (RELAYED.has(m.t)) for (const [s, l] of this.links) if (s !== slot) l.send({ ...m, from: slot }, m.t === "ps");
  }

  /** Guest: a message from the host (or, relayed by the host, from the other guest). */
  private onGuestNet(m: NetMsg, link: PeerLink): void {
    switch (m.t) {
      case "hello":
        if (m.v !== PROTOCOL_VERSION || m.app !== __APP_VERSION__) link.close("version");
        return;
      case "start":
        this.epoch = m.ep;
        this.mySlot = m.slot ?? 1;
        this.coopPlayers = m.players ?? 2;
        this.wireVoices();
        if (m.fresh || !this.run) this.startCoopRun(m.level, m.difficulty);
        else {
          this.run.levelIndex = m.level;
          this.run.checkpoint = null;
          this.startLevel(true);
        }
        return;
      case "restart":
        if (!this.run) return;
        this.epoch = m.ep;
        this.coopPlayers = m.players ?? this.coopPlayers;
        if (!m.checkpoint) this.run.checkpoint = null;
        this.startLevel(false, true);
        return;
      default:
        if (m.ep === this.epoch) this.session?.receive(m, m.from ?? 0);
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
      this.hostBegins({ t: "restart", checkpoint });
      this.startLevel(false, true);
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
    this.frame(true);
    requestAnimationFrame(this.loop);
  };

  /**
   * The game is running slowly on this machine: take the graphics down a
   * step (and say so), rather than let it stutter. Shadows and occlusion go
   * first; Low keeps the game smooth on almost anything.
   */
  private lowerQuality(): void {
    const i = QUALITY_ORDER.indexOf(this.settings.quality);
    if (i <= 0) return;
    this.settings.quality = QUALITY_ORDER[i - 1];
    saveSettings(this.settings);
    this.engine.setQuality(QUALITY[this.settings.quality]);
    this.hud.prompt(`GRAPHICS SET TO ${QUALITY[this.settings.quality].name.toUpperCase()} TO KEEP IT SMOOTH — CHANGE IT IN SETTINGS`, 4);
  }

  private readonly qualityGuard = new QualityGuard();

  /** One tick of the game; `render` is false for background ticks (nobody's looking). */
  private frame(render: boolean): void {
    const dt = this.clock.tick();
    this.input.pollGamepad();
    this.handlePadMenus(dt);
    this.step(dt);
    this.music.update(dt, this.state === "playing" ? (this.session?.threat ?? 0) : 0);
    this.input.endFrame();
    if (render) this.engine.render();
    if (render && this.state === "playing" && this.settings.autoQuality && !this.debug && this.qualityGuard.frame(dt)) this.lowerQuality();
  }

  /**
   * Browsers stop animation frames in a background tab. In co-op that would
   * freeze the world for the other player too (the host runs it), so while
   * hidden a worker's timer (which browsers don't throttle as hard) keeps
   * the game ticking 20 times a second, without drawing.
   */
  private onVisibilityChange(): void {
    const hidden = document.hidden && this.links.size > 0;
    if (hidden && !this.backgroundTicker) {
      try {
        const src = "setInterval(() => postMessage(0), 50);";
        const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
        worker.onmessage = () => {
          if (document.hidden) this.frame(false);
        };
        this.backgroundTicker = worker;
      } catch {
        // No workers (or blocked): the world pauses while hidden, as before.
      }
    } else if (!hidden && this.backgroundTicker) {
      this.backgroundTicker.terminate();
      this.backgroundTicker = null;
      this.clock.tick(); // don't count the time away as one giant frame
    }
  }

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
    if (this.pendingHeal) cmd.heal = true;
    this.pendingHeal = false;
    return cmd;
  }

  /** Gamepad: Menu pauses and resumes; in menus the d-pad or stick moves, A picks, B goes back. */
  private handlePadMenus(dt: number): void {
    const i = this.input;
    if (this.state === "playing") {
      if (i.padPressed(PAD.START)) this.pause();
      return;
    }
    if (this.state === "paused" && (i.padPressed(PAD.START) || (this.inventoryOpen && i.padPressed(PAD.BACK)))) {
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
        {
          const cmd = this.readCommand(dt);
          if (cmd.inventory) this.openInventory();
          else this.session?.step(dt, cmd);
        }
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
