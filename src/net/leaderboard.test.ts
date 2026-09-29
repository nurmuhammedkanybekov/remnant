import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudSync } from "./cloud";
import { boardEntry } from "./firebaseBackend";
import { boardKey, boardName, Leaderboard, ranking, type BoardBackend, type BoardEntry } from "./leaderboard";

class FakeBoard implements BoardBackend {
  entries: BoardEntry[] = [];
  puts = 0;
  async list() {
    return structuredClone(this.entries);
  }
  async put(uid: string, name: string, times: Record<string, number>) {
    this.puts++;
    let e = this.entries.find((x) => x.uid === uid);
    if (!e) this.entries.push((e = { uid, name, times: {} }));
    e.name = name;
    Object.assign(e.times, times);
  }
}

const fakeCloud = (board: FakeBoard, signedIn = true) =>
  ({ board, user: signedIn ? { uid: "me", name: "Nur Kanybekov" } : null }) as unknown as CloudSync;

describe("leaderboard", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keys are safe database field names, one per level, difficulty and mode", () => {
    expect(boardKey("cold-storage", "nightmare", "solo")).toBe("cold_storage__nightmare");
    expect(boardKey("cold-storage", "nightmare", "coop")).toBe("cold_storage__nightmare__coop");
  });

  it("shows a first name, never an email address", () => {
    expect(boardName("Nur Kanybekov")).toBe("Nur");
    expect(boardName("someone@example.com")).toBe("Survivor");
    expect(boardName("  ")).toBe("Survivor");
  });

  it("ranks fastest first and ignores impossible times", () => {
    const key = boardKey("infirmary", "normal", "solo");
    const r = ranking(
      [
        { uid: "a", name: "A", times: { [key]: 90 } },
        { uid: "b", name: "B", times: { [key]: 60 } },
        { uid: "c", name: "C", times: { [key]: 1 } },
        { uid: "d", name: "D", times: {} },
      ],
      key
    );
    expect(r.map((x) => x.uid)).toEqual(["b", "a"]);
  });

  it("keeps only your best, and uploads it when signed in", async () => {
    const fake = new FakeBoard();
    const board = new Leaderboard(fakeCloud(fake));
    expect(board.record("infirmary", "normal", "solo", 100)).toBe(true);
    expect(board.record("infirmary", "normal", "solo", 120)).toBe(false);
    await board.upload();
    const key = boardKey("infirmary", "normal", "solo");
    expect(fake.entries[0]).toMatchObject({ uid: "me", name: "Nur", times: { [key]: 100 } });
    // Nothing new: no second write.
    const puts = fake.puts;
    await board.upload();
    expect(fake.puts).toBe(puts);
  });

  it("never replaces a faster time already on the board", async () => {
    const fake = new FakeBoard();
    const key = boardKey("infirmary", "normal", "solo");
    fake.entries.push({ uid: "me", name: "Nur", times: { [key]: 50 } });
    const board = new Leaderboard(fakeCloud(fake));
    board.record("infirmary", "normal", "solo", 80);
    await board.upload();
    expect(fake.entries[0].times[key]).toBe(50);
  });

  it("keeps times set while signed out, for later", async () => {
    const fake = new FakeBoard();
    const out = new Leaderboard(fakeCloud(fake, false));
    out.record("armory", "aizi", "coop", 300);
    await out.upload();
    expect(fake.entries).toEqual([]);
    const later = new Leaderboard(fakeCloud(fake));
    await later.upload();
    expect(fake.entries[0].times[boardKey("armory", "aizi", "coop")]).toBe(300);
  });

  it("reads a database document", () => {
    const e = boardEntry({
      name: "projects/p/databases/(default)/documents/leaderboard/uid42",
      fields: {
        name: { stringValue: "Raiymbek" },
        times: { mapValue: { fields: { a: { doubleValue: 61.5 }, b: { integerValue: "70" } } } },
      },
    });
    expect(e).toEqual({ uid: "uid42", name: "Raiymbek", times: { a: 61.5, b: 70 } });
  });
});
