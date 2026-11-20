/**
 * Level scripting. Levels attach lists of actions to triggers, intercoms and
 * events; `LevelSession` runs them. Kept as plain data so levels stay
 * declarative and testable.
 */
import type { Stinger } from "../audio/soundManager";
import type { EnemyKind } from "../content/enemies";

/** A map cell, for actions that happen somewhere in particular. */
export interface CellRef {
  col: number;
  row: number;
}

/** "echo" is the Operator's voice coming from somewhere nearby instead of the radio (a Mimic). */
export type Speaker = "operator" | "nur" | "unknown" | "echo";

export interface RadioLine {
  speaker: Speaker;
  text: string;
}

export type ScriptAction =
  /** Queue lines on the radio (subtitled, with synthesized radio voice). */
  | { type: "radio"; lines: RadioLine[] }
  /** Replace the objective shown top-left. */
  | { type: "objective"; text: string }
  /**
   * A control hint. `{action}` placeholders are replaced by the key bound
   * to that action, e.g. "{flashlight}" → "F".
   */
  | { type: "hint"; text: string }
  /** Save progress at the player's current position. */
  | { type: "checkpoint" }
  /** A loud noise at the player's position — every creature within `radius` comes to look. */
  | { type: "alarm"; radius: number }
  /**
   * The power fails for `seconds`: the lamps go out in a wave that reaches
   * you last, emergency lamps stay on. Your torch is unaffected.
   */
  | { type: "blackout"; seconds: number }
  /** Your torch stutters and dies for `seconds`, then catches again. */
  | { type: "torchFails"; seconds: number }
  /** The world goes silent for `seconds`: drone, room, wind and music. Only what's near you is left. */
  | { type: "silence"; seconds: number }
  /** A sound placed in the world: at a cell, or (no cell) right behind you. */
  | { type: "sound"; sound: Stinger; at: CellRef | null }
  /**
   * A figure standing at a cell that isn't really there: it vanishes when
   * you put your light on it or come close. See `world/apparition.ts`.
   */
  | { type: "apparition"; kind: EnemyKind; at: CellRef; facing: "toward" | "away" }
  /**
   * The voice asks you something. After the question you have a few seconds
   * to answer (push to talk) or say nothing. Answer and you hear `answer`,
   * and `reward` runs: it helps you, with something true. Say nothing and
   * `silent` plays. Either way it remembers (`VoiceMemory`, by `id`), and
   * never asks the same thing twice in a run.
   */
  | { type: "ask"; id: string; question: RadioLine[]; answer: RadioLine[]; reward: ScriptAction[]; silent: RadioLine[] }
  /** What you told it comes back: `then` if you answered question `id`, `otherwise` if not (or it never asked). */
  | { type: "ifTold"; id: string; then: ScriptAction[]; otherwise: ScriptAction[] }
  /**
   * It shows you the way, by sound: a radio chirp from where the keycard is
   * (until you have it), else the nearest machine still to do, else the exit.
   */
  | { type: "ping" }
  /** It tells you what it's noticed about how you play, if anything stands out yet (see `habitOf`). */
  | { type: "habitLine" }
  /** Kessler's trail: `then` if you've followed his tune to at least `count` of his notes this run. */
  | { type: "ifTrail"; count: number; then: ScriptAction[]; otherwise: ScriptAction[] };

// Small constructors so level files read like a script.
export const op = (text: string): RadioLine => ({ speaker: "operator", text });
export const nur = (text: string): RadioLine => ({ speaker: "nur", text });
export const unknown = (text: string): RadioLine => ({ speaker: "unknown", text });
export const radio = (...lines: RadioLine[]): ScriptAction => ({ type: "radio", lines });
export const objective = (text: string): ScriptAction => ({ type: "objective", text });
export const hint = (text: string): ScriptAction => ({ type: "hint", text });
export const ask = (
  id: string,
  question: RadioLine[],
  answer: RadioLine[],
  reward: ScriptAction[] = [],
  silent: RadioLine[] = []
): ScriptAction => ({
  type: "ask",
  id,
  question,
  answer,
  reward,
  silent,
});
export const ifTold = (id: string, then: ScriptAction[], otherwise: ScriptAction[] = []): ScriptAction => ({
  type: "ifTold",
  id,
  then,
  otherwise,
});
export const ping = (): ScriptAction => ({ type: "ping" });
export const habitLine = (): ScriptAction => ({ type: "habitLine" });
export const ifTrail = (count: number, then: ScriptAction[], otherwise: ScriptAction[] = []): ScriptAction => ({
  type: "ifTrail",
  count,
  then,
  otherwise,
});
export const checkpoint = (): ScriptAction => ({ type: "checkpoint" });
export const alarm = (radius: number): ScriptAction => ({ type: "alarm", radius });
export const blackout = (seconds: number): ScriptAction => ({ type: "blackout", seconds });
export const torchFails = (seconds: number): ScriptAction => ({ type: "torchFails", seconds });
export const silence = (seconds: number): ScriptAction => ({ type: "silence", seconds });
/** `sound("knock", 9, 4)` at a cell; `sound("breath")` right behind you. */
export const sound = (kind: Stinger, col?: number, row?: number): ScriptAction => ({
  type: "sound",
  sound: kind,
  at: col === undefined || row === undefined ? null : { col, row },
});
export const apparition = (kind: EnemyKind, col: number, row: number, facing: "toward" | "away" = "toward"): ScriptAction => ({
  type: "apparition",
  kind,
  at: { col, row },
  facing,
});

/** How long a subtitle line stays up: roughly reading speed, clamped. */
export function lineDuration(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.min(8, Math.max(2.4, 1.2 + words * 0.36));
}
