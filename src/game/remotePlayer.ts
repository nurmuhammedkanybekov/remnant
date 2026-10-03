import { beamMaterial, beamMesh } from "../fx/beams";
import * as THREE from "three";
import { textures } from "../fx/textures";
import { isCharacterLook, LOOKS, type CharacterLook } from "../content/characters";
import type { PlayerState } from "../net/protocol";
import { buildCharacter } from "./characterModel";
import type { Gait } from "../player/playerController";

const STAND_EYE = 1.7;
const TORCH_INTENSITY = 22;
/** Snaps instead of gliding if a state lands this far away (a respawn or a teleport). */
const SNAP_DISTANCE = 4;
const MUZZLE_TIME = 0.06;

/**
 * The other player, as you see them: a figure in their chosen look (see
 * `characterModel.ts`), hard hat and headlamp on, walking, crouching, firing and falling down
 * according to the states that arrive 20 times a second.
 *
 * Their torch is a real light, so their beam lights up the corridor for
 * you too.
 */
export class RemotePlayer {
  /** Smoothed feet position (y = 0) and look. */
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  state: PlayerState | null = null;
  /** Fired every stride, for footsteps. */
  onFootstep: ((gait: Gait, wet: boolean, at: THREE.Vector2) => void) | null = null;

  private readonly root = new THREE.Group();
  /** Their whole figure (for shadows). */
  get figure(): THREE.Object3D {
    return this.root;
  }
  private readonly body = new THREE.Group();
  private hips = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private arms = new THREE.Group();
  private readonly lamp: THREE.SpotLight;
  private readonly beam = beamMaterial(0xe8eeff, 0);
  private readonly lampTarget = new THREE.Object3D();
  private readonly lens: THREE.MeshBasicMaterial;
  private readonly flash: THREE.Sprite;
  private readonly flashLight: THREE.PointLight;
  private readonly marker: THREE.Sprite;
  private readonly tag: THREE.Sprite;
  private look: CharacterLook | null = null;
  private eye = STAND_EYE;
  private walkPhase = 0;
  private stride = 0;
  private speed = 0;
  private downK = 0;
  private muzzleTime = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.lens = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textures().flash,
        color: 0xffd8a0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.flash.scale.setScalar(0.45);
    this.flash.position.set(0, 0.03, -0.72);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffb060, 0, 10, 1.6);
    this.flashLight.position.copy(this.flash.position);

    // Their headlamp: a real light, aimed where they look.
    this.lamp = new THREE.SpotLight(0xe8eeff, 0, 26, Math.PI / 6.5, 0.6, 0.9);
    this.lamp.position.set(0, 0.25, -0.16);
    this.lampTarget.position.set(0, 0.25, -6);
    this.lamp.target = this.lampTarget;

    this.root.add(this.body);

    // A faint glow above them, so you can find each other in the dark.
    this.marker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textures().glow,
        color: 0x7ab8ff,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.marker.scale.setScalar(0.22);
    this.marker.position.y = 2.2;
    this.root.add(this.marker);

    // Their name over their head, the same size on screen at any distance
    // and seen through walls, fading out when they're right beside you or far off.
    this.tag = new THREE.Sprite(
      new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false })
    );
    this.tag.position.y = 2.42;
    this.tag.renderOrder = 10;
    this.tag.onBeforeRender = (_r, _s, camera) => {
      const d = camera.getWorldPosition(tagTmp).distanceTo(this.root.getWorldPosition(tagTmp2));
      this.tag.material.opacity = this.present
        ? THREE.MathUtils.clamp((d - 2.5) / 2, 0, 1) * THREE.MathUtils.clamp((45 - d) / 15, 0, 1)
        : 0;
    };
    this.root.add(this.tag);

    // The figure stays in the scene from the level's start, lights and all
    // (at zero until they're here), so the renderer's light count never
    // changes mid-level: a change would recompile every shader, a visible freeze.
    this.setLook("light");
    this.showFigure(false);
    this.root.rotation.order = "YXZ";
    scene.add(this.root);
  }

  /** Dresses the figure in the partner's chosen look (rebuilt only when it changes). */
  setLook(look: CharacterLook): void {
    if (look === this.look) return;
    this.look = look;
    for (const c of [...this.body.children]) this.body.remove(c);
    const parts = buildCharacter(LOOKS[look]);
    ({ hips: this.hips, legL: this.legL, legR: this.legR, torso: this.torso, head: this.head, arms: this.arms } = parts);
    this.body.add(parts.hips, parts.torso);
    this.body.scale.setScalar(LOOKS[look].height);
    this.head.add(this.lamp, this.lampTarget, lensMesh(this.lens));
    // Their beam, visible in the dust: you see where your partner is looking.
    const beam = beamMesh(0.05, 1.5, 7, this.beam);
    beam.rotation.x = Math.PI / 2;
    beam.position.set(0, 0.25, -0.16 - 3.5);
    this.head.add(beam);
    this.arms.add(this.flash, this.flashLight);
    this.tag.material.map?.dispose();
    this.tag.material.map = nameTexture(LOOKS[look].firstName, LOOKS[look].accent);
    this.tag.material.needsUpdate = true;
    this.tag.scale.set(0.16, 0.04, 1);
    (this.marker.material as THREE.SpriteMaterial).color.set(LOOKS[look].accent);
  }

  /** They're in the level (their state has arrived and they haven't left). */
  get visible(): boolean {
    return this.present;
  }
  private present = false;

  get position2D(): THREE.Vector2 {
    return new THREE.Vector2(this.position.x, this.position.z);
  }

  /** Where their eyes are, for creatures that look for their torch beam. */
  get eyePosition(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.eye, this.position.z);
  }

  get lookDirection(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
  }

  get down(): boolean {
    return this.state?.down ?? false;
  }

  apply(s: PlayerState): void {
    if (!this.state || Math.hypot(s.x - this.position.x, s.z - this.position.z) > SNAP_DISTANCE) {
      this.position.set(s.x, 0, s.z);
      this.yaw = s.yaw;
      this.pitch = s.pitch;
    }
    const wasHidden = this.state?.hid ?? false;
    this.state = s;
    if (isCharacterLook(s.look)) this.setLook(s.look);
    if (!this.present || wasHidden !== !!s.hid) this.showFigure(!s.hid);
    this.present = true;
  }

  /** Shows or hides their body and marker, leaving the lights (at zero when hidden) where they are. */
  private showFigure(v: boolean): void {
    this.body.traverse((o) => {
      if ((o instanceof THREE.Mesh || o instanceof THREE.Sprite) && o !== this.flash) o.visible = v;
    });
    this.marker.visible = v;
  }

  /** They fired. */
  fired(): void {
    this.muzzleTime = MUZZLE_TIME;
  }

  update(dt: number, time: number): void {
    const s = this.state;
    if (!s) return;
    const k = 1 - Math.exp(-14 * dt);
    const before = this.position2D;
    this.position.x += (s.x - this.position.x) * k;
    this.position.z += (s.z - this.position.z) * k;
    this.yaw += wrap(s.yaw - this.yaw) * k;
    this.pitch += (s.pitch - this.pitch) * k;
    this.eye += (s.y - this.eye) * k;

    const moved = this.position2D.distanceTo(before);
    this.speed += (moved / Math.max(dt, 1e-6) - this.speed) * Math.min(1, dt * 8);
    if (s.gait !== "still" && !s.down) {
      this.stride += moved;
      const len = s.gait === "sprint" ? 2.2 : s.gait === "crouch" ? 1.1 : 1.7;
      if (this.stride > len) {
        this.stride = 0;
        this.onFootstep?.(s.gait, s.wet, this.position2D);
      }
    }

    // --- pose
    this.downK += ((s.down ? 1 : 0) - this.downK) * Math.min(1, dt * 4);
    const crouch = THREE.MathUtils.clamp((STAND_EYE - this.eye) / (STAND_EYE - 1.05), 0, 1);
    this.walkPhase += dt * this.speed * 2.6;
    const swing = Math.sin(this.walkPhase) * Math.min(1, this.speed / 3) * 0.6 * (1 - this.downK);
    this.legL.rotation.x = swing - crouch * 0.9;
    this.legR.rotation.x = -swing - crouch * 0.9;
    this.hips.position.y = -crouch * 0.3;
    this.torso.position.y = 0.92 - crouch * 0.3;
    this.torso.rotation.x = -crouch * 0.25;
    this.head.rotation.x = this.pitch * 0.6;
    this.arms.rotation.x = this.pitch * 0.9 + crouch * 0.25;
    // Down: on their back on the floor, head still turning.
    this.body.rotation.x = -this.downK * (Math.PI / 2 - 0.1);
    this.body.position.y = this.downK * 0.15;
    this.root.position.set(this.position.x, 0, this.position.z);
    this.root.rotation.y = this.yaw;

    // --- lights
    this.lamp.intensity = s.torch * TORCH_INTENSITY;
    this.beam.uniforms.uStrength.value = s.torch * 0.1;
    this.lens.color.setScalar(0.25 + s.torch * 0.75);
    this.muzzleTime -= dt;
    const firing = this.muzzleTime > 0;
    this.flash.visible = firing && s.weapon !== "rivet";
    this.flash.material.rotation = time * 40;
    this.flashLight.intensity = this.flash.visible ? 30 : 0;
    // Pulses red while they're down.
    const mm = this.marker.material;
    mm.color.set(s.down ? 0xff4030 : this.look ? LOOKS[this.look].accent : 0x7ab8ff);
    mm.opacity = s.down ? 0.45 + 0.35 * Math.sin(time * 5) : 0.3;
  }

  /** The partner left: hide them and put out their lights. */
  hide(): void {
    this.present = false;
    this.showFigure(false);
    this.lamp.intensity = 0;
    this.flashLight.intensity = 0;
    this.state = null;
  }

  dispose(): void {
    this.scene.remove(this.root);
  }
}

const tagTmp = new THREE.Vector3();
const tagTmp2 = new THREE.Vector3();

/** A name tag: their first name in their colour, on a dark band. */
function nameTexture(name: string, color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.fillRect(28, 12, 200, 40);
  g.font = "600 30px 'Courier New', monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(name.toUpperCase(), 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The headlamp's glass, on the front of the hard hat. */
function lensMesh(mat: THREE.MeshBasicMaterial): THREE.Mesh {
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), mat);
  lens.position.set(0, 0.25, -0.175);
  lens.rotation.y = Math.PI;
  return lens;
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
