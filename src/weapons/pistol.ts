import { Weapon, type WeaponConfig } from "./weapon";

export const PISTOL_CONFIG: WeaponConfig = {
  name: "Sidearm",
  damage: 24,
  fireCooldown: 0.28,
  magSize: 8,
  reserveMax: 48,
  reloadTime: 1.4,
  range: 30,
};

export function createPistol(): Weapon {
  return new Weapon(PISTOL_CONFIG, 16);
}
