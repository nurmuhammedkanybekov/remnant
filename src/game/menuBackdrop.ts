import * as THREE from "three";
import type { Engine } from "../core/engine";
import type { QualityPreset } from "../core/quality";
import { LampSystem } from "../world/lamps";
import { buildLevel } from "../world/levelBuilder";
import type { LevelDef } from "../world/levelDef";
import { parseLevel } from "../world/levelParser";
import { Effects } from "../fx/particles";
import { buildBody, type CreatureBody } from "../enemies/bodies";
import { enemyDef } from "../content/enemies";
import { isSolid, raycastWorld, worldToCell } from "../world/grid";
import type { ParsedLevel } from "../world/levelParser";

/** Seconds between glimpses, at random in this range. */
const GLIMPSE_EVERY: [number, number] = [18, 38];
/** How long the light stutters each time. */
const FLICKER_TIME = 0.75;
const LIGHT = 30;

/**
 * A slowly turning, dimly lit view of a level behind the main menu. Every
 * so often the light stutters, and when it steadies there is someone
 * standing at the end of the corridor. The next stutter, they're gone.
 */
export class MenuBackdrop {
  private readonly lamps: LampSystem;
  private readonly effects: Effects;
  private readonly level: ParsedLevel;
  private readonly light: THREE.SpotLight;
  private readonly figure: CreatureBody;
  private yaw = -Math.PI / 2;
  private time = 0;
  /** When the next glimpse starts, how long the light has left to stutter, and when the figure goes. */
  private nextGlimpse = 12 + Math.random() * 10;
  private flicker = 0;
  private hideAt = Infinity;

  constructor(
    private readonly engine: Engine,
    def: LevelDef,
    quality: QualityPreset
  ) {
    engine.resetWorld();
    const level = buildLevel(engine.scene, parseLevel(def), quality.bumpMaps);
    this.level = level;
    this.lamps = new LampSystem(engine.scene, level.spawns.lamps, level.lampFixtures, quality.lampLights);
    this.effects = new Effects(engine.scene, quality.dustMotes);

    const s = level.spawns.playerStart;
    const cam = engine.camera;
    cam.position.set(s.x + 1, 1.6, s.y);
    cam.rotation.set(0, this.yaw, 0, "YXZ");
    // A dim "flashlight" so the scene isn't pitch black.
    const light = new THREE.SpotLight(0xe8eeff, LIGHT, 20, Math.PI / 5, 0.7, 1.5);
    this.light = light;
    const target = new THREE.Object3D();
    target.position.set(0, -0.3, -5);
    cam.add(light, target);
    light.target = target;

    this.figure = buildBody(enemyDef("husk"));
    this.figure.group.visible = false;
    engine.scene.add(this.figure.group);
  }

  /** Puts the figure down the corridor ahead, facing the camera. False if there's no room for it. */
  private placeFigure(): boolean {
    const cam = this.engine.camera;
    const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const from = cam.position.clone().setY(1);
    const wall = raycastWorld(this.level, from, dir, 30);
    const room = (wall?.distance ?? 30) - 1.2;
    if (room < 6) return false;
    const d = Math.min(room, 6 + Math.random() * 4);
    const x = from.x + dir.x * d;
    const z = from.z + dir.z * d;
    const c = worldToCell(x, z);
    if (isSolid(this.level, c.col, c.row)) return false;
    const g = this.figure.group;
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(cam.position.x - x, cam.position.z - z);
    g.visible = true;
    return true;
  }

  update(dt: number): void {
    this.time += dt;
    this.yaw += dt * 0.08;
    const cam = this.engine.camera;
    cam.rotation.set(Math.sin(this.time * 0.3) * 0.05 - 0.05, this.yaw, 0, "YXZ");
    this.lamps.update(dt, cam.position, this.time);

    // The glimpse: the light stutters, and the figure comes or goes in the dark.
    if (this.time >= this.nextGlimpse && this.flicker <= 0) {
      this.flicker = FLICKER_TIME;
      this.nextGlimpse = this.time + GLIMPSE_EVERY[0] + Math.random() * (GLIMPSE_EVERY[1] - GLIMPSE_EVERY[0]);
    }
    if (this.time >= this.hideAt && this.flicker <= 0) {
      this.flicker = FLICKER_TIME * 0.6;
      this.hideAt = Infinity;
    }
    if (this.flicker > 0) {
      const was = this.flicker;
      this.flicker -= dt;
      // Halfway through the stutter, in the dark: swap.
      if (was > FLICKER_TIME * 0.3 && this.flicker <= FLICKER_TIME * 0.3) {
        if (this.figure.group.visible) this.figure.group.visible = false;
        else if (this.placeFigure()) this.hideAt = this.time + 1.4 + Math.random() * 1.4;
      }
      this.light.intensity =
        this.flicker > FLICKER_TIME * 0.2 && this.flicker < FLICKER_TIME * 0.45 ? 0 : Math.random() < 0.45 ? LIGHT * 0.15 : LIGHT;
    } else this.light.intensity = LIGHT;
    if (this.figure.group.visible) {
      this.figure.pose({ time: this.time, speed: 0, walkPhase: 0, hunting: false, attack: null, stagger: 0, frozen: false });
      this.figure.glow(0, 0, this.time);
    }
    this.effects.update(dt, cam, 0.8, this.time);
    this.engine.setPostFx(0, 0, this.time);
  }
}
