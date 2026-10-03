import * as THREE from "three";
import type { Engine } from "../core/engine";
import type { QualityPreset } from "../core/quality";
import { LampSystem } from "../world/lamps";
import { buildLevel, type LevelData } from "../world/levelBuilder";
import { parseLevel } from "../world/levelParser";
import { LEVELS } from "../world/levels";
import { Effects } from "../fx/particles";
import { buildBody, type CreatureBody } from "../enemies/bodies";
import { enemyDef } from "../content/enemies";
import { planDressing } from "../world/dressing";
import type { SceneKind } from "../world/storyScenes";
import { hasLineOfSight, isSolid, worldToCell } from "../world/grid";

/**
 * The places the menu drifts through, one slow shot each: the story told
 * where it happened (see `storyScenes.ts`).
 */
const SHOTS: { level: string; scene: SceneKind }[] = [
  { level: "infirmary", scene: "listening" },
  { level: "cold-storage", scene: "yourName" },
  { level: "containment-labs", scene: "r7cell" },
  { level: "ventilation", scene: "camp1991" },
  { level: "hive", scene: "cocoons" },
  { level: "lift-shaft", scene: "charges" },
  { level: "pumping-station", scene: "hendricks" },
];
/** Seconds per shot, and of the fade in and out at each end. */
const SHOT_TIME = 16;
const FADE = 1.6;
/** Every other shot or so, someone is standing at the edge of the light for a moment. */
const GLIMPSE_CHANCE = 0.55;
const FLICKER_TIME = 0.75;
const LIGHT = 44;

interface Shot {
  from: THREE.Vector3;
  to: THREE.Vector3;
  look: THREE.Vector3;
}

/**
 * Behind the main menu: slow camera moves through the places the story
 * happened, fading through black from one to the next. In some of them the
 * light stutters, and when it steadies there is someone standing at the
 * edge of it; the next stutter, they're gone.
 */
export class MenuBackdrop {
  private lamps!: LampSystem;
  private effects!: Effects;
  private level!: LevelData;
  private light!: THREE.SpotLight;
  private shade!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private figure: CreatureBody | null = null;
  private shot: Shot | null = null;
  private index: number;
  private time = 0;
  /** Time into the current shot. */
  private t = 0;
  private glimpseAt = Infinity;
  private flicker = 0;
  private hideAt = Infinity;

  constructor(
    private readonly engine: Engine,
    private readonly quality: QualityPreset
  ) {
    this.index = Math.floor(Math.random() * SHOTS.length);
    this.load();
  }

  /** Builds the next shot's level and works out the camera move. Falls through to the next if a shot won't fit. */
  private load(): void {
    for (let tries = 0; tries < SHOTS.length; tries++) {
      const def = SHOTS[this.index % SHOTS.length];
      this.index++;
      const levelDef = LEVELS.find((l) => l.id === def.level);
      if (!levelDef) continue;
      this.engine.resetWorld();
      const level = buildLevel(this.engine.scene, parseLevel(levelDef), this.quality.bumpMaps);
      const scene = planDressing(level).scenes.find((s) => s.kind === def.scene);
      const shot = scene ? this.frame(level, scene.x, scene.z, scene.rot) : null;
      if (!shot) continue;
      this.level = level;
      this.shot = shot;
      this.lamps = new LampSystem(this.engine.scene, level.spawns.lamps, level.lampFixtures, this.quality.lampLights);
      this.effects = new Effects(this.engine.scene, this.quality.dustMotes);
      this.dress();
      this.t = 0;
      this.glimpseAt = Math.random() < GLIMPSE_CHANCE ? 4 + Math.random() * (SHOT_TIME - 9) : Infinity;
      this.hideAt = Infinity;
      this.flicker = 0;
      return;
    }
  }

  /**
   * A slow push towards a scene: from a few steps back and to one side, to
   * just in front of it, looking at the wall it stands against. Backs off
   * the distance until both ends are in open floor with a clear view.
   */
  private frame(level: LevelData, x: number, z: number, rot: number): Shot | null {
    const wall = new THREE.Vector2(Math.sin(rot), Math.cos(rot));
    const side = new THREE.Vector2(wall.y, -wall.x);
    const subject = new THREE.Vector2(x, z).addScaledVector(wall, 1.1);
    const open = (p: THREE.Vector2) => {
      const c = worldToCell(p.x, p.y);
      return !isSolid(level, c.col, c.row) && hasLineOfSight(level, p, subject);
    };
    for (const [back, sway] of [
      [4.4, 1.3],
      [3.8, 1.0],
      [3.2, 0.6],
      [2.8, 0.3],
      [2.4, 0],
    ]) {
      const a = new THREE.Vector2(x, z).addScaledVector(wall, -back).addScaledVector(side, sway);
      const b = new THREE.Vector2(x, z).addScaledVector(wall, -back * 0.55).addScaledVector(side, -sway * 0.3);
      if (!open(a) || !open(b)) continue;
      // Aim a little to the subject's left, so it sits right of centre, clear of the menu.
      const fwd = subject.clone().sub(b).normalize();
      const look = subject.clone().add(new THREE.Vector2(fwd.y, -fwd.x).multiplyScalar(0.9));
      return {
        from: new THREE.Vector3(a.x, 1.75, a.y),
        to: new THREE.Vector3(b.x, 1.5, b.y),
        look: new THREE.Vector3(look.x, 1.05, look.y),
      };
    }
    return null;
  }

  /** The camera's own dim torch and the black it fades through; rebuilt with each level (resetWorld clears the camera). */
  private dress(): void {
    const cam = this.engine.camera;
    this.light = new THREE.SpotLight(0xe8eeff, LIGHT, 20, Math.PI / 5, 0.7, 1.5);
    const target = new THREE.Object3D();
    target.position.set(0, -0.3, -5);
    cam.add(this.light, target);
    this.light.target = target;
    this.shade = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, depthTest: false, depthWrite: false })
    );
    this.shade.position.set(0, 0, -0.2);
    this.shade.renderOrder = 999;
    cam.add(this.shade);
    this.figure = buildBody(enemyDef("husk"));
    this.figure.group.visible = false;
    this.engine.scene.add(this.figure.group);
  }

  /** Puts the figure at the edge of the light, a few steps away, facing the camera. False if there's nowhere to stand. */
  private placeFigure(): boolean {
    if (!this.figure) return false;
    const cam = this.engine.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const base = Math.atan2(fwd.x, fwd.z);
    const me = new THREE.Vector2(cam.position.x, cam.position.z);
    for (let i = 0; i < 12; i++) {
      const a = base + (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2);
      const d = 2.6 + Math.random() * 2.4;
      const p = new THREE.Vector2(me.x + Math.sin(a) * d, me.y + Math.cos(a) * d);
      const c = worldToCell(p.x, p.y);
      if (isSolid(this.level, c.col, c.row) || !hasLineOfSight(this.level, me, p)) continue;
      const g = this.figure.group;
      g.position.set(p.x, 0, p.y);
      g.rotation.y = Math.atan2(me.x - p.x, me.y - p.y);
      g.visible = true;
      return true;
    }
    return false;
  }

  update(dt: number): void {
    this.time += dt;
    this.t += dt;
    if (this.t >= SHOT_TIME) this.load();
    const shot = this.shot;
    if (!shot) return;
    const cam = this.engine.camera;
    // A slow, eased push, with the faintest drift of a held camera.
    const k = this.t / SHOT_TIME;
    const e = k * k * (3 - 2 * k);
    cam.position.lerpVectors(shot.from, shot.to, e);
    cam.position.y += Math.sin(this.time * 0.7) * 0.015;
    cam.lookAt(shot.look.x + Math.sin(this.time * 0.31) * 0.08, shot.look.y + Math.sin(this.time * 0.43) * 0.04, shot.look.z);
    this.shade.material.opacity = Math.max(0, 1 - this.t / FADE, 1 - (SHOT_TIME - this.t) / FADE);

    this.lamps.update(dt, cam.position, this.time);
    this.updateGlimpse(dt);
    this.effects.update(dt, cam, 0.8, this.time);
    this.engine.setPostFx(0, 0, this.time);
  }

  /** The light stutters; in the dark the figure arrives, or goes. */
  private updateGlimpse(dt: number): void {
    if (this.t >= this.glimpseAt && this.flicker <= 0) {
      this.flicker = FLICKER_TIME;
      this.glimpseAt = Infinity;
    }
    if (this.t >= this.hideAt && this.flicker <= 0) {
      this.flicker = FLICKER_TIME * 0.6;
      this.hideAt = Infinity;
    }
    const fig = this.figure;
    if (this.flicker > 0) {
      const was = this.flicker;
      this.flicker -= dt;
      if (was > FLICKER_TIME * 0.3 && this.flicker <= FLICKER_TIME * 0.3 && fig) {
        if (fig.group.visible) fig.group.visible = false;
        else if (this.placeFigure()) this.hideAt = Math.min(SHOT_TIME - FADE - 0.5, this.t + 1.4 + Math.random() * 1.4);
      }
      this.light.intensity =
        this.flicker > FLICKER_TIME * 0.2 && this.flicker < FLICKER_TIME * 0.45 ? 0 : Math.random() < 0.45 ? LIGHT * 0.15 : LIGHT;
    } else this.light.intensity = LIGHT;
    if (fig?.group.visible) {
      fig.pose({ time: this.time, speed: 0, walkPhase: 0, hunting: false, attack: null, stagger: 0, frozen: false });
      fig.glow(0, 0, this.time);
    }
  }
}
