import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ENEMIES, type EnemyKind } from "../content/enemies";
import { cellCenter, type LevelGrid } from "../world/grid";
import type { CreatureBody } from "./bodies";
import { RemnantBoss } from "./boss";
import { Enemy, NO_MODIFIERS, type Perception } from "./enemy";

/** A body with no meshes, so the AI can run without WebGL or a canvas. */
function stubBody(): CreatureBody & { open: number; rage: number } {
  const group = new THREE.Group();
  return {
    group,
    open: 0,
    rage: 0,
    hitVolumes: () => {
      const p = group.getWorldPosition(new THREE.Vector3());
      return { head: new THREE.Sphere(p.clone().setY(1.6), 0.17), body: [new THREE.Sphere(p.clone().setY(1.1), 0.3)] };
    },
    mouth: () => group.getWorldPosition(new THREE.Vector3()).setY(1.5),
    pose: () => {},
    die: () => {},
    glow: () => {},
  };
}

/** An open room, 12×5 cells, walled round the edge. */
function room(): LevelGrid {
  const cols = 12;
  const rows = 5;
  const solid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => r === 0 || c === 0 || r === rows - 1 || c === cols - 1)
  );
  return { cols, rows, solid };
}

const level = room();
const scene = new THREE.Scene();

function spawn(kind: EnemyKind, col: number, row = 2): Enemy {
  const Cls = kind === "remnant" ? RemnantBoss : Enemy;
  return new Cls(scene, cellCenter(col, row), kind, NO_MODIFIERS, stubBody());
}

/** The player at a cell, looking along -X (towards lower columns) unless told otherwise. */
function perceive(col: number, opts: Partial<Perception> = {}, row = 2): Perception {
  const p = cellCenter(col, row);
  return {
    playerPos: p,
    playerNoise: 0,
    torchOn: false,
    playerDead: false,
    eye: new THREE.Vector3(p.x, 1.7, p.y),
    look: new THREE.Vector3(-1, 0, 0),
    ...opts,
  };
}

function run(e: Enemy, p: Perception, seconds: number, others: Enemy[] = [e]): void {
  for (let t = 0; t < seconds; t += 1 / 30) e.update(1 / 30, level, p, others);
}

describe("creature senses", () => {
  it("a Listener is blind: it never spots you by sight, even with the light on", () => {
    const e = spawn("listener", 3);
    run(e, perceive(5, { torchOn: true }), 3);
    expect(e.suspicion).toBe(0);
    expect(e.isHunting).toBe(false);
  });

  it("a Listener hears quiet footsteps a Husk would miss", () => {
    const listener = spawn("listener", 3);
    const husk = spawn("husk", 3);
    const walk = perceive(5, { playerNoise: 5.5 }); // walking, 8 units away
    run(listener, walk, 0.1);
    run(husk, walk, 0.1);
    expect(listener.state).toBe("investigate");
    expect(husk.state).toBe("patrol");
  });

  it("a Watcher freezes while the beam is on it and moves when it isn't", () => {
    const lit = spawn("watcher", 3);
    const dark = spawn("watcher", 3);
    lit.alertTo(cellCenter(7, 2));
    dark.alertTo(cellCenter(7, 2));
    const start = lit.position2D.x;
    // Player four cells away, looking back down the room at it (-X) — or away from it.
    run(lit, perceive(7, { torchOn: true }), 1);
    run(dark, perceive(7, { torchOn: true, look: new THREE.Vector3(1, 0, 0) }), 1);
    expect(lit.frozen).toBe(true);
    expect(lit.position2D.x).toBeCloseTo(start, 5);
    expect(dark.frozen).toBe(false);
    expect(dark.position2D.x).toBeGreaterThan(start + 2);
  });

  it("a Crawler waits on the ceiling and drops when you pass beneath", () => {
    const e = spawn("crawler", 5);
    expect(e.onCeiling).toBe(true);
    run(e, perceive(9), 1);
    expect(e.onCeiling).toBe(true);
    run(e, perceive(5), 0.1);
    expect(e.state).toBe("drop");
    run(e, perceive(5), 1);
    expect(e.onCeiling).toBe(false);
    expect(["chase", "attack"]).toContain(e.state);
  });

  it("a gunshot knocks a Crawler off the ceiling", () => {
    const e = spawn("crawler", 5);
    e.hearNoise(cellCenter(9, 2), 22);
    expect(e.state).toBe("drop");
  });
});

describe("ranged and ambush creatures", () => {
  it("a Spitter spits from range instead of closing in", () => {
    const e = spawn("spitter", 2);
    const shots: THREE.Vector3[] = [];
    e.onRanged = (_en, _from, target) => shots.push(target);
    e.alertTo(cellCenter(4, 2));
    const start = e.position2D.x;
    run(e, perceive(4, { torchOn: true }), 4); // 8 units away: inside its range
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0].x).toBeCloseTo(cellCenter(4, 2).x);
    expect(Math.abs(e.position2D.x - start)).toBeLessThan(1);
  });

  it("a Mimic stays hidden and lures, then ambushes up close", () => {
    const e = spawn("mimic", 3);
    let lures = 0;
    e.onLure = () => lures++;
    run(e, perceive(10), 20);
    expect(e.state).toBe("lurk");
    expect(lures).toBeGreaterThan(0);
    run(e, perceive(3), 0.1);
    expect(e.isHunting).toBe(true);
  });
});

describe("melee takedowns", () => {
  it("works from behind an unaware creature, not from the front or once it's hunting", () => {
    const e = spawn("husk", 5);
    const facing = e.heading;
    const ahead = e.position2D.add(new THREE.Vector2(Math.sin(facing), Math.cos(facing)).multiplyScalar(1.2));
    const behind = e.position2D.sub(new THREE.Vector2(Math.sin(facing), Math.cos(facing)).multiplyScalar(1.2));
    expect(e.canBeTakenDown(behind)).toBe(true);
    expect(e.canBeTakenDown(ahead)).toBe(false);
    e.alertTo(behind);
    expect(e.canBeTakenDown(behind)).toBe(false);
  });

  it("never works on a Brute or a creature on the ceiling", () => {
    const brute = spawn("brute", 5);
    const behind = brute.position2D.sub(new THREE.Vector2(Math.sin(brute.heading), Math.cos(brute.heading)));
    expect(brute.canBeTakenDown(behind)).toBe(false);
    const crawler = spawn("crawler", 5);
    expect(crawler.canBeTakenDown(crawler.position2D)).toBe(false);
  });

  it("works from any side on a Watcher frozen in the light", () => {
    const e = spawn("watcher", 3);
    e.alertTo(cellCenter(6, 2));
    run(e, perceive(6, { torchOn: true }), 0.1);
    expect(e.frozen).toBe(true);
    expect(e.canBeTakenDown(cellCenter(4, 2))).toBe(true);
    e.takedown();
    expect(e.isDead).toBe(true);
  });
});

describe("the Remnant", () => {
  it("sleeps until you come close, then fights in three phases", () => {
    const boss = spawn("remnant", 3) as RemnantBoss;
    const phases: number[] = [];
    boss.onPhase = (p) => phases.push(p);
    run(boss, perceive(10), 1); // 28 units: too far
    expect(boss.awake).toBe(false);
    run(boss, perceive(6), 0.1);
    expect(boss.awake).toBe(true);
    // The core is shut, so this goes through the hide's armour.
    boss.takeDamage((boss.maxHealth * 0.4) / ENEMIES.remnant.armor, cellCenter(6, 2), "head");
    run(boss, perceive(6), 0.1);
    boss.takeDamage(boss.maxHealth * 10, cellCenter(6, 2), "head");
    expect(phases).toEqual([2]);
    expect(boss.isDead).toBe(true);
  });

  it("shrugs off hits to its hide and to a closed core", () => {
    const boss = spawn("remnant", 3) as RemnantBoss;
    const armor = ENEMIES.remnant.armor;
    boss.takeDamage(100, cellCenter(6, 2), "body");
    expect(boss.maxHealth - boss.health).toBeCloseTo(100 * armor);
    const before = boss.health;
    boss.takeDamage(100, cellCenter(6, 2), "head"); // core closed
    expect(before - boss.health).toBeCloseTo(100 * armor);
    expect(boss.isArmoured("head")).toBe(true);
    expect(boss.isArmoured("body")).toBe(true);
  });

  it("opens its core while it attacks", () => {
    const boss = spawn("remnant", 3) as RemnantBoss;
    // Standing within tendril reach: it wakes, winds up a slam, and the core opens.
    for (let i = 0; i < 300 && boss.isArmoured("head"); i++) boss.update(1 / 30, level, perceive(4));
    expect(boss.isArmoured("head")).toBe(false);
    expect(boss.isArmoured("body")).toBe(true);
  });

  it("summons help from phase 2", () => {
    const boss = spawn("remnant", 3) as RemnantBoss;
    let summons = 0;
    boss.onSummon = () => summons++;
    run(boss, perceive(6), 3);
    expect(summons).toBe(0);
    boss.takeDamage((boss.maxHealth * 0.4) / ENEMIES.remnant.armor, cellCenter(6, 2), "body");
    run(boss, perceive(6), 3);
    expect(summons).toBeGreaterThan(0);
  });
});
