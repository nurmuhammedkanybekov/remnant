import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { hitsPlayer } from "./projectiles";

describe("hitsPlayer", () => {
  const player = new THREE.Vector3(0, 0, 0);

  it("hits when the glob passes through the player's body", () => {
    expect(hitsPlayer(new THREE.Vector3(-1, 1, 0), new THREE.Vector3(1, 1, 0), player, 1.7)).toBe(true);
  });

  it("misses a glob that passes beside, above or below", () => {
    expect(hitsPlayer(new THREE.Vector3(-1, 1, 1), new THREE.Vector3(1, 1, 1), player, 1.7)).toBe(false);
    expect(hitsPlayer(new THREE.Vector3(-1, 2.5, 0), new THREE.Vector3(1, 2.5, 0), player, 1.7)).toBe(false);
  });

  it("a crouching player is a smaller target", () => {
    const high = [new THREE.Vector3(-1, 1.6, 0), new THREE.Vector3(1, 1.6, 0)] as const;
    expect(hitsPlayer(...high, player, 1.7)).toBe(true);
    expect(hitsPlayer(...high, player, 1.05)).toBe(false);
  });
});
