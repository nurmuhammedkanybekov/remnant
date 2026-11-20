import * as THREE from "three";
import type { WeaponDef } from "../content/weapons";

/** Seconds to clear a jam: rack the slide, the dud flies out. */
export const CLEAR_TIME = 0.7;

export interface Shot {
  origin: THREE.Vector3;
  /** One direction per pellet. */
  dirs: THREE.Vector3[];
}

/**
 * Ammo, cooldown, reload and spread for any `WeaponDef`. Magazine weapons
 * reload in one go; single-loading weapons (the shotgun) take one round at a
 * time and can fire mid-reload.
 */
export class Weapon {
  ammoInMag: number;
  reserveAmmo: number;
  private cooldownRemaining = 0;
  private reloading = false;
  private reloadRemaining = 0;
  /** Accumulated spread from rapid fire, decays quickly. */
  bloom = 0;
  /** A round failed to feed: it won't fire until it's cleared (the reload key). */
  jammed = false;
  /** Scales the weapon's jam chance (difficulty: none on Story). */
  jamScale = 1;
  /** Clearing a jam, not reloading: the slide racked, the dud thrown out. */
  private clearing = false;

  onFire: (() => void) | null = null;
  onEmptyFire: (() => void) | null = null;
  onReloadStart: (() => void) | null = null;
  onReloadEnd: (() => void) | null = null;
  /** Single-loading weapons: each round going in. */
  onRoundLoaded: (() => void) | null = null;
  /** The trigger pulled on a jammed gun. */
  onJammedFire: (() => void) | null = null;
  /** A jam just happened (the shot went; the next one won't). */
  onJam: (() => void) | null = null;
  /** Clearing a jam: started, and done. */
  onClearStart: (() => void) | null = null;
  onClearEnd: (() => void) | null = null;

  constructor(
    readonly config: WeaponDef,
    reserveAmmo: number,
    ammoInMag = config.magSize
  ) {
    this.ammoInMag = ammoInMag;
    this.reserveAmmo = reserveAmmo;
  }

  get isReloading(): boolean {
    return this.reloading;
  }

  /** 0..1 progress of the current reload (per round for single loading), for the viewmodel animation. */
  get reloadProgress(): number {
    const total = this.clearing ? CLEAR_TIME : this.config.reloadTime;
    return this.reloading ? 1 - Math.max(0, this.reloadRemaining) / total : 0;
  }

  addReserveAmmo(amount: number): number {
    const before = this.reserveAmmo;
    this.reserveAmmo = Math.min(this.config.reserveMax, this.reserveAmmo + amount);
    return this.reserveAmmo - before;
  }

  update(dt: number): void {
    if (this.cooldownRemaining > 0) this.cooldownRemaining -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 2.5);
    if (!this.reloading) return;
    this.reloadRemaining -= dt;
    if (this.reloadRemaining > 0) return;
    if (this.clearing) {
      // The slide racked: the dud round goes out on the floor, the next one goes in.
      this.clearing = false;
      this.reloading = false;
      this.jammed = false;
      if (this.ammoInMag > 0) this.ammoInMag -= 1;
      this.onClearEnd?.();
      return;
    }
    if (this.config.reload === "single") {
      this.ammoInMag += 1;
      this.reserveAmmo -= 1;
      this.onRoundLoaded?.();
      if (this.ammoInMag < this.config.magSize && this.reserveAmmo > 0) {
        this.reloadRemaining += this.config.reloadTime;
        return;
      }
    } else {
      const taken = Math.min(this.config.magSize - this.ammoInMag, this.reserveAmmo);
      this.ammoInMag += taken;
      this.reserveAmmo -= taken;
    }
    this.reloading = false;
    this.onReloadEnd?.();
  }

  tryReload(): boolean {
    if (this.jammed && !this.reloading) {
      this.reloading = true;
      this.clearing = true;
      this.reloadRemaining = CLEAR_TIME;
      this.onClearStart?.();
      return true;
    }
    if (this.reloading || this.ammoInMag >= this.config.magSize || this.reserveAmmo <= 0) return false;
    this.reloading = true;
    this.reloadRemaining = this.config.reloadTime;
    this.onReloadStart?.();
    return true;
  }

  /** Stops a reload in progress (switching weapons). Rounds already loaded stay loaded. */
  cancelReload(): void {
    this.reloading = false;
    this.clearing = false;
  }

  /** Current cone half-angle given how fast the player is moving (0..1). */
  currentSpread(moveFactor: number): number {
    return this.config.spread * (1 + moveFactor * 3 + this.bloom * 4);
  }

  /**
   * Attempts to fire from `origin` along `aim` (unit vector). Returns one ray
   * per pellet with spread applied, or null if the weapon can't fire right now.
   * `random` is injectable so tests can make spread deterministic.
   */
  tryFire(origin: THREE.Vector3, aim: THREE.Vector3, moveFactor: number, random: () => number = Math.random): Shot | null {
    // A single-loading weapon can fire mid-reload if there's a round in it.
    if (this.reloading && this.config.reload === "single" && this.ammoInMag > 0) this.reloading = false;
    if (this.reloading || this.cooldownRemaining > 0) return null;
    if (this.jammed) {
      // Click. Nothing. Again: nothing.
      this.cooldownRemaining = 0.3;
      this.onJammedFire?.();
      return null;
    }
    if (this.ammoInMag <= 0) {
      this.cooldownRemaining = 0.25;
      // Pull the trigger on empty: click, then reload automatically if possible.
      if (!this.tryReload()) this.onEmptyFire?.();
      return null;
    }
    this.ammoInMag -= 1;
    this.cooldownRemaining = this.config.fireCooldown;

    const spread = this.currentSpread(moveFactor);
    this.bloom = Math.min(1, this.bloom + 0.35);
    const dirs: THREE.Vector3[] = [];
    for (let i = 0; i < this.config.pellets; i++) dirs.push(scatter(aim, spread, random));
    this.onFire?.();
    // The next round doesn't feed (only with one left to feed).
    if (this.ammoInMag > 0 && random() < (this.config.jamChance ?? 0) * this.jamScale) {
      this.jammed = true;
      this.onJam?.();
    }
    return { origin: origin.clone(), dirs };
  }
}

/** A random direction within `spread` radians of `aim` (unit vector). */
function scatter(aim: THREE.Vector3, spread: number, random: () => number): THREE.Vector3 {
  const dir = aim.clone();
  if (spread <= 0) return dir;
  const up = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
  const r = Math.sqrt(random()) * Math.tan(spread);
  const a = random() * Math.PI * 2;
  return dir
    .addScaledVector(right, Math.cos(a) * r)
    .addScaledVector(realUp, Math.sin(a) * r)
    .normalize();
}
