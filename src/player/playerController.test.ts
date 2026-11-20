import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CELL_SIZE, type LevelGrid } from "../world/grid";
import { BREATH_NOISE } from "./breath";
import { emptyCommand, type PlayerCommand } from "./command";
import { MAX_STAMINA, NOISE_RADIUS, PlayerController } from "./playerController";

// A long east-west corridor.
const corridor: LevelGrid = {
  cols: 12,
  rows: 3,
  solid: ["############", "#..........#", "############"].map((r) => [...r].map((c) => c === "#")),
};
const start = new THREE.Vector2(1.5 * CELL_SIZE, 1.5 * CELL_SIZE);
const FACE_EAST = -Math.PI / 2;

function simulate(player: PlayerController, seconds: number, cmd: Partial<PlayerCommand>): void {
  for (let t = 0; t < seconds; t += 1 / 60) player.update(1 / 60, { ...emptyCommand(), ...cmd });
}

const makePlayer = () => new PlayerController(new THREE.PerspectiveCamera(), corridor, start, FACE_EAST);

describe("PlayerController", () => {
  it("walks forward in the direction it faces", () => {
    const p = makePlayer();
    simulate(p, 1, { moveY: 1 });
    expect(p.position.x).toBeGreaterThan(start.x + 2.5);
    expect(p.position.z).toBeCloseTo(start.y, 1);
    expect(p.gait).toBe("walk");
    expect(p.noiseRadius).toBe(NOISE_RADIUS.walk);
  });

  it("is stopped by walls", () => {
    const p = makePlayer();
    simulate(p, 2, { moveX: -1 }); // strafe left = north, into the wall
    expect(p.position.z).toBeGreaterThan(CELL_SIZE); // still inside the corridor
  });

  it("sprinting is faster, louder and drains stamina", () => {
    const walker = makePlayer();
    const sprinter = makePlayer();
    simulate(walker, 1, { moveY: 1 });
    simulate(sprinter, 1, { moveY: 1, sprint: true });
    expect(sprinter.position.x).toBeGreaterThan(walker.position.x);
    expect(sprinter.gait).toBe("sprint");
    expect(sprinter.stamina).toBeLessThan(MAX_STAMINA);
  });

  it("crouching is near-silent and blocks sprint", () => {
    const p = makePlayer();
    simulate(p, 1, { moveY: 1, crouch: true, sprint: true });
    expect(p.gait).toBe("crouch");
    // Crouch-walking is quieter than your breathing; hold it and only the steps are left.
    expect(p.noiseRadius).toBe(Math.max(NOISE_RADIUS.crouch, BREATH_NOISE));
    simulate(p, 1, { moveY: 1, crouch: true, holdBreath: true });
    expect(p.noiseRadius).toBe(NOISE_RADIUS.crouch);
  });

  it("standing still you're only heard breathing, and not at all while you hold it", () => {
    const p = makePlayer();
    simulate(p, 0.5, {});
    expect(p.noiseRadius).toBe(BREATH_NOISE);
    simulate(p, 0.5, { holdBreath: true });
    expect(p.noiseRadius).toBe(0);
  });

  it("applies look input and clamps pitch", () => {
    const p = makePlayer();
    simulate(p, 0.1, { turn: 0.01 });
    expect(p.facing).toBeLessThan(FACE_EAST);
    p.update(1 / 60, { ...emptyCommand(), tilt: -100 });
    expect(p.lookDelta.y).toBe(-100);
  });

  it("leans: the head moves sideways and tilts, the feet stay put, walls stop it", () => {
    const cam = new THREE.PerspectiveCamera();
    // Facing east down the corridor: right is south, and the south wall is half a cell away.
    const p = new PlayerController(cam, corridor, start, FACE_EAST);
    simulate(p, 1, { lean: -1 }); // left = north: open floor for a full lean
    expect(p.position.x).toBeCloseTo(start.x, 3);
    expect(p.position.z).toBeCloseTo(start.y, 3);
    expect(cam.position.z).toBeLessThan(start.y - 0.4);
    expect(cam.rotation.z).toBeGreaterThan(0.1);
    expect(p.leaning).toBeLessThan(-0.95);
    // Shoved against the north wall, a left lean can't put your head through it.
    simulate(p, 2, { moveX: -1 });
    simulate(p, 1, { lean: -1 });
    expect(cam.position.z).toBeGreaterThan(CELL_SIZE);
  });

  it("doesn't lean while sprinting", () => {
    const p = makePlayer();
    simulate(p, 1, { moveY: 1, sprint: true, lean: 1 });
    expect(Math.abs(p.leaning)).toBeLessThan(0.01);
  });
});
