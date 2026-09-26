/**
 * Named player actions and the keys bound to them. Gameplay never reads raw
 * key codes — it reads actions — so every control can be rebound.
 *
 * Codes are `KeyboardEvent.code` values, plus `Mouse0`–`Mouse4` for mouse
 * buttons (see `Input`).
 */
export const ACTIONS = ["moveForward", "moveBack", "moveLeft", "moveRight", "sprint", "crouch", "fire", "reload", "flashlight"] as const;

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
  for (const action of ACTIONS) {
    const v = src[action];
    if (!Array.isArray(v)) continue;
    const slot = (x: unknown) => (typeof x === "string" && x.length > 0 && !RESERVED_CODES.has(x) ? x : null);
    out[action] = [slot(v[0]), slot(v[1])];
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
