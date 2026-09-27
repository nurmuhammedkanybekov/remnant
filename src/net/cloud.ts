import { parseSave, type SaveData, type SaveStore } from "../game/save";
import { readJson, writeJson } from "../core/storage";

/**
 * Cloud saves: sign in (Google) and your progress follows you to any
 * browser. Built on Firebase's free plan — its sign-in, and one small
 * document per player in its database — so there is no server to run.
 *
 * The local save stays the one the game plays from. Signing in (and every
 * start of the game while signed in) fetches the cloud copy and merges it in
 * (`mergeSaves`: progress is joined, the newest run wins); after that every
 * change is uploaded a moment later. Offline, or with cloud saves not set up
 * at all, the game simply keeps saving locally.
 */

export interface CloudUser {
  uid: string;
  name: string;
}

/** The service underneath (Firebase in the game, a fake in tests). */
export interface CloudBackend {
  /** Called with the signed-in user now and whenever it changes (null = signed out). */
  onUser(cb: (user: CloudUser | null) => void): void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** The stored save's JSON, or null if this player has none yet. */
  load(uid: string): Promise<string | null>;
  store(uid: string, json: string, savedAt: number): Promise<void>;
}

export type CloudStatus = "off" | "signed-out" | "connecting" | "syncing" | "synced" | "offline" | "error";

/** Uploads wait this long after a change, so a burst of changes is one write. */
const PUSH_DELAY_MS = 2500;
/** Remembers that this browser signed in, so the next visit reconnects without loading the SDK for everyone else. */
const FLAG_KEY = "remnant.cloud";

export class CloudSync {
  status: CloudStatus;
  user: CloudUser | null = null;
  /** Epoch ms of the last successful sync. */
  lastSynced = 0;
  /** What went wrong, for the screen. */
  problem = "";
  onStatus: (() => void) | null = null;
  /** The cloud copy changed what's saved here (a run from another device): menus should refresh. */
  onMerged: (() => void) | null = null;

  private backend: CloudBackend | null = null;
  private connecting: Promise<CloudBackend | null> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pushing = false;
  private pushAgain = false;
  private pulled = false;

  constructor(
    private readonly save: SaveStore,
    private readonly levelCount: number,
    /** Loads the backend; null when cloud saves aren't configured in this build. */
    private readonly factory: (() => Promise<CloudBackend>) | null
  ) {
    this.status = factory ? "signed-out" : "off";
    save.onChange = () => this.schedulePush();
  }

  get available(): boolean {
    return this.factory !== null;
  }

  /** At startup: reconnect if this browser was signed in last time. */
  start(): void {
    if (this.factory && readJson(FLAG_KEY) === true) void this.connect();
  }

  async signIn(): Promise<void> {
    const backend = await this.connect();
    if (!backend) return;
    // Set before signing in: a redirect sign-in reloads the page, and the next start must reconnect.
    writeJson(FLAG_KEY, true);
    this.setStatus("connecting");
    try {
      await backend.signIn();
    } catch (e) {
      this.fail(describe(e), this.user ? "synced" : "signed-out");
    }
  }

  async signOut(): Promise<void> {
    clearTimeout(this.pushTimer);
    writeJson(FLAG_KEY, false);
    await this.backend?.signOut().catch(() => undefined);
  }

  /** Fetch, merge, upload. */
  async syncNow(): Promise<void> {
    const backend = this.backend;
    const user = this.user;
    if (!backend || !user) return;
    this.setStatus("syncing");
    try {
      const json = await backend.load(user.uid);
      if (json) {
        let raw: unknown = null;
        try {
          raw = JSON.parse(json);
        } catch {
          // A damaged cloud copy is replaced by this one.
        }
        if (raw && this.save.merge(parseSave(raw, this.levelCount))) this.onMerged?.();
      }
      this.pulled = true;
      await this.push();
    } catch (e) {
      this.fail(describe(e), "offline");
    }
  }

  private connect(): Promise<CloudBackend | null> {
    if (!this.factory) return Promise.resolve(null);
    this.connecting ??= this.factory()
      .then((backend) => {
        this.backend = backend;
        backend.onUser((user) => {
          const was = this.user?.uid;
          this.user = user;
          this.problem = "";
          if (!user) {
            writeJson(FLAG_KEY, false);
            this.pulled = false;
            this.setStatus("signed-out");
            return;
          }
          writeJson(FLAG_KEY, true);
          if (user.uid !== was) void this.syncNow();
        });
        return backend;
      })
      .catch((e) => {
        this.connecting = null;
        this.fail(describe(e), "signed-out");
        return null;
      });
    return this.connecting;
  }

  private schedulePush(): void {
    // Never upload before the cloud copy has been merged in, or a fresh
    // device's empty save could overwrite a real one.
    if (!this.user || !this.pulled) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.push().catch((e) => this.fail(describe(e), "offline")), PUSH_DELAY_MS);
  }

  private async push(): Promise<void> {
    const backend = this.backend;
    const user = this.user;
    if (!backend || !user) return;
    if (this.pushing) {
      this.pushAgain = true;
      return;
    }
    this.pushing = true;
    this.setStatus("syncing");
    try {
      const data: SaveData = this.save.snapshot();
      await backend.store(user.uid, JSON.stringify(data), data.savedAt);
      this.lastSynced = Date.now();
      this.problem = "";
      this.setStatus("synced");
    } finally {
      this.pushing = false;
    }
    if (this.pushAgain) {
      this.pushAgain = false;
      await this.push();
    }
  }

  private fail(problem: string, status: CloudStatus): void {
    this.problem = problem;
    this.setStatus(status);
  }

  private setStatus(s: CloudStatus): void {
    this.status = s;
    this.onStatus?.();
  }
}

/** A short, human reason from whatever the SDK or network threw. */
function describe(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Sign-in was cancelled.";
  if (code === "auth/popup-blocked") return "The browser blocked the sign-in window. Allow pop-ups for this site and try again.";
  if (code === "auth/unauthorized-domain") return "This site isn't on the cloud project's list of authorised domains.";
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found")
    return "Google sign-in isn't switched on in the cloud project yet.";
  if (typeof code === "string" && code.startsWith("auth/") && code.includes("api-key"))
    return "Cloud saves are misconfigured on this site: the Firebase API key isn't valid.";
  if (code === "auth/internal-error") return "Couldn't reach the sign-in service. Check your connection and try again.";
  if (code === "auth/network-request-failed" || e instanceof TypeError)
    return "Couldn't reach the cloud. Your progress is still saved on this device.";
  const msg = (e as { message?: unknown })?.message;
  return typeof msg === "string" && msg ? msg.slice(0, 160) : "Something went wrong with the cloud save.";
}
