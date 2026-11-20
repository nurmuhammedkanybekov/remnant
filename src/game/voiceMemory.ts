/**
 * What the voice knows about you. It learned to speak by listening, and it
 * hasn't stopped: everything here is something it heard. Kept for the whole
 * run, across both parts, and saved with it.
 *
 * Two kinds of thing. What you **told** it, when it asked (see the `ask`
 * script action): your answers are kept, and used. And how you **play**,
 * the same things its creatures notice: where you hide, whether you keep
 * your light on, how often you shoot. Those become habits, and a habit is
 * something it can use against you (see `habitOf`).
 */
export interface VoiceMemory {
  /** Questions you answered, by id ("alone", "fear", "where"). */
  told: string[];
  /** Questions it asked that you didn't answer. */
  withheld: string[];
  /** Times you climbed into a locker. */
  hides: number;
  /** Seconds with your light on, and in the dark without one. */
  litSeconds: number;
  darkSeconds: number;
  /** Shots fired, and silent kills from behind. */
  shots: number;
  takedowns: number;
  /** Seconds of play it has listened to. */
  seconds: number;
  /** Levels where you followed Kessler's tune to his note (the voice heard you listening). */
  trail: string[];
  /** What it told you to do (see the `bid` script action), and you did, by id. */
  obeyed: string[];
  /** What it told you to do, and you didn't. */
  defied: string[];
  /** Times you died on the way. It was there every time. */
  deaths: number;
}

/** What it's noticed most about how you play, if anything stands out yet. */
export type Habit = "hider" | "torch" | "dark" | "gun" | "knife";

export function freshVoice(): VoiceMemory {
  return {
    told: [],
    withheld: [],
    hides: 0,
    litSeconds: 0,
    darkSeconds: 0,
    shots: 0,
    takedowns: 0,
    seconds: 0,
    trail: [],
    obeyed: [],
    defied: [],
    deaths: 0,
  };
}

export function cloneVoice(v: VoiceMemory): VoiceMemory {
  return { ...v, told: [...v.told], withheld: [...v.withheld], trail: [...v.trail], obeyed: [...v.obeyed], defied: [...v.defied] };
}

/** It needs this much of you (seconds of play) before it claims to know your habits. */
export const HABIT_AFTER = 240;

/**
 * Your strongest habit, or null while nothing stands out. Measured against
 * how long it has listened, so a long run doesn't make everything a habit.
 */
export function habitOf(v: VoiceMemory): Habit | null {
  if (v.seconds < HABIT_AFTER) return null;
  const minutes = v.seconds / 60;
  const scores: [Habit, number][] = [
    // A locker every couple of minutes is a lot.
    ["hider", v.hides / minutes / 0.45],
    // Light on nearly all the time, or nearly never.
    ["torch", v.litSeconds / v.seconds / 0.85],
    ["dark", v.darkSeconds / v.seconds / 0.45],
    // Several shots a minute.
    ["gun", v.shots / minutes / 4],
    ["knife", v.takedowns / minutes / 0.35],
  ];
  const [habit, score] = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  return score >= 1 ? habit : null;
}

/** Records an answer (or a refusal) once; asking again changes nothing. */
export function remember(v: VoiceMemory, id: string, answered: boolean): void {
  if (v.told.includes(id) || v.withheld.includes(id)) return;
  (answered ? v.told : v.withheld).push(id);
}

/** Records whether you did what it told you (once; it doesn't ask twice). */
export function heed(v: VoiceMemory, id: string, obeyed: boolean): void {
  if (v.obeyed.includes(id) || v.defied.includes(id)) return;
  (obeyed ? v.obeyed : v.defied).push(id);
}

/**
 * Where you stand with it, from everything you gave it and everything you
 * did when it told you to. "trusted": you mostly answered and obeyed;
 * "resisted": you mostly didn't; "torn": neither; null: it never asked or
 * told you anything (a run started part-way).
 */
export type Stance = "trusted" | "resisted" | "torn";

export function stanceOf(v: VoiceMemory): Stance | null {
  const yes = v.told.length + v.obeyed.length;
  const no = v.withheld.length + v.defied.length;
  if (yes + no === 0) return null;
  if (yes >= no + 2 || (no === 0 && yes > 0)) return "trusted";
  if (no >= yes + 2 || (yes === 0 && no > 0)) return "resisted";
  return "torn";
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
const ids = (x: unknown) =>
  Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === "string" && /^[a-z0-9-]{1,24}$/.test(s)))] : [];

/** Anything from storage, made valid field by field. */
export function parseVoice(raw: unknown): VoiceMemory {
  const v = freshVoice();
  if (!raw || typeof raw !== "object") return v;
  const r = raw as Record<string, unknown>;
  v.told = ids(r.told);
  v.withheld = ids(r.withheld).filter((id) => !v.told.includes(id));
  v.hides = num(r.hides);
  v.litSeconds = num(r.litSeconds);
  v.darkSeconds = num(r.darkSeconds);
  v.shots = num(r.shots);
  v.takedowns = num(r.takedowns);
  v.seconds = Math.max(num(r.seconds), v.litSeconds + v.darkSeconds);
  v.trail = ids(r.trail);
  v.obeyed = ids(r.obeyed);
  v.defied = ids(r.defied).filter((id) => !v.obeyed.includes(id));
  v.deaths = Math.floor(num(r.deaths));
  return v;
}

/** The memory as the story's text reads it (`recountLines`, `voiceCoda`). */
export function remembered(v: VoiceMemory) {
  return { told: v.told, withheld: v.withheld, obeyed: v.obeyed, defied: v.defied, trail: v.trail, deaths: v.deaths, stance: stanceOf(v) };
}
