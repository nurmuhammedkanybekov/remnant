import { isDifficultyId, type DifficultyId } from "../content/difficulty";
import type { EndingId } from "../content/story";
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
  /** Difficulties the campaign has been finished on. */
  completed: DifficultyId[];
  /** Fastest clear per level id, in seconds. */
  bestTimes: Record<string, number>;
  /** Endings the player has seen. */
  endings: EndingId[];
}

export const SAVE_VERSION = 3;
const KEY = "remnant.save";

export function emptySave(): SaveData {
  return { version: SAVE_VERSION, campaign: null, progress: { unlockedLevel: 0, completed: [], bestTimes: {}, endings: [] } };
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
    if (Array.isArray(p.endings))
      save.progress.endings = [...new Set(p.endings.filter((e): e is EndingId => e === "seal" || e === "leave"))];
    const bt = obj(p.bestTimes);
    if (bt) {
      for (const [id, t] of Object.entries(bt)) if (typeof t === "number" && t > 0) save.progress.bestTimes[id] = t;
    }
  }

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

  completeCampaign(difficulty: DifficultyId, ending: EndingId): void {
    if (!this.data.progress.completed.includes(difficulty)) this.data.progress.completed.push(difficulty);
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

  private write(): void {
    writeJson(KEY, this.data);
  }
}
