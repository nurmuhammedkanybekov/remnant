import type { DifficultyId } from "../content/difficulty";
import { readJson, writeJson } from "../core/storage";
import type { CloudSync } from "./cloud";

/**
 * The online leaderboard: every signed-in player's best time on each level,
 * per difficulty, solo and co-op. Each player has one small document
 * (`leaderboard/{uid}` in the same free Firebase database as the saves)
 * holding their name and their times; the board screen reads them all and
 * ranks them. Among friends, so there's no anti-cheat beyond the database
 * rules (you can only write your own document).
 *
 * Your own bests are also kept in this browser, so times set before you
 * signed in (or while offline) are uploaded the next time you're online.
 */

export type BoardMode = "solo" | "coop";

export interface BoardEntry {
  uid: string;
  name: string;
  /** Seconds, by `boardKey`. */
  times: Record<string, number>;
}

/** What the database side has to offer (the Firebase backend implements it; tests fake it). */
export interface BoardBackend {
  /** Everyone's entries. */
  list(): Promise<BoardEntry[]>;
  /** Sets these times (and the name) on this player's entry, leaving the others as they are. */
  put(uid: string, name: string, times: Record<string, number>): Promise<void>;
}

/** Field-safe key for a level, difficulty and mode: "cold_storage__nightmare__coop". */
export function boardKey(levelId: string, difficulty: DifficultyId, mode: BoardMode): string {
  return `${levelId.replace(/[^a-z0-9]/gi, "_")}__${difficulty}${mode === "coop" ? "__coop" : ""}`;
}

/** A level can't be cleared faster than this; anything quicker is a bug, not a record. */
const MIN_TIME = 5;
const LOCAL_KEY = "remnant.board";
/** The board is re-read at most this often. */
const CACHE_MS = 60_000;

/** The name shown on the board: the first name of the account, never an email address. */
export function boardName(accountName: string): string {
  const first = accountName.trim().split(/\s+/)[0] ?? "";
  if (!first || first.includes("@")) return "Survivor";
  return first.slice(0, 16);
}

/** Ranked times for one key: fastest first. */
export function ranking(entries: readonly BoardEntry[], key: string): { uid: string; name: string; time: number }[] {
  return entries
    .flatMap((e) => (Number.isFinite(e.times[key]) && e.times[key] >= MIN_TIME ? [{ uid: e.uid, name: e.name, time: e.times[key] }] : []))
    .sort((a, b) => a.time - b.time);
}

export class Leaderboard {
  private cache: { at: number; entries: BoardEntry[] } | null = null;
  /** Keys already uploaded at their current time this session. */
  private readonly sent = new Map<string, number>();
  private readonly local: Record<string, number>;

  constructor(
    private readonly cloud: CloudSync,
    private readonly now: () => number = Date.now
  ) {
    const raw = readJson(LOCAL_KEY);
    this.local = {};
    if (raw && typeof raw === "object")
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "number" && v >= MIN_TIME) this.local[k] = v;
  }

  /** Your own best for a key, from this browser. */
  best(key: string): number | undefined {
    return this.local[key];
  }

  /** A level was cleared: keep the time if it's your best, and upload it when signed in. */
  record(levelId: string, difficulty: DifficultyId, mode: BoardMode, seconds: number): boolean {
    if (!(seconds >= MIN_TIME)) return false;
    const key = boardKey(levelId, difficulty, mode);
    const prev = this.local[key];
    if (prev !== undefined && prev <= seconds) return false;
    this.local[key] = seconds;
    writeJson(LOCAL_KEY, this.local);
    void this.upload();
    return true;
  }

  /** Uploads every local best the board doesn't have yet. Quietly does nothing when signed out or offline. */
  async upload(): Promise<void> {
    const board = this.cloud.board;
    const user = this.cloud.user;
    if (!board || !user) return;
    const times: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.local)) if (this.sent.get(k) !== v) times[k] = v;
    if (Object.keys(times).length === 0) return;
    try {
      // Never replace a faster time already on the board (set from another device).
      const mine = this.cache?.entries.find((e) => e.uid === user.uid) ?? (await board.list()).find((e) => e.uid === user.uid);
      for (const k of Object.keys(times)) if (mine?.times[k] !== undefined && mine.times[k] <= times[k]) delete times[k];
      if (Object.keys(times).length > 0) await board.put(user.uid, boardName(user.name), times);
      for (const [k, v] of Object.entries(this.local)) this.sent.set(k, v);
      this.cache = null;
    } catch {
      // Offline or refused: the times stay in this browser and go up next time.
    }
  }

  /** Everyone's entries (cached for a minute). Throws when the board can't be read. */
  async entries(force = false): Promise<BoardEntry[]> {
    const board = this.cloud.board;
    if (!board || !this.cloud.user) throw new Error("Sign in to see the leaderboard.");
    if (!force && this.cache && this.now() - this.cache.at < CACHE_MS) return this.cache.entries;
    const entries = await board.list();
    this.cache = { at: this.now(), entries };
    return entries;
  }
}
