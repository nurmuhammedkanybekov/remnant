import { isDifficultyId, type DifficultyId } from "../content/difficulty";
import { isEndingId, type EndingId } from "../content/story";
import { parseCheckpoint, type CheckpointState } from "./checkpoint";
import { cloneLoadout, parseLoadout, upgradeLegacyLoadout, type Loadout } from "./loadout";
import { freshStats, type RunStats } from "./stats";
import { readJson, removeKey, writeJson } from "../core/storage";

/**
 * Persistent progress. Saved to localStorage under a single key with an
 * explicit schema version, so future versions can migrate old saves instead
 * of discarding them.
 */
export interface SaveData {
  version: typeof SAVE_VERSION;
  /** The run in progress, checkpointed at the start of each level. */
  campaign: CampaignSave | null;
  progress: Progress;
  /** When this save last changed (epoch ms; 0 = never). Decides whose run wins when two copies are merged. */
  savedAt: number;
}

export interface CampaignSave {
  difficulty: DifficultyId;
  levelIndex: number;
  /** The loadout the player enters `levelIndex` with. */
  loadout: Loadout;
  /** Totals for the levels already finished in this run. */
  stats: RunStats;
  /** Mid-level progress in `levelIndex`, if a checkpoint was reached. */
  checkpoint: CheckpointState | null;
  /** Epoch milliseconds. */
  updatedAt: number;
}

export interface Progress {
  /** Highest level index ever reached; chapter select offers 0..this. */
  unlockedLevel: number;
  /** Difficulties Part One has been finished on. */
  completed: DifficultyId[];
  /** Difficulties Part Two has been finished on. */
  completedTwo: DifficultyId[];
  /** Fastest clear per level id, in seconds. */
  bestTimes: Record<string, number>;
  /** Endings the player has seen. */
  endings: EndingId[];
  /** Notes ever picked up ("infirmary:1"), in the order found: the journal. */
  notes: string[];
}

export const SAVE_VERSION = 3;
const KEY = "remnant.save";

export function emptySave(): SaveData {
  return {
    version: SAVE_VERSION,
    campaign: null,
    progress: { unlockedLevel: 0, completed: [], completedTwo: [], bestTimes: {}, endings: [], notes: [] },
    savedAt: 0,
  };
}

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Turns anything read from storage into a valid SaveData. Corrupt fields fall
 * back to defaults rather than throwing — a bad save must never brick the game.
 */
export function parseSave(raw: unknown, levelCount: number): SaveData {
  const save = emptySave();
  const root = migrate(obj(raw));
  if (!root) return save;

  const p = obj(root.progress);
  if (p) {
    save.progress.unlockedLevel = Math.min(levelCount - 1, Math.max(0, Math.floor(num(p.unlockedLevel))));
    if (Array.isArray(p.completed)) save.progress.completed = [...new Set(p.completed.filter(isDifficultyId))];
    if (Array.isArray(p.completedTwo)) save.progress.completedTwo = [...new Set(p.completedTwo.filter(isDifficultyId))];
    if (Array.isArray(p.endings)) save.progress.endings = [...new Set(p.endings.filter(isEndingId))];
    if (Array.isArray(p.notes))
      save.progress.notes = [
        ...new Set(p.notes.filter((n): n is string => typeof n === "string" && n.length < 80 && n.includes(":"))),
      ].slice(0, 500);
    const bt = obj(p.bestTimes);
    if (bt) {
      for (const [id, t] of Object.entries(bt)) if (typeof t === "number" && t > 0) save.progress.bestTimes[id] = t;
    }
  }

  save.savedAt = Math.max(0, num(root.savedAt, 0));
  const c = obj(root.campaign);
  const loadout = parseLoadout(c?.loadout);
  if (c && loadout && isDifficultyId(c.difficulty)) {
    const levelIndex = Math.floor(num(c.levelIndex, -1));
    if (levelIndex >= 0 && levelIndex < levelCount) {
      const stats = { ...freshStats() };
      const s = obj(c.stats);
      if (s) for (const k of Object.keys(stats) as (keyof RunStats)[]) stats[k] = Math.max(0, num(s[k]));
      save.campaign = {
        difficulty: c.difficulty,
        levelIndex,
        loadout,
        stats,
        checkpoint: parseCheckpoint(c.checkpoint),
        updatedAt: num(c.updatedAt, Date.now()),
      };
      save.progress.unlockedLevel = Math.max(save.progress.unlockedLevel, levelIndex);
    }
  }
  return save;
}

/**
 * Combines two copies of a save (this device's and the cloud's, or an
 * imported file). Progress is never lost: unlocks, finished difficulties,
 * endings and journal notes are joined, and each level keeps its best time.
 * The run in progress comes from whichever copy changed last — including
 * "no run", when the newer copy finished or lost it.
 */
export function mergeSaves(a: SaveData, b: SaveData): SaveData {
  const newer = b.savedAt > a.savedAt ? b : a;
  const union = <T>(x: readonly T[], y: readonly T[]) => [...new Set([...x, ...y])];
  const bestTimes = { ...a.progress.bestTimes };
  for (const [id, t] of Object.entries(b.progress.bestTimes)) if (bestTimes[id] === undefined || t < bestTimes[id]) bestTimes[id] = t;
  return {
    version: SAVE_VERSION,
    campaign: newer.campaign ? structuredClone(newer.campaign) : null,
    progress: {
      unlockedLevel: Math.max(a.progress.unlockedLevel, b.progress.unlockedLevel),
      completed: union(a.progress.completed, b.progress.completed),
      completedTwo: union(a.progress.completedTwo, b.progress.completedTwo),
      bestTimes,
      endings: union(a.progress.endings, b.progress.endings),
      notes: union(a.progress.notes, b.progress.notes),
    },
    savedAt: Math.max(a.savedAt, b.savedAt),
  };
}

/**
 * Brings an older save up to SAVE_VERSION, one version at a time.
 * Returns null for anything unrecognisable.
 */
function migrate(root: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!root) return null;
  let data = root;
  if (data.version === 1) data = migrateV1(data);
  if (data.version === 2) data = migrateV2(data);
  return data.version === SAVE_VERSION ? data : null;
}

/**
 * v1 → v2: the campaign grew from 2 levels to 10. A new level was inserted
 * first, and the two original levels were renamed, so indices shift by one.
 */
function migrateV1(v1: Record<string, unknown>): Record<string, unknown> {
  const renamed: Record<string, string> = { "sublevel-3": "maintenance-wing", "sublevel-2": "cold-storage" };
  const p = obj(v1.progress) ?? {};
  const c = obj(v1.campaign);
  const bestTimes = Object.fromEntries(Object.entries(obj(p.bestTimes) ?? {}).map(([id, t]) => [renamed[id] ?? id, t]));
  return {
    version: 2,
    progress: { ...p, unlockedLevel: num(p.unlockedLevel) + 1, bestTimes, endings: [] },
    campaign: c ? { ...c, levelIndex: num(c.levelIndex) + 1, checkpoint: null } : null,
  };
}

/**
 * v2 → v3: weapons and a medkit inventory. The single pistol loadout
 * (`mag` + `reserve`) becomes one entry in `weapons`. Mid-level checkpoints
 * are dropped (the run resumes at the start of its level).
 */
function migrateV2(v2: Record<string, unknown>): Record<string, unknown> {
  const c = obj(v2.campaign);
  if (!c) return { ...v2, version: 3 };
  return {
    ...v2,
    version: 3,
    campaign: {
      ...c,
      loadout: upgradeLegacyLoadout(c.loadout),
      // Creatures and pickups changed on most levels, so an old mid-level
      // checkpoint's indices no longer line up: restart the level instead.
      checkpoint: null,
    },
  };
}

/** Load/save wrapper the game talks to. Every mutation is written through immediately. */
export class SaveStore {
  private data: SaveData;
  /** After every change (the cloud sync listens). */
  onChange: ((data: SaveData) => void) | null = null;

  constructor(private readonly levelCount: number) {
    this.data = parseSave(readJson(KEY), levelCount);
  }

  get campaign(): Readonly<CampaignSave> | null {
    return this.data.campaign;
  }

  get progress(): Readonly<Progress> {
    return this.data.progress;
  }

  /** Checkpoint: the player is entering `campaign.levelIndex` with `campaign.loadout`. */
  checkpoint(campaign: Omit<CampaignSave, "updatedAt">): void {
    this.data.campaign = {
      ...campaign,
      stats: { ...campaign.stats },
      loadout: cloneLoadout(campaign.loadout),
      checkpoint: campaign.checkpoint ? structuredClone(campaign.checkpoint) : null,
      updatedAt: Date.now(),
    };
    this.data.progress.unlockedLevel = Math.max(this.data.progress.unlockedLevel, campaign.levelIndex);
    this.write();
  }

  recordLevelTime(levelId: string, seconds: number): boolean {
    const best = this.data.progress.bestTimes[levelId];
    if (best !== undefined && best <= seconds) return false;
    this.data.progress.bestTimes[levelId] = seconds;
    this.write();
    return true;
  }

  /** Adds a note to the journal. */
  noteRead(key: string): void {
    if (this.data.progress.notes.includes(key)) return;
    this.data.progress.notes.push(key);
    this.write();
  }

  /** A part of the campaign was finished: remember the difficulty and the ending, and close the run. */
  completeCampaign(difficulty: DifficultyId, ending: EndingId, part: 1 | 2 = 1): void {
    const list = part === 1 ? this.data.progress.completed : this.data.progress.completedTwo;
    if (!list.includes(difficulty)) list.push(difficulty);
    if (!this.data.progress.endings.includes(ending)) this.data.progress.endings.push(ending);
    this.data.campaign = null;
    this.write();
  }

  clearCampaign(): void {
    this.data.campaign = null;
    this.write();
  }

  /** Wipes everything (settings are stored separately and survive). */
  reset(): void {
    this.data = emptySave();
    removeKey(KEY);
  }

  /** A copy of everything, for uploading or exporting. */
  snapshot(): SaveData {
    return structuredClone(this.data);
  }

  /**
   * Folds another copy of the save into this one (see `mergeSaves`) and keeps
   * the result. Returns true if anything changed here.
   */
  merge(other: SaveData): boolean {
    const merged = mergeSaves(this.data, other);
    if (JSON.stringify(merged) === JSON.stringify(this.data)) return false;
    this.data = merged;
    writeJson(KEY, this.data);
    return true;
  }

  /** The save as a file's contents. */
  exportJson(): string {
    return JSON.stringify({ ...this.data, game: "REMNANT" }, null, 1);
  }

  /**
   * Reads a save file and merges it in, the file's run taking over. Returns
   * false if it isn't a REMNANT save.
   */
  importJson(text: string): boolean {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return false;
    }
    if (!raw || typeof raw !== "object" || (raw as { game?: unknown }).game !== "REMNANT") return false;
    const incoming = parseSave(raw, this.levelCount);
    incoming.savedAt = Date.now();
    this.merge(incoming);
    this.onChange?.(this.snapshot());
    return true;
  }

  private write(): void {
    this.data.savedAt = Date.now();
    writeJson(KEY, this.data);
    this.onChange?.(this.snapshot());
  }
}
