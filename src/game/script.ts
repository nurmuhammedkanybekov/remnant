/**
 * Level scripting. Levels attach lists of actions to triggers, intercoms and
 * events; `LevelSession` runs them. Kept as plain data so levels stay
 * declarative and testable.
 */
export type Speaker = "operator" | "aida" | "unknown";

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
  | { type: "alarm"; radius: number };

// Small constructors so level files read like a script.
export const op = (text: string): RadioLine => ({ speaker: "operator", text });
export const aida = (text: string): RadioLine => ({ speaker: "aida", text });
export const unknown = (text: string): RadioLine => ({ speaker: "unknown", text });
export const radio = (...lines: RadioLine[]): ScriptAction => ({ type: "radio", lines });
export const objective = (text: string): ScriptAction => ({ type: "objective", text });
export const hint = (text: string): ScriptAction => ({ type: "hint", text });
export const checkpoint = (): ScriptAction => ({ type: "checkpoint" });
export const alarm = (radius: number): ScriptAction => ({ type: "alarm", radius });

/** How long a subtitle line stays up: roughly reading speed, clamped. */
export function lineDuration(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.min(8, Math.max(2.4, 1.2 + words * 0.36));
}
