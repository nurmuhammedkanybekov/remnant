import { Weapon, type WeaponConfig } from "./weapon";

export const PISTOL_CONFIG: WeaponConfig = {
  name: "Sidearm",
  damage: 26,
  headshotMultiplier: 2.5,
  fireCooldown: 0.24,
  magSize: 8,
  reserveMax: 48,
  reloadTime: 1.5,
  range: 40,
  spread: 0.006,
  noiseRadius: 22,
};

export function createPistol(reserve = 16, inMag?: number): Weapon {
  return new Weapon(PISTOL_CONFIG, reserve, inMag);
}
