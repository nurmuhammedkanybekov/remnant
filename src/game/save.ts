import { isDifficultyId, type DifficultyId } from "../content/difficulty";
import type { Loadout } from "./loadout";
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
}

export interface CampaignSave {
  difficulty: DifficultyId;
  levelIndex: number;
  /** The loadout the player enters `levelIndex` with. */
  loadout: Loadout;
  /** Totals for the levels already finished in this run. */
  stats: RunStats;
  /** Epoch milliseconds. */
  updatedAt: number;
}

export interface Progress {
  /** Highest level index ever reached; chapter select offers 0..this. */
  unlockedLevel: number;
  /** Difficulties the campaign has been finished on. */
  completed: DifficultyId[];
  /** Fastest clear per level id, in seconds. */
  bestTimes: Record<string, number>;
}

export const SAVE_VERSION = 1;
const KEY = "remnant.save";

export function emptySave(): SaveData {
  return { version: SAVE_VERSION, campaign: null, progress: { unlockedLevel: 0, completed: [], bestTimes: {} } };
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
  const root = obj(raw);
  if (!root || root.version !== SAVE_VERSION) return save;

  const p = obj(root.progress);
  if (p) {
    save.progress.unlockedLevel = Math.min(levelCount - 1, Math.max(0, Math.floor(num(p.unlockedLevel))));
    if (Array.isArray(p.completed)) save.progress.completed = [...new Set(p.completed.filter(isDifficultyId))];
    const bt = obj(p.bestTimes);
    if (bt) {
      for (const [id, t] of Object.entries(bt)) if (typeof t === "number" && t > 0) save.progress.bestTimes[id] = t;
    }
  }

  const c = obj(root.campaign);
  const loadout = obj(c?.loadout);
  if (c && loadout && isDifficultyId(c.difficulty)) {
    const levelIndex = Math.floor(num(c.levelIndex, -1));
    if (levelIndex >= 0 && levelIndex < levelCount) {
      const stats = { ...freshStats() };
      const s = obj(c.stats);
      if (s) for (const k of Object.keys(stats) as (keyof RunStats)[]) stats[k] = Math.max(0, num(s[k]));
      save.campaign = {
        difficulty: c.difficulty,
        levelIndex,
        loadout: {
          health: Math.min(100, Math.max(1, num(loadout.health, 100))),
          battery: Math.min(100, Math.max(0, num(loadout.battery, 100))),
          mag: Math.max(0, Math.floor(num(loadout.mag))),
          reserve: Math.max(0, Math.floor(num(loadout.reserve))),
        },
        stats,
        updatedAt: num(c.updatedAt, Date.now()),
      };
      save.progress.unlockedLevel = Math.max(save.progress.unlockedLevel, levelIndex);
    }
  }
  return save;
}

/** Load/save wrapper the game talks to. Every mutation is written through immediately. */
export class SaveStore {
  private data: SaveData;

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
    this.data.campaign = { ...campaign, stats: { ...campaign.stats }, loadout: { ...campaign.loadout }, updatedAt: Date.now() };
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

  completeCampaign(difficulty: DifficultyId): void {
    if (!this.data.progress.completed.includes(difficulty)) this.data.progress.completed.push(difficulty);
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

  private write(): void {
    writeJson(KEY, this.data);
  }
}
