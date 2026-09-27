import { describe, expect, it } from "vitest";
import { eyeFade } from "./bodies";

describe("creature eyes", () => {
  it("are dark far away and full up close", () => {
    expect(eyeFade(20, 0)).toBe(0);
    expect(eyeFade(9, 0)).toBe(0);
    expect(eyeFade(3, 0)).toBe(1);
  });

  it("brighten as the creature closes in", () => {
    expect(eyeFade(5, 0)).toBeGreaterThan(eyeFade(7, 0));
  });

  it("show from further off when the creature is hunting", () => {
    expect(eyeFade(10, 1)).toBeGreaterThan(0);
    expect(eyeFade(10, 1)).toBeGreaterThan(eyeFade(10, 0));
  });
});
