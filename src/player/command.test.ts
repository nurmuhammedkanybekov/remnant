import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "../core/actions";
import { buildCommand, type InputSource } from "./command";

function fakeInput(down: string[], pressed: string[] = [], dx = 0, dy = 0): InputSource {
  return {
    isDown: (c) => c !== null && down.includes(c),
    wasPressed: (c) => c !== null && pressed.includes(c),
    mouseDeltaX: dx,
    mouseDeltaY: dy,
  };
}

describe("buildCommand", () => {
  it("turns held keys into movement axes", () => {
    const cmd = buildCommand(fakeInput(["KeyW", "KeyD"]), DEFAULT_BINDINGS, null);
    expect(cmd.moveY).toBe(1);
    expect(cmd.moveX).toBe(1);
    expect(buildCommand(fakeInput(["KeyW", "KeyS"]), DEFAULT_BINDINGS, null).moveY).toBe(0);
  });

  it("accepts either bound key", () => {
    expect(buildCommand(fakeInput(["ArrowUp", "ShiftRight"]), DEFAULT_BINDINGS, null)).toMatchObject({ moveY: 1, sprint: true });
  });

  it("edge-triggered actions only fire on the press", () => {
    const held = buildCommand(fakeInput(["Mouse0", "KeyR"]), DEFAULT_BINDINGS, null);
    expect(held.fire).toBe(false);
    const pressed = buildCommand(fakeInput(["Mouse0"], ["Mouse0", "KeyF"]), DEFAULT_BINDINGS, null);
    expect(pressed.fire).toBe(true);
    expect(pressed.toggleFlashlight).toBe(true);
  });

  it("scales and optionally inverts mouse look", () => {
    const look = { radiansPerPixel: 0.01, invertY: false };
    const cmd = buildCommand(fakeInput([], [], 10, -5), DEFAULT_BINDINGS, look);
    expect(cmd.turn).toBeCloseTo(0.1);
    expect(cmd.tilt).toBeCloseTo(-0.05);
    expect(buildCommand(fakeInput([], [], 0, -5), DEFAULT_BINDINGS, { ...look, invertY: true }).tilt).toBeCloseTo(0.05);
    expect(buildCommand(fakeInput([], [], 10, 10), DEFAULT_BINDINGS, null).turn).toBe(0);
  });
});
