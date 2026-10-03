import * as THREE from "three";

export const MAX_BATTERY = 100;
const DRAIN_PER_SEC = 0.55; // ~3 minutes of light from full: enough that the battery is a worry, not a chore
const RECHARGE_PER_SEC = 0.8; // passive trickle while off...
const RECHARGE_CAP = 30; // ...but only up to this — real charge comes from batteries
const LOW_BATTERY_THRESHOLD = 20;
const FULL_INTENSITY = 22;
const BEAM_SWAY = 1.15; // beam offset per radian of look change

export class Flashlight {
  readonly light: THREE.SpotLight;
  private readonly target: THREE.Object3D;
  on = true;
  battery = MAX_BATTERY;
  private flickerTimer = 0;
  private flickerValue = 1;
  private sway = new THREE.Vector2();
  /** Scales battery drain (difficulty). */
  drainMultiplier = 1;
  onToggle: ((on: boolean) => void) | null = null;

  constructor(camera: THREE.Camera) {
    this.light = new THREE.SpotLight(0xe8eeff, FULL_INTENSITY, 26, Math.PI / 6.5, 0.6, 0.9);
    // Held slightly low and to the right, like a real torch.
    this.light.position.set(0.22, -0.18, 0.05);
    this.target = new THREE.Object3D();
    this.target.position.set(0, 0, -6);
    camera.add(this.light);
    camera.add(this.target);
    this.light.target = this.target;
  }

  /** 0..1 — how lit the scene in front of the player is (for dust visibility etc). */
  get level(): number {
    return this.light.intensity / FULL_INTENSITY;
  }

  addBattery(amount: number): void {
    this.battery = Math.min(MAX_BATTERY, this.battery + amount);
  }

  toggle(): void {
    if (!this.on && this.battery <= 0.5) {
      this.onToggle?.(false);
      return;
    }
    this.on = !this.on;
    this.onToggle?.(this.on);
  }

  /** `turn`/`tilt` are this frame's look change in radians — the beam lags slightly behind the view. */
  update(dt: number, turn: number, tilt: number): void {
    if (this.on) {
      this.battery = Math.max(0, this.battery - DRAIN_PER_SEC * this.drainMultiplier * dt);
      if (this.battery === 0) {
        this.on = false;
        this.onToggle?.(false);
      }
    } else if (this.battery < RECHARGE_CAP) {
      this.battery = Math.min(RECHARGE_CAP, this.battery + RECHARGE_PER_SEC * dt);
    }

    // Beam sway: drift opposite to mouse motion, spring back to centre.
    this.sway.x -= turn * BEAM_SWAY;
    this.sway.y += tilt * BEAM_SWAY;
    this.sway.multiplyScalar(Math.exp(-dt * 7));
    this.sway.clampLength(0, 0.9);
    this.target.position.set(this.sway.x, this.sway.y, -6);

    let intensity = 0;
    if (this.on) {
      intensity = FULL_INTENSITY;
      if (this.battery < LOW_BATTERY_THRESHOLD) {
        this.flickerTimer -= dt;
        if (this.flickerTimer <= 0) {
          this.flickerTimer = 0.04 + Math.random() * 0.2;
          const severity = 1 - this.battery / LOW_BATTERY_THRESHOLD;
          this.flickerValue = Math.random() < 0.15 + severity * 0.35 ? 0.05 + Math.random() * 0.3 : 1;
        }
        intensity *= this.flickerValue * (0.55 + 0.45 * (this.battery / LOW_BATTERY_THRESHOLD));
      }
    }
    this.light.intensity = intensity;
  }
}
