import type { Bindings, Action } from "../core/actions";

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
}

export function emptyCommand(): PlayerCommand {
  return { moveX: 0, moveY: 0, turn: 0, tilt: 0, sprint: false, crouch: false, fire: false, reload: false, toggleFlashlight: false };
}

/** The slice of `Input` a command needs (kept narrow so tests can fake it). */
export interface InputSource {
  isDown(code: string | null): boolean;
  wasPressed(code: string | null): boolean;
  mouseDeltaX: number;
  mouseDeltaY: number;
}

export interface LookSettings {
  /** Radians per pixel of mouse movement. */
  radiansPerPixel: number;
  invertY: boolean;
}

export function buildCommand(input: InputSource, bindings: Bindings, look: LookSettings | null): PlayerCommand {
  const held = (a: Action) => bindings[a].some((c) => input.isDown(c));
  const pressed = (a: Action) => bindings[a].some((c) => input.wasPressed(c));
  const axis = (neg: Action, pos: Action) => (held(pos) ? 1 : 0) - (held(neg) ? 1 : 0);

  return {
    moveX: axis("moveLeft", "moveRight"),
    moveY: axis("moveBack", "moveForward"),
    turn: look ? input.mouseDeltaX * look.radiansPerPixel : 0,
    tilt: look ? input.mouseDeltaY * look.radiansPerPixel * (look.invertY ? -1 : 1) : 0,
    sprint: held("sprint"),
    crouch: held("crouch"),
    fire: pressed("fire"),
    reload: pressed("reload"),
    toggleFlashlight: pressed("flashlight"),
  };
}
