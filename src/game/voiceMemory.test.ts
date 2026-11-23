import { describe, expect, it } from "vitest";
import { recountLines, voiceCoda } from "../content/story";
import {
  HABIT_AFTER,
  cloneVoice,
  freshVoice,
  habitOf,
  heed,
  parseVoice,
  remember,
  remembered,
  stanceOf,
  type VoiceMemory,
} from "./voiceMemory";
import { parseCheckpoint, CHECKPOINT_LAYOUT } from "./checkpoint";

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

describe("what you did when it told you", () => {
  it("keeps whether you obeyed, once", () => {
    const v = freshVoice();
    heed(v, "kit", false);
    heed(v, "kit", true);
    heed(v, "store", true);
    expect(v.defied).toEqual(["kit"]);
    expect(v.obeyed).toEqual(["store"]);
  });

  it("parses obedience and deaths, and keeps them through a clone and a checkpoint", () => {
    const v = parseVoice({ obeyed: ["kit", "kit"], defied: ["kit", "hum"], deaths: 3.7 });
    expect(v.obeyed).toEqual(["kit"]);
    expect(v.defied).toEqual(["hum"]);
    expect(v.deaths).toBe(3);
    const c = cloneVoice(v);
    c.obeyed.push("store");
    expect(v.obeyed).toEqual(["kit"]);
    const cp = parseCheckpoint({
      layout: CHECKPOINT_LAYOUT,
      x: 1,
      z: 2,
      yaw: 0,
      objective: "o",
      loadout: { weapons: { pistol: { mag: 1, reserve: 0 } }, current: "pistol" },
      voice: { told: ["fear"], obeyed: ["kit"] },
    });
    expect(cp?.voice?.told).toEqual(["fear"]);
    expect(cp?.voice?.obeyed).toEqual(["kit"]);
  });

  it("works out where you stand", () => {
    expect(stanceOf(freshVoice())).toBeNull();
    expect(stanceOf({ ...freshVoice(), told: ["alone", "fear"], obeyed: ["kit"], defied: ["store"] })).toBe("trusted");
    expect(stanceOf({ ...freshVoice(), withheld: ["alone"], defied: ["kit", "hum"], obeyed: ["store"] })).toBe("resisted");
    expect(stanceOf({ ...freshVoice(), told: ["alone"], defied: ["kit"] })).toBe("torn");
    expect(stanceOf({ ...freshVoice(), withheld: ["alone"] })).toBe("resisted");
  });
});

/**
 * Four ways to play the whole campaign, as the memory would be at the end
 * of each part, to check they come out as different stories, not the same
 * one with a different number in it.
 */
const persona = (p: Partial<VoiceMemory>): VoiceMemory => ({ ...freshVoice(), seconds: 3600, litSeconds: 1800, darkSeconds: 600, ...p });
const PERSONAS: Record<string, VoiceMemory> = {
  // Answers, obeys, hides.
  truster: persona({ told: ["alone", "fear", "where"], obeyed: ["lights-off", "kit", "hum", "store", "still"], hides: 60 }),
  // Mara's rule: never answers, never does what it says, keeps the light off.
  resister: persona({ withheld: ["alone", "fear", "where"], defied: ["lights-off", "kit", "hum", "store", "still"], darkSeconds: 2400 }),
  // Goes everywhere the voice says not to; follows the tune; dies a lot.
  explorer: persona({
    told: ["alone"],
    withheld: ["fear"],
    obeyed: ["lights-off", "kit"],
    defied: ["hum", "store"],
    trail: ["a", "b", "c", "d"],
    deaths: 7,
  }),
  // Shoots everything, ignores everything; never even near the trail.
  aggressive: persona({
    withheld: ["alone"],
    told: ["fear"],
    defied: ["lights-off", "kit", "still"],
    obeyed: ["store"],
    shots: 600,
    deaths: 2,
  }),
};

describe("four ways to play", () => {
  const story = (v: VoiceMemory) => ({
    habit: habitOf(v),
    stance: stanceOf(v),
    one: recountLines(remembered(v), 1).map((l) => l.text),
    two: recountLines(remembered(v), 2).map((l) => l.text),
    coda: voiceCoda(remembered(v)),
  });

  it("each gets its own habit, stance, recount and ending", () => {
    const s = Object.fromEntries(Object.entries(PERSONAS).map(([k, v]) => [k, story(v)]));
    expect(s.truster.habit).toBe("hider");
    expect(s.resister.habit).toBe("dark");
    expect(s.aggressive.habit).toBe("gun");
    expect(s.truster.stance).toBe("trusted");
    expect(s.resister.stance).toBe("resisted");
    expect(s.aggressive.stance).toBe("resisted");
    // No two recounts the same.
    const ones = Object.values(s).map((x) => x.one.join("|"));
    const twos = Object.values(s).map((x) => x.two.join("|"));
    expect(new Set(ones).size).toBe(4);
    expect(new Set(twos).size).toBe(4);
    // The medkit is remembered as what you did with it, and Ruslan speaks only if you left it.
    expect(s.truster.one.join(" ")).toMatch(/Thank you for the kit/);
    expect(s.resister.one.join(" ")).toMatch(/You took the medkit/);
    // Only the one who followed the tune hears about the photograph; only those who died are told so.
    expect(s.explorer.two.join(" ")).toMatch(/photograph/);
    expect(s.explorer.two.join(" ")).toMatch(/7 times/);
    expect(s.truster.two.join(" ")).not.toMatch(/died/);
    // In the village it lies one way or the other: nothing behind you if you stood still.
    expect(s.truster.two.join(" ")).toMatch(/nothing behind you/);
    expect(s.resister.two.join(" ")).toMatch(/something behind you/);
    expect(new Set(Object.values(s).map((x) => x.coda)).size).toBe(3);
  });

  it("is short enough to listen to", () => {
    for (const v of Object.values(PERSONAS)) {
      expect(recountLines(remembered(v), 1).length).toBeLessThanOrEqual(6);
      expect(recountLines(remembered(v), 2).length).toBeLessThanOrEqual(6);
    }
  });

  it("says nothing to a run that never met it", () => {
    expect(recountLines(remembered(freshVoice()), 1)).toEqual([]);
    expect(recountLines(remembered(freshVoice()), 2)).toEqual([]);
  });
});

describe("the second pass", () => {
  it("counts the voices you sent home from under ten, and says so when there are enough", () => {
    expect(parseVoice({ fed: 12.9 }).fed).toBe(12);
    const m = (fed: number) =>
      recountLines(remembered({ ...freshVoice(), told: ["where"], fed }), 2)
        .map((l) => l.text)
        .join(" ");
    expect(m(4)).not.toMatch(/under ten/);
    expect(m(12)).toMatch(/You killed 12 of them under ten/);
  });

  it("remembers whether you asked it to open the freezer", () => {
    const one = (p: Partial<VoiceMemory>) =>
      recountLines(remembered({ ...freshVoice(), ...p }), 1)
        .map((l) => l.text)
        .join(" ");
    expect(one({ told: ["open"] })).toMatch(/You asked/);
    expect(one({ withheld: ["open"] })).toMatch(/tear the wall open/);
  });
});

describe("the ending's last line", () => {
  it("depends on where you stood with it, and is absent if it never asked", () => {
    const m = (p: Partial<VoiceMemory>) => remembered({ ...freshVoice(), ...p });
    expect(voiceCoda(m({}))).toBeNull();
    expect(voiceCoda(m({ withheld: ["alone", "fear"] }))).toMatch(/gave it nothing/);
    expect(voiceCoda(m({ told: ["alone", "fear", "where"] }))).toMatch(/did what it told you/);
    expect(voiceCoda(m({ told: ["fear"], withheld: ["alone"] }))).toMatch(/kept the rest/);
  });
});
