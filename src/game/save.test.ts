import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySave, parseSave, SaveStore, SAVE_VERSION } from "./save";
import { freshStats } from "./stats";

const LEVELS = 3;
const campaign = {
  difficulty: "normal" as const,
  levelIndex: 1,
  loadout: { health: 80, battery: 50, mag: 8, reserve: 16 },
  stats: { ...freshStats(), kills: 3 },
};

describe("parseSave", () => {
  it("returns an empty save for garbage or a different version", () => {
    expect(parseSave(null, LEVELS)).toEqual(emptySave());
    expect(parseSave("x", LEVELS)).toEqual(emptySave());
    expect(parseSave({ version: 999, campaign }, LEVELS)).toEqual(emptySave());
  });

  it("round-trips a valid save", () => {
    const data = {
      version: SAVE_VERSION,
      campaign: { ...campaign, updatedAt: 5 },
      progress: { unlockedLevel: 1, completed: ["story"], bestTimes: { a: 12 } },
    };
    expect(parseSave(JSON.parse(JSON.stringify(data)), LEVELS)).toEqual(data);
  });

  it("repairs out-of-range values instead of failing", () => {
    const s = parseSave(
      {
        version: SAVE_VERSION,
        campaign: { ...campaign, loadout: { health: 500, battery: -3, mag: 2.7, reserve: "lots" } },
        progress: { unlockedLevel: 99, completed: ["normal", "normal", "godmode"], bestTimes: { a: -1, b: 30 } },
      },
      LEVELS
    );
    expect(s.campaign!.loadout).toEqual({ health: 100, battery: 0, mag: 2, reserve: 0 });
    expect(s.progress.unlockedLevel).toBe(LEVELS - 1);
    expect(s.progress.completed).toEqual(["normal"]);
    expect(s.progress.bestTimes).toEqual({ b: 30 });
  });

  it("drops a campaign that points past the last level", () => {
    const s = parseSave({ version: SAVE_VERSION, campaign: { ...campaign, levelIndex: 7 } }, LEVELS);
    expect(s.campaign).toBeNull();
  });
});

describe("SaveStore", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("persists checkpoints across instances and unlocks chapters", () => {
    new SaveStore(LEVELS).checkpoint(campaign);
    const reloaded = new SaveStore(LEVELS);
    expect(reloaded.campaign).toMatchObject(campaign);
    expect(reloaded.progress.unlockedLevel).toBe(1);
  });

  it("only records improved level times", () => {
    const s = new SaveStore(LEVELS);
    expect(s.recordLevelTime("a", 60)).toBe(true);
    expect(s.recordLevelTime("a", 70)).toBe(false);
    expect(s.recordLevelTime("a", 50)).toBe(true);
    expect(s.progress.bestTimes.a).toBe(50);
  });

  it("finishing the campaign clears the run and remembers the difficulty", () => {
    const s = new SaveStore(LEVELS);
    s.checkpoint(campaign);
    s.completeCampaign("nightmare");
    expect(new SaveStore(LEVELS).campaign).toBeNull();
    expect(new SaveStore(LEVELS).progress.completed).toEqual(["nightmare"]);
  });

  it("keeps working when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    const s = new SaveStore(LEVELS);
    expect(() => s.checkpoint(campaign)).not.toThrow();
    expect(s.campaign).toMatchObject(campaign);
  });
});
