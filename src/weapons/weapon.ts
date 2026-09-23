import * as THREE from "three";

export interface WeaponConfig {
  name: string;
  damage: number;
  fireCooldown: number;
  magSize: number;
  reserveMax: number;
  reloadTime: number;
  range: number;
}

export class Weapon {
  ammoInMag: number;
  reserveAmmo: number;
  private cooldownRemaining = 0;
  private reloading = false;
  private reloadRemaining = 0;

  onFire: (() => void) | null = null;
  onEmptyFire: (() => void) | null = null;
  onReloadStart: (() => void) | null = null;
  onReloadEnd: (() => void) | null = null;

  constructor(readonly config: WeaponConfig, reserveAmmo: number) {
    this.ammoInMag = config.magSize;
    this.reserveAmmo = reserveAmmo;
  }

  get isReloading(): boolean {
    return this.reloading;
  }

  addReserveAmmo(amount: number): void {
    this.reserveAmmo = Math.min(this.config.reserveMax, this.reserveAmmo + amount);
  }

  update(dt: number): void {
    if (this.cooldownRemaining > 0) this.cooldownRemaining -= dt;
    if (this.reloading) {
      this.reloadRemaining -= dt;
      if (this.reloadRemaining <= 0) {
        const needed = this.config.magSize - this.ammoInMag;
        const taken = Math.min(needed, this.reserveAmmo);
        this.ammoInMag += taken;
        this.reserveAmmo -= taken;
        this.reloading = false;
        this.onReloadEnd?.();
      }
    }
  }

  tryReload(): void {
    if (this.reloading || this.ammoInMag >= this.config.magSize || this.reserveAmmo <= 0) return;
    this.reloading = true;
    this.reloadRemaining = this.config.reloadTime;
    this.onReloadStart?.();
  }

  /** Attempts to fire; returns a raycaster ready to test against the scene, or null if it didn't fire. */
  tryFire(camera: THREE.Camera): THREE.Raycaster | null {
    if (this.reloading || this.cooldownRemaining > 0) return null;
    if (this.ammoInMag <= 0) {
      this.onEmptyFire?.();
      return null;
    }
    this.ammoInMag -= 1;
    this.cooldownRemaining = this.config.fireCooldown;
    this.onFire?.();

    const raycaster = new THREE.Raycaster();
    raycaster.far = this.config.range;
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    raycaster.set(origin, dir);
    return raycaster;
  }
}
