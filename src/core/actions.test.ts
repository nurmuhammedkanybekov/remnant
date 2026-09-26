import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS, keyLabel, normalizeBindings, rebind } from "./actions";

describe("bindings", () => {
  it("fills missing actions from defaults and drops junk", () => {
    const b = normalizeBindings({ reload: ["KeyT", 7], nonsense: ["KeyQ"], fire: ["Escape", "Mouse2"] });
    expect(b.reload).toEqual(["KeyT", null]);
    expect(b.fire).toEqual([null, "Mouse2"]); // Escape is reserved
    expect(b.moveForward).toEqual(DEFAULT_BINDINGS.moveForward);
    expect(normalizeBindings("garbage")).toEqual(DEFAULT_BINDINGS);
  });

  it("a key can only drive one action", () => {
    const b = rebind(DEFAULT_BINDINGS, "reload", 0, "KeyF");
    expect(b.reload[0]).toBe("KeyF");
    expect(b.flashlight[0]).toBeNull();
    expect(DEFAULT_BINDINGS.flashlight[0]).toBe("KeyF"); // input not mutated
  });

  it("can clear a slot and refuses reserved keys", () => {
    expect(rebind(DEFAULT_BINDINGS, "sprint", 1, null).sprint).toEqual(["ShiftLeft", null]);
    expect(rebind(DEFAULT_BINDINGS, "sprint", 0, "Escape").sprint).toEqual(DEFAULT_BINDINGS.sprint);
  });

  it("labels keys for humans", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("Digit3")).toBe("3");
    expect(keyLabel("Mouse0")).toBe("Left Mouse");
    expect(keyLabel("ShiftLeft")).toBe("L-Shift");
    expect(keyLabel(null)).toBe("—");
    expect(keyLabel("WheelDown")).toBe("Wheel Down");
  });

  it("gives actions added in an update their defaults, without stealing keys the player already uses", () => {
    // Saved before melee existed, with V already put on the flashlight.
    const old = { ...DEFAULT_BINDINGS, flashlight: ["KeyV", null] } as Record<string, unknown>;
    delete old.melee;
    const b = normalizeBindings(old);
    expect(b.flashlight).toEqual(["KeyV", null]);
    expect(b.melee).toEqual([null, "Mouse2"]);
    expect(b.heal).toEqual(DEFAULT_BINDINGS.heal);
  });

  it("has no key bound to two actions by default", () => {
    const codes = Object.values(DEFAULT_BINDINGS)
      .flat()
      .filter((c) => c !== null);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
