import * as THREE from "three";

export interface WeaponConfig {
  name: string;
  damage: number;
  headshotMultiplier: number;
  fireCooldown: number;
  magSize: number;
  reserveMax: number;
  reloadTime: number;
  range: number;
  /** Base cone half-angle in radians; grows with movement and rapid fire. */
  spread: number;
  /** How far enemies hear a shot. Gunfire is loud — every shot is a decision. */
  noiseRadius: number;
}

export interface Shot {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
}

export class Weapon {
  ammoInMag: number;
  reserveAmmo: number;
  private cooldownRemaining = 0;
  private reloading = false;
  private reloadRemaining = 0;
  /** Accumulated spread from rapid fire, decays quickly. */
  bloom = 0;

  onFire: (() => void) | null = null;
  onEmptyFire: (() => void) | null = null;
  onReloadStart: (() => void) | null = null;
  onReloadEnd: (() => void) | null = null;

  constructor(
    readonly config: WeaponConfig,
    reserveAmmo: number,
    ammoInMag = config.magSize
  ) {
    this.ammoInMag = ammoInMag;
    this.reserveAmmo = reserveAmmo;
  }

  get isReloading(): boolean {
    return this.reloading;
  }

  /** 0..1 progress of the current reload (for the viewmodel animation). */
  get reloadProgress(): number {
    return this.reloading ? 1 - this.reloadRemaining / this.config.reloadTime : 0;
  }

  addReserveAmmo(amount: number): number {
    const before = this.reserveAmmo;
    this.reserveAmmo = Math.min(this.config.reserveMax, this.reserveAmmo + amount);
    return this.reserveAmmo - before;
  }

  update(dt: number): void {
    if (this.cooldownRemaining > 0) this.cooldownRemaining -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 2.5);
    if (this.reloading) {
      this.reloadRemaining -= dt;
      if (this.reloadRemaining <= 0) {
        const taken = Math.min(this.config.magSize - this.ammoInMag, this.reserveAmmo);
        this.ammoInMag += taken;
        this.reserveAmmo -= taken;
        this.reloading = false;
        this.onReloadEnd?.();
      }
    }
  }

  tryReload(): boolean {
    if (this.reloading || this.ammoInMag >= this.config.magSize || this.reserveAmmo <= 0) return false;
    this.reloading = true;
    this.reloadRemaining = this.config.reloadTime;
    this.onReloadStart?.();
    return true;
  }

  /** Current cone half-angle given how fast the player is moving (0..1). */
  currentSpread(moveFactor: number): number {
    return this.config.spread * (1 + moveFactor * 3 + this.bloom * 4);
  }

  /** Attempts to fire. Returns the shot ray (spread already applied) or null. */
  tryFire(camera: THREE.Camera, moveFactor: number): Shot | null {
    if (this.reloading || this.cooldownRemaining > 0) return null;
    if (this.ammoInMag <= 0) {
      this.cooldownRemaining = 0.25;
      // Pull the trigger on empty: click, then reload automatically if possible.
      if (!this.tryReload()) this.onEmptyFire?.();
      return null;
    }
    this.ammoInMag -= 1;
    this.cooldownRemaining = this.config.fireCooldown;

    const origin = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const spread = this.currentSpread(moveFactor);
    this.bloom = Math.min(1, this.bloom + 0.35);
    if (spread > 0) {
      // Random point in a cone around `dir`.
      const up = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
      const r = Math.sqrt(Math.random()) * Math.tan(spread);
      const a = Math.random() * Math.PI * 2;
      dir
        .addScaledVector(right, Math.cos(a) * r)
        .addScaledVector(realUp, Math.sin(a) * r)
        .normalize();
    }
    this.onFire?.();
    return { origin, dir };
  }
}
