/** Pickups and what they give. Amounts are scaled by the difficulty's `pickupMultiplier`. */
export type PickupType = "ammo" | "medkit" | "battery" | "keycard" | "note";

export interface ItemDef {
  /** Map glyph; notes use the digits 0–9 instead. */
  glyph: string | null;
  /** Base amount granted (rounds, health or battery charge). */
  amount: number;
  /** Colour of the halo that makes the item findable in the dark. */
  glow: number;
}

export const ITEMS: Record<PickupType, ItemDef> = {
  ammo: { glyph: "A", amount: 8, glow: 0xffc14d },
  medkit: { glyph: "M", amount: 45, glow: 0xff5a5a },
  battery: { glyph: "B", amount: 45, glow: 0x7fd8ff },
  keycard: { glyph: "K", amount: 0, glow: 0x5aff9a },
  note: { glyph: null, amount: 0, glow: 0xfff0c0 },
};
