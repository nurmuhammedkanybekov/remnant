/**
 * How a player looks to their partner in co-op (and their own hands in first
 * person). Purely cosmetic: every look plays the same.
 */
export type CharacterLook = "light" | "dark" | "woman";

export interface LookDef {
  id: CharacterLook;
  /** Shown in Settings. */
  label: string;
  skin: number;
  hair: number;
  hairStyle: "short" | "cropped" | "ponytail";
  beard: boolean;
  /** Shoulder width relative to the default build. */
  shoulders: number;
  /** Overall height relative to the default build. */
  height: number;
  coverall: number;
}

export const LOOKS: Record<CharacterLook, LookDef> = {
  light: {
    id: "light",
    label: "Man, light skin",
    skin: 0xd9b397,
    hair: 0x2a1d14,
    hairStyle: "short",
    beard: false,
    shoulders: 1,
    height: 1,
    coverall: 0x4a4f3c,
  },
  dark: {
    id: "dark",
    label: "Man, dark skin",
    skin: 0x5e3b27,
    hair: 0x100c0a,
    hairStyle: "cropped",
    beard: true,
    shoulders: 1.06,
    height: 1.03,
    coverall: 0x3c4552,
  },
  woman: {
    id: "woman",
    label: "Woman",
    skin: 0xc8957a,
    hair: 0x3a2216,
    hairStyle: "ponytail",
    beard: false,
    shoulders: 0.86,
    height: 0.95,
    coverall: 0x4f3f3a,
  },
};

export const LOOK_ORDER: CharacterLook[] = ["light", "dark", "woman"];

export function isCharacterLook(v: unknown): v is CharacterLook {
  return typeof v === "string" && v in LOOKS;
}
