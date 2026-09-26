import * as THREE from "three";
import type { Engine } from "../core/engine";
import { LampSystem } from "../world/lamps";
import { buildLevel } from "../world/levelBuilder";
import type { LevelDef } from "../world/levelDef";
import { parseLevel } from "../world/levelParser";
import { Effects } from "../fx/particles";

/** A slowly turning, dimly lit view of a level behind the main menu. */
export class MenuBackdrop {
  private readonly lamps: LampSystem;
  private readonly effects: Effects;
  private yaw = -Math.PI / 2;
  private time = 0;

  constructor(
    private readonly engine: Engine,
    def: LevelDef
  ) {
    engine.resetWorld();
    const level = buildLevel(engine.scene, parseLevel(def));
    this.lamps = new LampSystem(engine.scene, level.spawns.lamps, level.lampFixtures);
    this.effects = new Effects(engine.scene);

    const s = level.spawns.playerStart;
    const cam = engine.camera;
    cam.position.set(s.x + 1, 1.6, s.y);
    cam.rotation.set(0, this.yaw, 0, "YXZ");
    // A dim "flashlight" so the scene isn't pitch black.
    const light = new THREE.SpotLight(0xe8eeff, 30, 20, Math.PI / 5, 0.7, 1.5);
    const target = new THREE.Object3D();
    target.position.set(0, -0.3, -5);
    cam.add(light, target);
    light.target = target;
  }

  update(dt: number): void {
    this.time += dt;
    this.yaw += dt * 0.08;
    const cam = this.engine.camera;
    cam.rotation.set(Math.sin(this.time * 0.3) * 0.05 - 0.05, this.yaw, 0, "YXZ");
    this.lamps.update(dt, cam.position, this.time);
    this.effects.update(dt, cam, 0.8, this.time);
    this.engine.setPostFx(0, 0, this.time);
  }
}
