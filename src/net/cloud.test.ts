import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySave, SaveStore } from "../game/save";
import { freshStats } from "../game/stats";
import { CloudSync, type CloudBackend, type CloudUser } from "./cloud";

const LEVELS = 5;
const run = (levelIndex: number) => ({
  difficulty: "normal" as const,
  levelIndex,
  loadout: { health: 90, battery: 60, medkits: 1, weapons: { pistol: { mag: 8, reserve: 16 } }, current: "pistol" as const },
  stats: freshStats(),
  checkpoint: null,
});

/** A pretend cloud: one stored document per user. */
class FakeCloud implements CloudBackend {
  docs = new Map<string, string>();
  stores = 0;
  offline = false;
  private listener: ((u: CloudUser | null) => void) | null = null;
  onUser(cb: (u: CloudUser | null) => void): void {
    this.listener = cb;
    cb(null);
  }
  async signIn(): Promise<void> {
    this.listener?.({ uid: "u1", name: "Nur" });
  }
  async signOut(): Promise<void> {
    this.listener?.(null);
  }
  async load(uid: string): Promise<string | null> {
    if (this.offline) throw new TypeError("Failed to fetch");
    return this.docs.get(uid) ?? null;
  }
  async store(uid: string, json: string): Promise<void> {
    if (this.offline) throw new TypeError("Failed to fetch");
    this.stores++;
    this.docs.set(uid, json);
  }
}

describe("cloud saves", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const settle = async () => {
    await vi.runAllTimersAsync();
  };

  it("is off when not configured, and the game keeps saving locally", () => {
    const save = new SaveStore(LEVELS);
    const sync = new CloudSync(save, LEVELS, null);
    expect(sync.available).toBe(false);
    expect(sync.status).toBe("off");
    save.checkpoint(run(1));
    expect(new SaveStore(LEVELS).campaign?.levelIndex).toBe(1);
  });

  it("signing in on a new device brings the cloud's run and progress, and uploads the merge", async () => {
    const cloud = new FakeCloud();
    const other = { ...emptySave(), campaign: { ...run(3), updatedAt: 1 }, savedAt: Date.now() - 1000 };
    other.progress.unlockedLevel = 3;
    other.progress.notes = ["infirmary:1"];
    cloud.docs.set("u1", JSON.stringify(other));

    const save = new SaveStore(LEVELS);
    save.noteRead("infirmary:2"); // this device found a different note, earlier
    storage.set("remnant.save", JSON.stringify({ ...JSON.parse(storage.get("remnant.save")!), savedAt: 5 }));
    const local = new SaveStore(LEVELS);
    const sync = new CloudSync(local, LEVELS, async () => cloud);
    const merged = vi.fn();
    sync.onMerged = merged;
    await sync.signIn();
    await settle();

    expect(sync.status).toBe("synced");
    expect(sync.user?.name).toBe("Nur");
    expect(merged).toHaveBeenCalled();
    expect(local.campaign?.levelIndex).toBe(3);
    expect(local.progress.notes).toEqual(["infirmary:2", "infirmary:1"]);
    expect(JSON.parse(cloud.docs.get("u1")!).progress.notes).toEqual(["infirmary:2", "infirmary:1"]);
  });

  it("uploads each change once, a moment later, and not before the cloud copy was read", async () => {
    const cloud = new FakeCloud();
    const save = new SaveStore(LEVELS);
    const sync = new CloudSync(save, LEVELS, async () => cloud);
    save.checkpoint(run(1)); // signed out: nothing to upload to
    expect(cloud.stores).toBe(0);
    await sync.signIn();
    await settle();
    const after = cloud.stores;
    save.checkpoint(run(2));
    save.noteRead("a:1");
    save.recordLevelTime("x", 30);
    await settle();
    expect(cloud.stores).toBe(after + 1);
    expect(JSON.parse(cloud.docs.get("u1")!).campaign.levelIndex).toBe(2);
  });

  it("offline, it says so and keeps the progress locally; syncing later catches up", async () => {
    const cloud = new FakeCloud();
    const save = new SaveStore(LEVELS);
    const sync = new CloudSync(save, LEVELS, async () => cloud);
    cloud.offline = true;
    await sync.signIn();
    await settle();
    expect(sync.status).toBe("offline");
    expect(sync.problem).toMatch(/saved on this device/);
    save.checkpoint(run(4));
    expect(new SaveStore(LEVELS).campaign?.levelIndex).toBe(4);
    cloud.offline = false;
    await sync.syncNow();
    await settle();
    expect(sync.status).toBe("synced");
    expect(JSON.parse(cloud.docs.get("u1")!).campaign.levelIndex).toBe(4);
  });

  it("signing out stops uploads and forgets the sign-in", async () => {
    const cloud = new FakeCloud();
    const save = new SaveStore(LEVELS);
    const sync = new CloudSync(save, LEVELS, async () => cloud);
    await sync.signIn();
    await settle();
    await sync.signOut();
    const before = cloud.stores;
    save.checkpoint(run(1));
    await settle();
    expect(cloud.stores).toBe(before);
    expect(sync.status).toBe("signed-out");
    expect(storage.get("remnant.cloud")).toBe("false");
  });

  it("a damaged cloud copy is replaced, not trusted", async () => {
    const cloud = new FakeCloud();
    cloud.docs.set("u1", "{broken");
    const save = new SaveStore(LEVELS);
    save.checkpoint(run(2));
    const sync = new CloudSync(save, LEVELS, async () => cloud);
    await sync.signIn();
    await settle();
    expect(sync.status).toBe("synced");
    expect(JSON.parse(cloud.docs.get("u1")!).campaign.levelIndex).toBe(2);
  });
});
