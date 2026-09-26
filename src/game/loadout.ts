import type { DifficultyDef } from "../content/difficulty";
import { MAX_MEDKITS } from "../content/items";
import { isWeaponId, WEAPON_ORDER, WEAPONS, type WeaponId } from "../content/weapons";
import { MAX_BATTERY } from "../player/flashlight";

/** Rounds in the magazine and in reserve, for one carried weapon. */
export interface WeaponAmmo {
  mag: number;
  reserve: number;
}

/** What the player carries from one level into the next. */
export interface Loadout {
  health: number;
  battery: number;
  medkits: number;
  /** Weapons carried, and their ammo. The pistol is always carried. */
  weapons: Partial<Record<WeaponId, WeaponAmmo>>;
  /** The weapon in hand. */
  current: WeaponId;
}

/**
 * A new run's loadout. Starting from a later chapter also hands over the
 * weapons that would have been found on the way, so no level is started
 * without the tools it was designed around.
 */
export function startingLoadout(difficulty: DifficultyDef, levelIds: readonly string[] = [], levelIndex = 0): Loadout {
  const earlier = new Set(levelIds.slice(0, levelIndex));
  const weapons: Loadout["weapons"] = {};
  for (const id of WEAPON_ORDER) {
    const w = WEAPONS[id];
    if (w.foundIn !== null && !earlier.has(w.foundIn)) continue;
    weapons[id] = { mag: w.magSize, reserve: id === "pistol" ? difficulty.startingReserve : w.ammoPickup * 2 };
  }
  return { health: 100, battery: MAX_BATTERY, medkits: difficulty.startingMedkits, weapons, current: "pistol" };
}

/** The loadout for the next level: what you finished with, plus a breather so a bad run isn't unwinnable. */
export function carryOver(end: Loadout, difficulty: DifficultyDef): Loadout {
  return {
    ...end,
    weapons: cloneWeapons(end.weapons),
    health: Math.max(end.health, difficulty.carryHealthFloor),
    battery: Math.max(end.battery, difficulty.carryBatteryFloor),
  };
}

export function cloneLoadout(l: Loadout): Loadout {
  return { ...l, weapons: cloneWeapons(l.weapons) };
}

function cloneWeapons(w: Loadout["weapons"]): Loadout["weapons"] {
  return Object.fromEntries(Object.entries(w).map(([id, a]) => [id, { ...a }]));
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Validates a loadout read from storage, repairing what it can. Returns
 * null only if it isn't an object at all.
 */
export function parseLoadout(raw: unknown): Loadout | null {
  const l = obj(raw);
  if (!l) return null;
  const weapons: Loadout["weapons"] = {};
  const w = obj(l.weapons) ?? {};
  for (const [id, a] of Object.entries(w)) {
    const ammo = obj(a);
    if (!isWeaponId(id) || !ammo) continue;
    const def = WEAPONS[id];
    weapons[id] = {
      mag: Math.min(def.magSize, Math.max(0, Math.floor(num(ammo.mag, 0)))),
      reserve: Math.min(def.reserveMax, Math.max(0, Math.floor(num(ammo.reserve, 0)))),
    };
  }
  weapons.pistol ??= { mag: 0, reserve: 0 };
  const current = isWeaponId(l.current) && weapons[l.current] ? l.current : "pistol";
  return {
    health: Math.min(100, Math.max(1, num(l.health, 100))),
    battery: Math.min(MAX_BATTERY, Math.max(0, num(l.battery, MAX_BATTERY))),
    medkits: Math.min(MAX_MEDKITS, Math.max(0, Math.floor(num(l.medkits, 0)))),
    weapons,
    current,
  };
}

/** A v2 save's loadout (one pistol: `mag` + `reserve`) in the current shape. */
export function upgradeLegacyLoadout(raw: unknown): unknown {
  const l = obj(raw);
  if (!l || l.weapons) return raw;
  const { mag, reserve, ...rest } = l;
  return { ...rest, medkits: 0, current: "pistol", weapons: { pistol: { mag, reserve } } };
}
