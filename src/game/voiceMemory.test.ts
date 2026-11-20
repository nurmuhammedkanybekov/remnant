import { describe, expect, it } from "vitest";
import { voiceCoda } from "../content/story";
import { HABIT_AFTER, cloneVoice, freshVoice, habitOf, parseVoice, remember } from "./voiceMemory";

const played = (minutes: number, extra: Partial<ReturnType<typeof freshVoice>>) => ({
  ...freshVoice(),
  seconds: minutes * 60,
  litSeconds: minutes * 60 * 0.5,
  darkSeconds: minutes * 60 * 0.2,
  ...extra,
});

describe("voice memory", () => {
  it("claims no habit until it has listened long enough, or when nothing stands out", () => {
    expect(habitOf({ ...freshVoice(), hides: 50, seconds: HABIT_AFTER - 1 })).toBeNull();
    expect(habitOf(played(10, {}))).toBeNull();
  });

  it("knows a hider, a torch, the dark, a gun and a knife when it sees one", () => {
    expect(habitOf(played(10, { hides: 6 }))).toBe("hider");
    expect(habitOf(played(10, { litSeconds: 580 }))).toBe("torch");
    expect(habitOf(played(10, { darkSeconds: 300, litSeconds: 100 }))).toBe("dark");
    expect(habitOf(played(10, { shots: 60 }))).toBe("gun");
    expect(habitOf(played(10, { takedowns: 5 }))).toBe("knife");
  });

  it("keeps an answer or a refusal once", () => {
    const v = freshVoice();
    remember(v, "fear", true);
    remember(v, "fear", false);
    remember(v, "alone", false);
    expect(v.told).toEqual(["fear"]);
    expect(v.withheld).toEqual(["alone"]);
  });

  it("parses anything into a valid memory, and clones deep", () => {
    expect(parseVoice(null)).toEqual(freshVoice());
    const v = parseVoice({
      told: ["fear", "fear", 3, "BAD ID!"],
      withheld: ["fear", "alone"],
      hides: -2,
      shots: 7,
      seconds: 1,
      litSeconds: 50,
    });
    expect(v.told).toEqual(["fear"]);
    expect(v.withheld).toEqual(["alone"]);
    expect(v.hides).toBe(0);
    expect(v.shots).toBe(7);
    expect(v.seconds).toBe(50);
    const c = cloneVoice(v);
    c.told.push("where");
    expect(v.told).toEqual(["fear"]);
  });
});

describe("the ending's last line", () => {
  it("depends on what you gave it, and is absent if it never asked", () => {
    expect(voiceCoda([], [])).toBeNull();
    expect(voiceCoda([], ["alone", "fear"])).toMatch(/never told it anything/);
    expect(voiceCoda(["alone", "fear", "where"], [])).toMatch(/answered everything/);
    expect(voiceCoda(["fear"], ["alone"])).toMatch(/some of what it asked/);
  });
});
