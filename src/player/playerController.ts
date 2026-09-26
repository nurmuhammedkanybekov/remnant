import * as THREE from "three";
import { resolveCollision, type LevelGrid } from "../world/grid";
import type { PlayerCommand } from "./command";
import { Health } from "./health";
import { Flashlight } from "./flashlight";

const WALK_SPEED = 3.3;
const SPRINT_SPEED = 5.8;
const CROUCH_SPEED = 1.7;
const ACCEL = 14;
const RADIUS = 0.35;
const STAND_HEIGHT = 1.7;
const CROUCH_HEIGHT = 1.05;
export const MAX_STAMINA = 100;
const STAMINA_DRAIN_PER_SEC = 20;
const STAMINA_REGEN_PER_SEC = 16;
const EXHAUSTED_UNTIL = 25; // after emptying stamina you can't sprint again until it refills to this

/** How far (world units) enemies can hear each movement mode, before walls muffle it. */
export const NOISE_RADIUS = { still: 0, crouch: 1.6, walk: 5.5, sprint: 12 } as const;
export type Gait = keyof typeof NOISE_RADIUS;

export class PlayerController {
  readonly health = new Health(100);
  readonly flashlight: Flashlight;
  /** Logical position (feet at y=0 → eye height in y). Camera adds bob/shake on top. */
  readonly position = new THREE.Vector3();
  stamina = MAX_STAMINA;
  gait: Gait = "still";
  private exhausted = false;
  private yaw = 0;
  private pitch = 0;
  /** This frame's look change in radians (turn right +, tilt down +), for weapon and beam sway. */
  readonly lookDelta = new THREE.Vector2();
  private velocity = new THREE.Vector2();
  private eyeHeight = STAND_HEIGHT;
  private bobPhase = 0;
  private bobAmount = 0;
  private footstepDistance = 0;
  private trauma = 0; // camera shake 0..1
  private recoil = 0; // extra pitch from firing, recovers over time
  private roll = 0;
  onFootstep: ((gait: Gait) => void) | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly level: LevelGrid,
    start: THREE.Vector2,
    yaw: number
  ) {
    this.camera.rotation.order = "YXZ";
    this.position.set(start.x, STAND_HEIGHT, start.y);
    this.yaw = yaw;
    this.flashlight = new Flashlight(camera);
    this.applyCamera(0);
  }

  get position2D(): THREE.Vector2 {
    return new THREE.Vector2(this.position.x, this.position.z);
  }

  get isSprinting(): boolean {
    return this.gait === "sprint";
  }

  get noiseRadius(): number {
    return NOISE_RADIUS[this.gait];
  }

  /** 0..1 — current movement speed relative to sprint, used for weapon sway and spread. */
  get moveFactor(): number {
    return Math.min(1, this.velocity.length() / SPRINT_SPEED);
  }

  get facing(): number {
    return this.yaw;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  addRecoil(amount: number): void {
    this.recoil += amount;
  }

  update(dt: number, cmd: PlayerCommand): void {
    this.health.update(dt);

    // --- Look ---
    this.lookDelta.set(cmd.turn, cmd.tilt);
    this.yaw -= cmd.turn;
    this.pitch = THREE.MathUtils.clamp(this.pitch - cmd.tilt, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);

    // --- Move intent (mz is negative forward, matching camera space) ---
    let mx = THREE.MathUtils.clamp(cmd.moveX, -1, 1);
    let mz = -THREE.MathUtils.clamp(cmd.moveY, -1, 1);
    const wantsMove = mx !== 0 || mz !== 0;
    const crouching = cmd.crouch;

    if (this.stamina <= 0) this.exhausted = true;
    if (this.exhausted && this.stamina >= EXHAUSTED_UNTIL) this.exhausted = false;
    const sprinting = cmd.sprint && wantsMove && mz < 0 && !crouching && !this.exhausted;

    this.stamina = sprinting
      ? Math.max(0, this.stamina - STAMINA_DRAIN_PER_SEC * dt)
      : Math.min(MAX_STAMINA, this.stamina + STAMINA_REGEN_PER_SEC * dt * (crouching || !wantsMove ? 1.3 : 1));

    const speed = crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
    const target = new THREE.Vector2();
    if (wantsMove) {
      const len = Math.hypot(mx, mz);
      mx /= len;
      mz /= len;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      target.set((fx * -mz + rx * mx) * speed, (fz * -mz + rz * mx) * speed);
    }
    // Smooth acceleration so movement has a little weight.
    const k = 1 - Math.exp(-ACCEL * dt);
    this.velocity.lerp(target, k);

    const dx = this.velocity.x * dt;
    const dz = this.velocity.y * dt;
    const resolved = resolveCollision(this.level, this.position.x, this.position.z, dx, dz, RADIUS);
    const realDx = resolved.x - this.position.x;
    const realDz = resolved.z - this.position.z;
    const moved = Math.hypot(realDx, realDz);
    this.position.x = resolved.x;
    this.position.z = resolved.z;
    // Velocity becomes what actually happened: the into-wall component is
    // dropped, the along-wall component is kept, so you slide instead of stick.
    if (dt > 0) this.velocity.set(realDx / dt, realDz / dt);

    const actuallyMoving = moved / Math.max(dt, 1e-6) > 0.4;
    this.gait = !actuallyMoving ? "still" : crouching ? "crouch" : sprinting ? "sprint" : "walk";

    // --- Footsteps ---
    if (actuallyMoving) {
      this.footstepDistance += moved;
      const stride = this.gait === "sprint" ? 2.2 : this.gait === "crouch" ? 1.1 : 1.7;
      if (this.footstepDistance > stride) {
        this.footstepDistance = 0;
        this.onFootstep?.(this.gait);
      }
    }

    // --- Eye height, bob, sway ---
    const targetEye = crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
    this.eyeHeight = THREE.MathUtils.lerp(this.eyeHeight, targetEye, 1 - Math.exp(-10 * dt));
    this.position.y = this.eyeHeight;

    const speedNow = this.velocity.length();
    this.bobPhase += dt * (speedNow * 2.1);
    this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, actuallyMoving ? Math.min(1, speedNow / WALK_SPEED) : 0, 1 - Math.exp(-8 * dt));
    // Lean into strafes slightly.
    const strafe = mx * (wantsMove ? 1 : 0);
    this.roll = THREE.MathUtils.lerp(this.roll, -strafe * 0.018, 1 - Math.exp(-6 * dt));

    this.recoil = Math.max(0, this.recoil - dt * this.recoil * 7 - dt * 0.02);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);

    if (cmd.toggleFlashlight) this.flashlight.toggle();
    this.flashlight.update(dt, cmd.turn, cmd.tilt);

    this.applyCamera(performance.now() / 1000);
  }

  private applyCamera(time: number): void {
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.06 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.035 * this.bobAmount;
    const shake = this.trauma * this.trauma;
    const sx = (Math.sin(time * 37.1) + Math.sin(time * 23.3)) * 0.5 * shake;
    const sy = (Math.sin(time * 41.7) + Math.sin(time * 19.9)) * 0.5 * shake;

    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    this.camera.position.set(this.position.x + rx * bobX, this.position.y + bobY - 0.03 * this.bobAmount, this.position.z + rz * bobX);
    this.camera.rotation.set(
      this.pitch + this.recoil + sy * 0.05,
      this.yaw + sx * 0.05,
      this.roll + Math.sin(this.bobPhase) * 0.004 * this.bobAmount + sx * 0.03
    );
  }

  /** For debug/testing: set view direction directly. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.applyCamera(0);
  }
}
