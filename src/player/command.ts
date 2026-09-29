import type { Bindings, Action } from "../core/actions";
import { PAD_BINDINGS, stickResponse } from "../core/gamepad";

/**
 * Everything a player wants to do this frame, independent of the device it
 * came from. The simulation only ever consumes commands — which is what lets
 * the same code be driven by a keyboard, a test script, or (later) a remote
 * player over the network.
 */
export interface PlayerCommand {
  /** Strafe intent, -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward intent, -1 (back) .. 1 (forward). */
  moveY: number;
  /** Look change this frame in radians. Positive turn = right, positive tilt = down. */
  turn: number;
  tilt: number;
  sprint: boolean;
  crouch: boolean;
  /** Edge-triggered: true only on the frame the button went down. */
  fire: boolean;
  reload: boolean;
  toggleFlashlight: boolean;
  interact: boolean;
  /** The use key is being held (reviving a partner takes a few seconds). */
  interactHeld: boolean;
  melee: boolean;
  heal: boolean;
  /** Open the inventory (handled by the game, not the simulation). */
  inventory: boolean;
  /** -1 previous, +1 next, 0 none. */
  cycleWeapon: number;
  /** Weapon slot picked with a number key (1-based), or 0. */
  selectSlot: number;
  /** The hold-breath key is held. */
  holdBreath: boolean;
  /** Edge-triggered: throw a bottle or can. */
  throw: boolean;
  /** Edge-triggered: switch between first- and third-person view. */
  toggleCamera: boolean;
  /** The push-to-talk key is held (co-op voice). */
  talk: boolean;
}

export function emptyCommand(): PlayerCommand {
  return {
    moveX: 0,
    moveY: 0,
    turn: 0,
    tilt: 0,
    sprint: false,
    crouch: false,
    fire: false,
    reload: false,
    toggleFlashlight: false,
    interact: false,
    interactHeld: false,
    melee: false,
    heal: false,
    inventory: false,
    cycleWeapon: 0,
    selectSlot: 0,
    holdBreath: false,
    throw: false,
    toggleCamera: false,
    talk: false,
  };
}

/** The slice of `Input` a command needs (kept narrow so tests can fake it). Gamepad methods are optional. */
export interface InputSource {
  isDown(code: string | null): boolean;
  wasPressed(code: string | null): boolean;
  mouseDeltaX: number;
  mouseDeltaY: number;
  padDown?(button: number): boolean;
  padPressed?(button: number): boolean;
  padAxis?(i: number): number;
}

export interface LookSettings {
  /** Radians per pixel of mouse movement. */
  radiansPerPixel: number;
  /** Radians per second at full right-stick tilt. */
  padRadiansPerSecond: number;
  invertY: boolean;
}

/** Builds this frame's command from keyboard, mouse and gamepad. `dt` scales stick look. */
export function buildCommand(input: InputSource, bindings: Bindings, look: LookSettings | null, dt = 0): PlayerCommand {
  const padDown = (b: number) => input.padDown?.(b) ?? false;
  const padPressed = (b: number) => input.padPressed?.(b) ?? false;
  const stick = (i: number, curve = 1) => stickResponse(input.padAxis?.(i) ?? 0, curve);
  const held = (a: Action) => bindings[a].some((c) => input.isDown(c)) || PAD_BINDINGS[a].some(padDown);
  const pressed = (a: Action) => bindings[a].some((c) => input.wasPressed(c)) || PAD_BINDINGS[a].some(padPressed);
  const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
  const axis = (neg: Action, pos: Action) => (held(pos) ? 1 : 0) - (held(neg) ? 1 : 0);
  const invert = look?.invertY ? -1 : 1;
  const padTurn = look ? stick(2, 2) * look.padRadiansPerSecond * dt : 0;
  // Vertical look a little slower than horizontal, as players expect.
  const padTilt = look ? stick(3, 2) * look.padRadiansPerSecond * 0.65 * dt * invert : 0;

  return {
    moveX: clamp1(axis("moveLeft", "moveRight") + stick(0)),
    moveY: clamp1(axis("moveBack", "moveForward") - stick(1)),
    turn: look ? input.mouseDeltaX * look.radiansPerPixel + padTurn : 0,
    tilt: look ? input.mouseDeltaY * look.radiansPerPixel * invert + padTilt : 0,
    sprint: held("sprint"),
    crouch: held("crouch"),
    fire: pressed("fire"),
    reload: pressed("reload"),
    toggleFlashlight: pressed("flashlight"),
    interact: pressed("interact"),
    interactHeld: held("interact"),
    melee: pressed("melee"),
    heal: pressed("heal"),
    inventory: pressed("inventory"),
    cycleWeapon: (pressed("nextWeapon") ? 1 : 0) - (pressed("prevWeapon") ? 1 : 0),
    selectSlot: pressed("weapon1") ? 1 : pressed("weapon2") ? 2 : pressed("weapon3") ? 3 : 0,
    holdBreath: held("holdBreath"),
    throw: pressed("throw"),
    toggleCamera: pressed("camera"),
    talk: held("talk"),
  };
}
