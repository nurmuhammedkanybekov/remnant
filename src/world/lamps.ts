import * as THREE from "three";
import { WALL_HEIGHT } from "./grid";
import type { LampFixture } from "./levelBuilder";
import type { LampSpawn } from "./levelParser";

const POOL_SIZE = 6;
const MAX_LIGHT_DIST = 26;

type Mode = "steady" | "flicker" | "dying" | "pulse";

interface Lamp {
  spawn: LampSpawn;
  fixture: LampFixture | undefined;
  mode: Mode;
  brightness: number;
  timer: number;
  phase: number;
  baseColor: THREE.Color;
}

/**
 * Levels can have many lamps, but every extra real-time light makes every
 * fragment shader slower (and changing the light count forces a shader
 * recompile = stutter). So we keep a FIXED pool of point lights and hand
 * them to whichever lamps are nearest the player each frame. Distant lamps
 * still show their glowing fixture + halo, they just don't cast light.
 */
export class LampSystem {
  private readonly lamps: Lamp[];
  private readonly pool: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene, spawns: LampSpawn[], fixtures: LampFixture[] = []) {
    this.lamps = spawns.map((spawn, i) => ({
      spawn,
      fixture: fixtures[i],
      mode: spawn.emergency ? "pulse" : (["steady", "steady", "flicker", "steady", "dying"] as Mode[])[i % 5],
      brightness: 1,
      timer: Math.random(),
      phase: Math.random() * Math.PI * 2,
      baseColor: new THREE.Color(spawn.color),
    }));
    for (let i = 0; i < POOL_SIZE; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 11, 1.6);
      l.position.set(0, -100, 0);
      scene.add(l);
      this.pool.push(l);
    }
  }

  update(dt: number, player: THREE.Vector3, time: number): void {
    for (const lamp of this.lamps) {
      lamp.timer -= dt;
      switch (lamp.mode) {
        case "steady":
          lamp.brightness = 0.95 + Math.sin(time * 50 + lamp.phase) * 0.03;
          break;
        case "pulse":
          lamp.brightness = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(time * 2.2 + lamp.phase), 2);
          break;
        case "flicker":
          if (lamp.timer <= 0) {
            lamp.timer = 0.03 + Math.random() * 0.25;
            lamp.brightness = Math.random() < 0.25 ? 0.1 : 1;
          }
          break;
        case "dying":
          if (lamp.timer <= 0) {
            // Mostly dark, with occasional bursts of stuttering light.
            const on = lamp.brightness < 0.5 ? Math.random() < 0.18 : Math.random() < 0.55;
            lamp.brightness = on ? 0.8 : 0.02;
            lamp.timer = on ? 0.04 + Math.random() * 0.12 : 0.2 + Math.random() * 1.8;
          }
          break;
      }
      if (lamp.fixture) {
        (lamp.fixture.mesh.material as THREE.MeshBasicMaterial).color.copy(lamp.baseColor).multiplyScalar(0.15 + lamp.brightness);
        lamp.fixture.halo.material.opacity = (lamp.spawn.emergency ? 0.5 : 0.35) * lamp.brightness;
      }
    }

    // Assign pooled lights to the nearest lamps.
    const sorted = this.lamps
      .map((l) => ({ l, d: Math.hypot(l.spawn.pos.x - player.x, l.spawn.pos.y - player.z) }))
      .filter((x) => x.d < MAX_LIGHT_DIST)
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length; i++) {
      const light = this.pool[i];
      const entry = sorted[i];
      if (!entry) {
        light.intensity = 0;
        continue;
      }
      const { l, d } = entry;
      light.position.set(l.spawn.pos.x, WALL_HEIGHT - 0.35, l.spawn.pos.y);
      light.color.copy(l.baseColor);
      // Fade out near the cutoff so lights don't visibly "pop" when reassigned.
      const fade = THREE.MathUtils.clamp((MAX_LIGHT_DIST - d) / 6, 0, 1);
      light.intensity = (l.spawn.emergency ? 14 : 18) * l.brightness * fade;
    }
  }
}
