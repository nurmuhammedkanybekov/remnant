import * as THREE from "three";
import { enemyDef, type EnemyKind } from "../content/enemies";
import { buildBody, type CreatureBody } from "../enemies/bodies";
import { hasLineOfSight, type LevelGrid } from "./grid";

/** Gone if you come closer than this (world units)... */
const NEAR = 7;
/** ...or catch it in your light from closer than this... */
const LIT_RANGE = 24;
/** ...or after this long, whether or not you saw it. */
const LIFETIME = 30;

/**
 * Something standing where nothing should be. It doesn't hunt, doesn't make
 * a sound, can't be shot and can't hurt you: it's a creature's body, posed
 * and still, and it is gone the moment you look at it properly, put your
 * light on it or walk up to it. Placed by level scripts at the moments the
 * story wants you to doubt your eyes. `facing` "away" stands it with its
 * back to you (the villagers in the street); "toward" has it watching you.
 */
export class Apparition {
  private readonly root = new THREE.Group();
  private readonly body: CreatureBody;
  private age = 0;
  private gone = false;

  constructor(
    scene: THREE.Scene,
    kind: EnemyKind,
    private readonly pos: THREE.Vector2,
    private readonly facing: "toward" | "away"
  ) {
    this.body = buildBody(enemyDef(kind));
    // A faint pallor of its own, so in a dark room it's a shape and not nothing. Its own copies of
    // the materials, so the real creatures of this kind are untouched.
    this.body.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const tint = (m: THREE.Material) => {
        const c = m.clone();
        if (c instanceof THREE.MeshStandardMaterial) {
          c.emissive.setRGB(0.3, 0.25, 0.25);
          c.emissiveIntensity = 1;
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
    });
    this.root.add(this.body.group);
    this.root.position.set(pos.x, 0, pos.y);
    scene.add(this.root);
  }

  get finished(): boolean {
    return this.gone;
  }

  /**
   * One frame. `lit` is whether the player's torch is on and bright;
   * `view` the direction they're looking (horizontal). Returns true on the
   * frame it vanishes, so the session can play whatever goes with that.
   */
  update(dt: number, time: number, level: LevelGrid, player: THREE.Vector2, view: THREE.Vector2, lit: boolean): boolean {
    if (this.gone) return false;
    this.age += dt;
    const to = this.pos.clone().sub(player);
    const d = to.length();
    const yaw = Math.atan2(-to.x, -to.y);
    this.root.rotation.y = this.facing === "toward" ? yaw : yaw + Math.PI;
    this.body.pose({ time, speed: 0, walkPhase: 0, hunting: false, attack: null, stagger: 0, frozen: true });
    // The eyes and veins faintly lit: in the dark, that's all of it you see.
    this.body.glow(0, 0.7, time);
    const inBeam = lit && d < LIT_RANGE && d > 0.01 && to.divideScalar(d).dot(view) > Math.cos(THREE.MathUtils.degToRad(11));
    if (d < NEAR || this.age > LIFETIME || (inBeam && hasLineOfSight(level, player, this.pos))) {
      this.vanish();
      return true;
    }
    return false;
  }

  vanish(): void {
    if (this.gone) return;
    this.gone = true;
    this.root.removeFromParent();
    // Its own material copies go with it (the geometry is the creature kind's, shared).
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    });
  }
}
