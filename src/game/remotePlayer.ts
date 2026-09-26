import * as THREE from "three";
import { textures } from "../fx/textures";
import type { PlayerState } from "../net/protocol";
import type { Gait } from "../player/playerController";

const STAND_EYE = 1.7;
const TORCH_INTENSITY = 22;
/** Snaps instead of gliding if a state lands this far away (a respawn or a teleport). */
const SNAP_DISTANCE = 4;
const MUZZLE_TIME = 0.06;

/**
 * The other player, as you see them: a figure in a work coverall and a
 * hard hat with a headlamp, walking, crouching, firing and falling down
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
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms = new THREE.Group();
  private readonly lamp: THREE.SpotLight;
  private readonly lampTarget = new THREE.Object3D();
  private readonly lens: THREE.MeshBasicMaterial;
  private readonly flash: THREE.Sprite;
  private readonly flashLight: THREE.PointLight;
  private readonly marker: THREE.Sprite;
  private eye = STAND_EYE;
  private walkPhase = 0;
  private stride = 0;
  private speed = 0;
  private downK = 0;
  private muzzleTime = 0;

  constructor(private readonly scene: THREE.Scene) {
    const coverall = new THREE.MeshStandardMaterial({ color: 0x4a4f3c, roughness: 0.85 });
    const vest = new THREE.MeshStandardMaterial({ color: 0xa8741a, roughness: 0.7, emissive: 0x1a0f00 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.6, metalness: 0.3 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x9a7a66, roughness: 0.8 });
    const helmet = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.45 });
    const box = (w: number, h: number, d: number, m: THREE.Material, y = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.y = y;
      return mesh;
    };

    // Legs hang from the hips, so rotating a leg group swings it.
    const leg = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.92, 0);
      g.add(box(0.17, 0.5, 0.2, coverall, -0.25));
      const shin = box(0.15, 0.46, 0.17, coverall, -0.7);
      g.add(shin);
      const boot = box(0.17, 0.12, 0.3, dark, -0.9);
      boot.position.z = -0.05;
      g.add(boot);
      this.hips.add(g);
      return g;
    };
    this.legL = leg(-0.11);
    this.legR = leg(0.11);
    this.body.add(this.hips);

    this.torso.position.y = 0.92;
    this.torso.add(box(0.44, 0.58, 0.26, coverall, 0.3));
    this.torso.add(box(0.46, 0.4, 0.28, vest, 0.38));
    const pack = box(0.34, 0.4, 0.14, dark, 0.35);
    pack.position.z = 0.2;
    this.torso.add(pack);

    // Head: face, hard hat, headlamp.
    this.head.position.y = 0.72;
    this.head.add(box(0.2, 0.24, 0.22, skin, 0.1));
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
    hat.position.y = 0.18;
    hat.scale.set(1, 0.8, 1.1);
    this.head.add(hat);
    this.head.add(box(0.36, 0.02, 0.36, helmet, 0.18));
    this.lens = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), this.lens);
    lens.position.set(0, 0.24, -0.16);
    lens.rotation.y = Math.PI;
    this.head.add(lens);
    this.torso.add(this.head);

    // Arms out front, holding the gun.
    this.arms.position.y = 0.5;
    for (const x of [-0.2, 0.2]) {
      const arm = box(0.11, 0.11, 0.42, coverall);
      arm.position.set(x * 0.8, 0, -0.2);
      arm.rotation.y = -x * 0.6;
      this.arms.add(arm);
    }
    const gun = box(0.07, 0.12, 0.34, dark);
    gun.position.set(0, 0.03, -0.46);
    this.arms.add(gun);
    this.torso.add(this.arms);
    this.body.add(this.torso);
    this.root.add(this.body);

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
    this.flash.position.set(0, 0.03, -0.7);
    this.flash.visible = false;
    this.arms.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 10, 1.6);
    this.flashLight.position.copy(this.flash.position);
    this.arms.add(this.flashLight);

    // Their headlamp: a real light, aimed where they look.
    this.lamp = new THREE.SpotLight(0xe8eeff, 0, 26, Math.PI / 6.5, 0.6, 0.9);
    this.lamp.position.set(0, 0.24, -0.16);
    this.lampTarget.position.set(0, 0.24, -6);
    this.head.add(this.lamp, this.lampTarget);
    this.lamp.target = this.lampTarget;

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
    this.marker.scale.setScalar(0.35);
    this.marker.position.y = 2.25;
    this.root.add(this.marker);

    this.root.visible = false;
    this.root.rotation.order = "YXZ";
    scene.add(this.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

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
    this.state = s;
    this.root.visible = true;
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
    this.lens.color.setScalar(0.25 + s.torch * 0.75);
    this.muzzleTime -= dt;
    const firing = this.muzzleTime > 0;
    this.flash.visible = firing && s.weapon !== "rivet";
    this.flash.material.rotation = time * 40;
    this.flashLight.intensity = this.flash.visible ? 30 : 0;
    // Pulses red while they're down.
    const mm = this.marker.material;
    mm.color.set(s.down ? 0xff4030 : 0x7ab8ff);
    mm.opacity = s.down ? 0.45 + 0.35 * Math.sin(time * 5) : 0.3;
  }

  /** The partner left: hide them and put out their lights. */
  hide(): void {
    this.root.visible = false;
    this.lamp.intensity = 0;
    this.flashLight.intensity = 0;
    this.state = null;
  }

  dispose(): void {
    this.scene.remove(this.root);
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
