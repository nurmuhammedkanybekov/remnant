import type { Action } from "./actions";

/**
 * The gamepad layout, for pads the browser reports with the "standard"
 * mapping (Xbox / PlayStation / most others). Not rebindable — the keyboard
 * is — but it follows the conventions players expect.
 */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

/** Buttons for each action. Movement and looking are on the sticks. */
export const PAD_BINDINGS: Record<Action, number[]> = {
  moveForward: [],
  moveBack: [],
  moveLeft: [],
  moveRight: [],
  sprint: [PAD.LT, PAD.L3],
  crouch: [PAD.B],
  fire: [PAD.RT],
  reload: [PAD.X],
  flashlight: [PAD.LB],
  interact: [PAD.A],
  melee: [PAD.RB, PAD.R3],
  heal: [PAD.UP],
  nextWeapon: [PAD.Y, PAD.RIGHT],
  prevWeapon: [PAD.LEFT],
  weapon1: [PAD.DOWN],
  weapon2: [],
  weapon3: [],
};

const BUTTON_NAMES: Record<number, string> = {
  [PAD.A]: "A",
  [PAD.B]: "B",
  [PAD.X]: "X",
  [PAD.Y]: "Y",
  [PAD.LB]: "LB",
  [PAD.RB]: "RB",
  [PAD.LT]: "LT",
  [PAD.RT]: "RT",
  [PAD.BACK]: "View",
  [PAD.START]: "Menu",
  [PAD.L3]: "L3",
  [PAD.R3]: "R3",
  [PAD.UP]: "D-pad ↑",
  [PAD.DOWN]: "D-pad ↓",
  [PAD.LEFT]: "D-pad ←",
  [PAD.RIGHT]: "D-pad →",
};

/** "RT", "A", … — or "—" if the action has no button. */
export function padLabel(action: Action): string {
  const b = PAD_BINDINGS[action][0];
  return b === undefined ? "—" : BUTTON_NAMES[b];
}

/** Everything bound, as readable rows for the controls screen. */
export const PAD_LAYOUT: [string, string][] = [
  ["Move", "Left stick"],
  ["Look", "Right stick"],
  ["Fire", "RT"],
  ["Sprint", "LT / L3"],
  ["Crouch", "B (hold)"],
  ["Melee / takedown", "RB / R3"],
  ["Interact", "A"],
  ["Reload", "X"],
  ["Flashlight", "LB"],
  ["Next / previous weapon", "Y · D-pad → / ←"],
  ["Sidearm", "D-pad ↓"],
  ["Use medkit", "D-pad ↑"],
  ["Pause", "Menu"],
];

/** Sticks rest slightly off centre; ignore anything inside this. */
export const STICK_DEADZONE = 0.18;

/**
 * Rescales a stick axis so the dead zone reads as 0 and full tilt as 1,
 * with a curve that makes small movements precise.
 */
export function stickResponse(v: number, curve = 1): number {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  const t = Math.min(1, (a - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  return Math.sign(v) * Math.pow(t, curve);
}
