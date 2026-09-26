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
    expect(shot.dirs).toHaveLength(1);
    const angle = shot.dirs[0].angleTo(aim);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThanOrEqual(w.currentSpread(0) + 1e-9);
    expect(shot.dirs[0].length()).toBeCloseTo(1);
  });
});

describe("Shotgun", () => {
  const shotgun = WEAPONS.shotgun;

  it("fires a spread of pellets for one shell", () => {
    const w = new Weapon(shotgun, 10);
    const shot = w.tryFire(origin, aim, 0)!;
    expect(shot.dirs).toHaveLength(shotgun.pellets);
    expect(w.ammoInMag).toBe(shotgun.magSize - 1);
    for (const d of shot.dirs) expect(d.angleTo(aim)).toBeLessThanOrEqual(w.currentSpread(0) + 1e-9);
  });

  it("loads one shell at a time until full or out of reserve", () => {
    const w = new Weapon(shotgun, 2, 1);
    let loaded = 0;
    w.onRoundLoaded = () => loaded++;
    expect(w.tryReload()).toBe(true);
    w.update(shotgun.reloadTime + 0.01);
    expect(w.ammoInMag).toBe(2);
    expect(w.isReloading).toBe(true);
    w.update(shotgun.reloadTime);
    expect(w.ammoInMag).toBe(3);
    expect(w.reserveAmmo).toBe(0);
    expect(w.isReloading).toBe(false);
    expect(loaded).toBe(2);
  });

  it("can fire mid-reload, keeping the shells already loaded", () => {
    const w = new Weapon(shotgun, 10, 0);
    w.tryReload();
    w.update(shotgun.reloadTime + 0.01);
    expect(w.ammoInMag).toBe(1);
    expect(w.tryFire(origin, aim, 0)).not.toBeNull();
    expect(w.isReloading).toBe(false);
    expect(w.ammoInMag).toBe(0);
  });
});

describe("weapon balance", () => {
  it("the rivet gun is the quiet one and the shotgun the loud one", () => {
    expect(WEAPONS.rivet.noiseRadius).toBeLessThan(WEAPONS.pistol.noiseRadius / 3);
    expect(WEAPONS.shotgun.noiseRadius).toBeGreaterThan(WEAPONS.pistol.noiseRadius);
  });

  it("slots are unique", () => {
    const slots = Object.values(WEAPONS).map((w) => w.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });
});
