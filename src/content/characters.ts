/**
 * Who you play. Three survivors of the same crew; the story is the same for
 * each, but the radio, the notes and the subtitles call you by your own
 * name, your partner sees you as you are, and your hands and voice match.
 */
export type CharacterLook = "light" | "dark" | "woman";

export interface LookDef {
  id: CharacterLook;
  firstName: string;
  lastName: string;
  /** "structural engineer", for the prologue. */
  role: string;
  /** One line for the character select screen. */
  bio: string;
  skin: number;
  hair: number;
  hairStyle: "short" | "cropped" | "ponytail";
  beard: boolean;
  /** Shoulder width relative to the default build. */
  shoulders: number;
  /** Overall height relative to the default build. */
  height: number;
  coverall: number;
  /** Playback rate for recorded pain sounds (a higher voice for Nuraiza). */
  voice: number;
}

export const LOOKS: Record<CharacterLook, LookDef> = {
  light: {
    id: "light",
    firstName: "Nur",
    lastName: "Kanybekov",
    role: "structural engineer",
    bio: "Structural engineer on the consortium's survey team. Practical, dry, stubborn.",
    skin: 0xd9b397,
    hair: 0x2a1d14,
    hairStyle: "short",
    beard: false,
    shoulders: 1,
    height: 1,
    coverall: 0x4a4f3c,
    voice: 1,
  },
  dark: {
    id: "dark",
    firstName: "Raiymbek",
    lastName: "Asanov",
    role: "drilling foreman",
    bio: "Drilling foreman. Twenty years underground, and the calmest man in any crisis.",
    skin: 0x5e3b27,
    hair: 0x100c0a,
    hairStyle: "cropped",
    beard: true,
    shoulders: 1.06,
    height: 1.03,
    coverall: 0x3c4552,
    voice: 0.9,
  },
  woman: {
    id: "woman",
    firstName: "Nuraiza",
    lastName: "Akylbek",
    role: "field geologist",
    bio: "Field geologist. She mapped these tunnels before anyone else went down.",
    skin: 0xc8957a,
    hair: 0x3a2216,
    hairStyle: "ponytail",
    beard: false,
    shoulders: 0.86,
    height: 0.95,
    coverall: 0x4f3f3a,
    voice: 1.32,
  },
};

export const LOOK_ORDER: CharacterLook[] = ["light", "dark", "woman"];

export function isCharacterLook(v: unknown): v is CharacterLook {
  return typeof v === "string" && v in LOOKS;
}

export function fullName(look: CharacterLook): string {
  return `${LOOKS[look].firstName} ${LOOKS[look].lastName}`;
}

let current: CharacterLook = "light";

/** The character this player is playing (set from the settings). */
export function setCharacter(look: CharacterLook): void {
  current = look;
}

export function currentCharacter(): LookDef {
  return LOOKS[current];
}

/**
 * Story text written for Nur, told to whoever is playing: "Nur Kanybekov"
 * becomes the full name and "Nur" the first name. Whole words only, so
 * nothing else that happens to start with those letters changes.
 */
export function personalise(text: string, look: CharacterLook = current): string {
  if (look === "light") return text;
  const c = LOOKS[look];
  return text
    .replace(/\bNur Kanybekov\b/g, `${c.firstName} ${c.lastName}`)
    .replace(/\bstructural engineer\b/g, c.role)
    .replace(/\bNur\b/g, c.firstName);
}
