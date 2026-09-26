import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { WEAPONS } from "../content/weapons";
import { Weapon } from "./weapon";

const origin = new THREE.Vector3();
const aim = new THREE.Vector3(0, 0, -1);
const pistol = WEAPONS.pistol;

describe("Weapon", () => {
  let w: Weapon;
  beforeEach(() => {
    w = new Weapon(pistol, 16);
  });

  it("fires, spends a round and respects the cooldown", () => {
    expect(w.tryFire(origin, aim, 0)).not.toBeNull();
    expect(w.ammoInMag).toBe(pistol.magSize - 1);
    expect(w.tryFire(origin, aim, 0)).toBeNull();
    w.update(pistol.fireCooldown + 0.01);
    expect(w.tryFire(origin, aim, 0)).not.toBeNull();
  });

  it("reloads from reserve after the reload time", () => {
    w.ammoInMag = 2;
    expect(w.tryReload()).toBe(true);
    expect(w.isReloading).toBe(true);
    w.update(pistol.reloadTime / 2);
    expect(w.reloadProgress).toBeCloseTo(0.5);
    w.update(pistol.reloadTime);
    expect(w.ammoInMag).toBe(pistol.magSize);
    expect(w.reserveAmmo).toBe(16 - (pistol.magSize - 2));
  });

  it("dry-fire starts a reload, or clicks when there is no reserve", () => {
    w.ammoInMag = 0;
    expect(w.tryFire(origin, aim, 0)).toBeNull();
    expect(w.isReloading).toBe(true);

    const empty = new Weapon(pistol, 0, 0);
    let clicked = false;
    empty.onEmptyFire = () => (clicked = true);
    empty.tryFire(origin, aim, 0);
    expect(clicked).toBe(true);
  });

  it("caps reserve ammo", () => {
    expect(w.addReserveAmmo(1000)).toBe(pistol.reserveMax - 16);
    expect(w.reserveAmmo).toBe(pistol.reserveMax);
  });

  it("spread stays inside the cone and grows with movement", () => {
    expect(w.currentSpread(1)).toBeGreaterThan(w.currentSpread(0));
    const shot = w.tryFire(origin, aim, 0, () => 1)!;
    const angle = shot.dir.angleTo(aim);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThanOrEqual(w.currentSpread(0) + 1e-9);
    expect(shot.dir.length()).toBeCloseTo(1);
  });
});
