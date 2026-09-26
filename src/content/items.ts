import type { WeaponId } from "./weapons";

/** Pickups and what they give. Amounts are scaled by the difficulty's `pickupMultiplier`. */
export type PickupType = "ammo" | "shells" | "rivets" | "medkit" | "battery" | "keycard" | "note" | "shotgun" | "rivetGun";

export interface ItemDef {
  /** Map glyph; notes use the digits 0–9 instead. */
  glyph: string | null;
  /** Base amount granted (health or battery charge; ammo amounts come from the weapon). */
  amount: number;
  /** Colour of the halo that makes the item findable in the dark. */
  glow: number;
  /** Ammunition for this weapon. */
  ammoFor?: WeaponId;
  /** Picking it up gives you this weapon. */
  weapon?: WeaponId;
}

export const ITEMS: Record<PickupType, ItemDef> = {
  ammo: { glyph: "A", amount: 0, glow: 0xffc14d, ammoFor: "pistol" },
  shells: { glyph: "T", amount: 0, glow: 0xff8a3a, ammoFor: "shotgun" },
  rivets: { glyph: "J", amount: 0, glow: 0xd8e05a, ammoFor: "rivet" },
  medkit: { glyph: "M", amount: 45, glow: 0xff5a5a },
  battery: { glyph: "B", amount: 45, glow: 0x7fd8ff },
  keycard: { glyph: "K", amount: 0, glow: 0x5aff9a },
  note: { glyph: null, amount: 0, glow: 0xfff0c0 },
  shotgun: { glyph: "!", amount: 0, glow: 0xffd08a, weapon: "shotgun" },
  rivetGun: { glyph: "^", amount: 0, glow: 0xffd08a, weapon: "rivet" },
};

/** Medkits are carried, not used on the spot. */
export const MAX_MEDKITS = 3;
/** Seconds to apply a medkit; you can't shoot meanwhile. */
export const HEAL_TIME = 1.3;

/** Map glyph → item type, derived from the definitions above. */
export const ITEM_GLYPHS: ReadonlyMap<string, PickupType> = new Map(
  (Object.keys(ITEMS) as PickupType[]).flatMap((t) => (ITEMS[t].glyph ? [[ITEMS[t].glyph!, t] as const] : []))
);
