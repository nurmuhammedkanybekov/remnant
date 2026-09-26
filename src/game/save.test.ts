import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySave, parseSave, SaveStore, SAVE_VERSION } from "./save";
import { freshStats } from "./stats";

const LEVELS = 3;
const campaign = {
  difficulty: "normal" as const,
  levelIndex: 1,
  loadout: { health: 80, battery: 50, medkits: 1, weapons: { pistol: { mag: 8, reserve: 16 } }, current: "pistol" as const },
  stats: { ...freshStats(), kills: 3 },
  checkpoint: null,
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
      progress: { unlockedLevel: 1, completed: ["story"], bestTimes: { a: 12 }, endings: ["seal"] },
    };
    expect(parseSave(JSON.parse(JSON.stringify(data)), LEVELS)).toEqual(data);
  });

  it("repairs out-of-range values instead of failing", () => {
    const s = parseSave(
      {
        version: SAVE_VERSION,
        campaign: { ...campaign, loadout: { health: 500, battery: -3, medkits: 1, weapons: { pistol: { mag: 2.7, reserve: "lots" } } } },
        progress: { unlockedLevel: 99, completed: ["normal", "normal", "godmode"], bestTimes: { a: -1, b: 30 } },
      },
      LEVELS
    );
    expect(s.campaign!.loadout).toEqual({
      health: 100,
      battery: 0,
      medkits: 1,
      weapons: { pistol: { mag: 2, reserve: 0 } },
      current: "pistol",
    });
    expect(s.progress.unlockedLevel).toBe(LEVELS - 1);
    expect(s.progress.completed).toEqual(["normal"]);
    expect(s.progress.bestTimes).toEqual({ b: 30 });
  });

  it("migrates a v1 save: levels shifted by one, ids renamed", () => {
    const v1 = {
      version: 1,
      campaign: { ...campaign, loadout: { health: 80, battery: 50, mag: 8, reserve: 16 }, levelIndex: 1, checkpoint: undefined },
      progress: { unlockedLevel: 1, completed: [], bestTimes: { "sublevel-3": 90, "sublevel-2": 120 } },
    };
    const s = parseSave(v1, 10);
    expect(s.campaign!.levelIndex).toBe(2);
    expect(s.campaign!.checkpoint).toBeNull();
    expect(s.progress.unlockedLevel).toBe(2);
    expect(s.progress.bestTimes).toEqual({ "maintenance-wing": 90, "cold-storage": 120 });
    expect(s.campaign!.loadout.weapons.pistol).toEqual({ mag: 8, reserve: 16 });
  });

  it("migrates a v2 save: the pistol loadout moves into weapons, the mid-level checkpoint is dropped", () => {
    const v2 = {
      version: 2,
      campaign: {
        ...campaign,
        loadout: { health: 70, battery: 40, mag: 5, reserve: 20 },
        checkpoint: { x: 1, z: 2, yaw: 0, loadout: { health: 70, battery: 40, mag: 5, reserve: 20 }, objective: "Go." },
      },
      progress: { unlockedLevel: 4, completed: [], bestTimes: {}, endings: [] },
    };
    const s = parseSave(v2, 10);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.campaign!.loadout).toEqual({
      health: 70,
      battery: 40,
      medkits: 0,
      weapons: { pistol: { mag: 5, reserve: 20 } },
      current: "pistol",
    });
    expect(s.campaign!.checkpoint).toBeNull();
    expect(s.progress.unlockedLevel).toBe(4);
  });

  it("keeps a valid mid-level checkpoint and drops a broken one", () => {
    const cp = {
      x: 5,
      z: 6,
      yaw: 1,
      loadout: campaign.loadout,
      stats: freshStats(),
      collected: [0, 2, -1, 1.5],
      killed: [1],
      doorsOpen: [],
      generatorsOn: [],
      intercomsUsed: [],
      markersReached: [0],
      firedTriggers: ["a", 3],
      hasKeycard: true,
      objective: "Go.",
    };
    const ok = parseSave({ version: SAVE_VERSION, campaign: { ...campaign, checkpoint: cp } }, LEVELS);
    expect(ok.campaign!.checkpoint).toMatchObject({ x: 5, collected: [0, 2], firedTriggers: ["a"], hasKeycard: true });
    const broken = parseSave({ version: SAVE_VERSION, campaign: { ...campaign, checkpoint: { x: "nope" } } }, LEVELS);
    expect(broken.campaign!.checkpoint).toBeNull();
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
    s.completeCampaign("nightmare", "leave");
    expect(new SaveStore(LEVELS).campaign).toBeNull();
    expect(new SaveStore(LEVELS).progress.completed).toEqual(["nightmare"]);
    expect(new SaveStore(LEVELS).progress.endings).toEqual(["leave"]);
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
