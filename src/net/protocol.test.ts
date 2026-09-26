import { describe, expect, it } from "vitest";
import { CODE_LENGTH, makeRoomCode, normalizeRoomCode, roomPeerId } from "./protocol";

describe("room codes", () => {
  it("are 5 characters with no look-alikes (0/O, 1/I/L)", () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it("accept what a player types: any case, spaces and dashes", () => {
    expect(normalizeRoomCode(" k7qx2 ")).toBe("K7QX2");
    expect(normalizeRoomCode("K7-QX2")).toBe("K7QX2");
  });

  it("reject the wrong length and characters that are never in a code", () => {
    expect(normalizeRoomCode("K7QX")).toBeNull();
    expect(normalizeRoomCode("K7QX22")).toBeNull();
    expect(normalizeRoomCode("K0QX2")).toBeNull();
  });

  it("map to a versioned id, so different versions never meet", () => {
    expect(roomPeerId("K7QX2")).toMatch(/^remnant-v\d+-k7qx2$/);
  });
});
