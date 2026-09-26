/** Weapon definitions. The `Weapon` class runs any of these. */
export interface WeaponDef {
  id: string;
  name: string;
  damage: number;
  headshotMultiplier: number;
  /** Minimum seconds between shots. */
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

export const WEAPONS = {
  pistol: {
    id: "pistol",
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
  },
} as const satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;
