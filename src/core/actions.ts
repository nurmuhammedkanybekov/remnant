/**
 * Named player actions and the keys bound to them. Gameplay never reads raw
 * key codes — it reads actions — so every control can be rebound.
 *
 * Codes are `KeyboardEvent.code` values, plus `Mouse0`–`Mouse4` for mouse
 * buttons and `WheelUp`/`WheelDown` for the scroll wheel (see `Input`).
 */
export const ACTIONS = [
  "moveForward",
  "moveBack",
  "moveLeft",
  "moveRight",
  "sprint",
  "crouch",
  "fire",
  "reload",
  "flashlight",
  "interact",
  "melee",
  "heal",
  "inventory",
  "nextWeapon",
  "prevWeapon",
  "weapon1",
  "weapon2",
  "weapon3",
  "holdBreath",
  "throw",
  "camera",
  "talk",
] as const;

export type Action = (typeof ACTIONS)[number];

/** Up to two codes per action: a primary and an alternate. */
export type Binding = [primary: string | null, alternate: string | null];
export type Bindings = Record<Action, Binding>;

export const ACTION_LABELS: Record<Action, string> = {
  moveForward: "Move forward",
  moveBack: "Move back",
  moveLeft: "Move left",
  moveRight: "Move right",
  sprint: "Sprint",
  crouch: "Crouch",
  fire: "Fire",
  reload: "Reload",
  flashlight: "Flashlight",
  interact: "Interact",
  melee: "Melee / takedown",
  heal: "Use medkit",
  inventory: "Inventory / journal",
  nextWeapon: "Next weapon",
  prevWeapon: "Previous weapon",
  weapon1: "Sidearm",
  weapon2: "Rivet gun",
  weapon3: "Shotgun",
  holdBreath: "Hold breath",
  throw: "Throw bottle / can",
  camera: "First / third person",
  talk: "Push to talk (co-op)",
};

export const DEFAULT_BINDINGS: Bindings = {
  moveForward: ["KeyW", "ArrowUp"],
  moveBack: ["KeyS", "ArrowDown"],
  moveLeft: ["KeyA", "ArrowLeft"],
  moveRight: ["KeyD", "ArrowRight"],
  sprint: ["ShiftLeft", "ShiftRight"],
  crouch: ["KeyC", "ControlLeft"],
  fire: ["Mouse0", null],
  reload: ["KeyR", null],
  flashlight: ["KeyF", null],
  interact: ["KeyE", null],
  melee: ["KeyV", "Mouse2"],
  heal: ["KeyH", null],
  inventory: ["Tab", "KeyI"],
  nextWeapon: ["KeyQ", "WheelDown"],
  prevWeapon: [null, "WheelUp"],
  weapon1: ["Digit1", null],
  weapon2: ["Digit2", null],
  weapon3: ["Digit3", null],
  holdBreath: ["KeyB", null],
  throw: ["KeyG", null],
  camera: ["KeyP", null],
  talk: ["KeyT", null],
};

/** Codes that can never be bound: Escape is reserved by the browser for releasing the mouse. */
export const RESERVED_CODES: ReadonlySet<string> = new Set(["Escape"]);

export function cloneBindings(b: Bindings): Bindings {
  return Object.fromEntries(ACTIONS.map((a) => [a, [...b[a]]])) as Bindings;
}

/**
 * Accepts anything (e.g. JSON from storage) and returns complete, valid
 * bindings: unknown actions are dropped, missing ones get their defaults.
 */
export function normalizeBindings(raw: unknown): Bindings {
  const out = cloneBindings(DEFAULT_BINDINGS);
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  const stored = ACTIONS.filter((a) => Array.isArray(src[a]));
  for (const action of stored) {
    const v = src[action] as unknown[];
    const slot = (x: unknown) => (typeof x === "string" && x.length > 0 && !RESERVED_CODES.has(x) ? x : null);
    out[action] = [slot(v[0]), slot(v[1])];
  }
  // Actions added since these bindings were saved get their defaults — unless
  // the player has already put one of those keys on something else.
  const taken = new Set(stored.flatMap((a) => out[a]));
  for (const action of ACTIONS) {
    if (stored.includes(action)) continue;
    out[action] = out[action].map((c) => (c !== null && taken.has(c) ? null : c)) as Binding;
  }
  return out;
}

/**
 * Binds `code` to one slot of `action`. A code can only drive one action, so
 * it is removed from wherever else it was bound. Returns new bindings.
 */
export function rebind(bindings: Bindings, action: Action, slot: 0 | 1, code: string | null): Bindings {
  const next = cloneBindings(bindings);
  if (code !== null) {
    if (RESERVED_CODES.has(code)) return next;
    for (const a of ACTIONS) {
      next[a] = next[a].map((c) => (c === code ? null : c)) as Binding;
    }
  }
  next[action][slot] = code;
  return next;
}

const NAMED_KEYS: Record<string, string> = {
  Mouse0: "Left Mouse",
  Mouse1: "Middle Mouse",
  Mouse2: "Right Mouse",
  Mouse3: "Mouse 4",
  Mouse4: "Mouse 5",
  ShiftLeft: "L-Shift",
  ShiftRight: "R-Shift",
  ControlLeft: "L-Ctrl",
  ControlRight: "R-Ctrl",
  AltLeft: "L-Alt",
  AltRight: "R-Alt",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Space",
  Tab: "Tab",
  CapsLock: "Caps",
  Enter: "Enter",
  Backquote: "`",
  WheelUp: "Wheel Up",
  WheelDown: "Wheel Down",
};

/** Short, human-readable name for a code: "KeyW" → "W", "Mouse0" → "Left Mouse". */
export function keyLabel(code: string | null): string {
  if (code === null) return "—";
  if (NAMED_KEYS[code]) return NAMED_KEYS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code;
}
