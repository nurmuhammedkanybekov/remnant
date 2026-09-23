import * as THREE from "three";

const MAX_BATTERY = 100;
const DRAIN_PER_SEC = 3.2;
const RECHARGE_PER_SEC = 1.4;
const LOW_BATTERY_THRESHOLD = 20;

export class Flashlight {
  readonly light: THREE.SpotLight;
  private readonly target: THREE.Object3D;
  on = true;
  battery = MAX_BATTERY;
  private flickerTimer = 0;

  constructor(camera: THREE.Camera) {
    this.light = new THREE.SpotLight(0xdfe8ff, 3.2, 14, Math.PI / 7, 0.5, 1.4);
    this.light.position.set(0, 0, 0);
    this.target = new THREE.Object3D();
    this.target.position.set(0, 0, -1);
    camera.add(this.light);
    camera.add(this.target);
    this.light.target = this.target;
  }

  addBattery(amount: number): void {
    this.battery = Math.min(MAX_BATTERY, this.battery + amount);
  }

  toggle(): void {
    if (this.battery > 0) this.on = !this.on;
  }

  update(dt: number): void {
    if (this.on && this.battery > 0) {
      this.battery = Math.max(0, this.battery - DRAIN_PER_SEC * dt);
      if (this.battery === 0) this.on = false;
    } else if (!this.on) {
      this.battery = Math.min(MAX_BATTERY, this.battery + RECHARGE_PER_SEC * dt * 0.4);
    }

    let intensity = 0;
    if (this.on) {
      intensity = 3.2;
      if (this.battery < LOW_BATTERY_THRESHOLD) {
        this.flickerTimer -= dt;
        if (this.flickerTimer <= 0) {
          this.flickerTimer = 0.05 + Math.random() * 0.15;
          intensity = Math.random() < 0.35 ? 0.4 : 3.2;
        } else {
          intensity = this.light.intensity;
        }
      }
    }
    this.light.intensity = intensity;
  }
}
