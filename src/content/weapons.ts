/** Weapon definitions. The `Weapon` class runs any of these. */
export interface WeaponDef {
  id: string;
  name: string;
  /** Number key that selects it, and its place in the HUD's weapon strip. */
  slot: number;
  /** Damage per pellet. */
  damage: number;
  /** Rays per shot (1 for anything but a shotgun). */
  pellets: number;
  headshotMultiplier: number;
  /** Minimum seconds between shots. */
  fireCooldown: number;
  magSize: number;
  reserveMax: number;
  /** "magazine": one reload refills the magazine. "single": rounds go in one at a time and firing interrupts. */
  reload: "magazine" | "single";
  /** Seconds for a magazine swap, or per round for single loading. */
  reloadTime: number;
  range: number;
  /** Base cone half-angle in radians; grows with movement and rapid fire. */
  spread: number;
  /** How far enemies hear a shot. Gunfire is loud — every shot is a decision. */
  noiseRadius: number;
  /** Camera pitch kick per shot, in radians. */
  recoil: number;
  /** Rounds in one ammo pickup for this weapon. */
  ammoPickup: number;
  /** Level where it is found; chapter select starts later levels with it. Null = carried from the start. */
  foundIn: string | null;
}

export const WEAPONS = {
  pistol: {
    id: "pistol",
    name: "Sidearm",
    slot: 1,
    damage: 26,
    pellets: 1,
    headshotMultiplier: 2.5,
    fireCooldown: 0.24,
    magSize: 8,
    reserveMax: 48,
    reload: "magazine",
    reloadTime: 1.5,
    range: 40,
    spread: 0.006,
    noiseRadius: 22,
    recoil: 0.03,
    ammoPickup: 8,
    foundIn: null,
  },
  /**
   * A consortium pneumatic rivet gun. Weak and short-ranged, but it barely
   * makes a sound — the stealth weapon. Nur is an engineer; he knows how
   * to take the safety interlock off.
   */
  rivet: {
    id: "rivet",
    name: "Rivet Gun",
    slot: 2,
    damage: 17,
    pellets: 1,
    headshotMultiplier: 3,
    fireCooldown: 0.17,
    magSize: 12,
    reserveMax: 60,
    reload: "magazine",
    reloadTime: 1.9,
    range: 22,
    spread: 0.012,
    noiseRadius: 4.5,
    recoil: 0.012,
    ammoPickup: 12,
    foundIn: "ventilation",
  },
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    slot: 3,
    damage: 13,
    pellets: 8,
    headshotMultiplier: 1.5,
    fireCooldown: 0.85,
    magSize: 5,
    reserveMax: 24,
    reload: "single",
    reloadTime: 0.55,
    range: 22,
    spread: 0.075,
    noiseRadius: 32,
    recoil: 0.085,
    ammoPickup: 4,
    foundIn: "armory",
  },
} as const satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

/** Weapons in slot order. */
export const WEAPON_ORDER: WeaponId[] = (Object.keys(WEAPONS) as WeaponId[]).sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot);

export function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === "string" && v in WEAPONS;
}
