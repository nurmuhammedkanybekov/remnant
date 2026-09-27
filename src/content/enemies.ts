/**
 * Enemy definitions. Adding a creature starts here: give it an id, a map
 * glyph, its numbers and its traits, and levels can place it straight away.
 * See docs/STORY.md for what each creature is.
 */
export interface EnemyDef {
  id: string;
  name: string;
  /** Character that places this enemy in a level map. */
  glyph: string;
  health: number;
  /** Rig scale; also scales hit volumes. */
  scale: number;
  /** Skin colour. */
  tint: number;
  patrolSpeed: number;
  investigateSpeed: number;
  chaseSpeed: number;
  attackRange: number;
  attackDamage: number;
  /** Seconds from the start of an attack to the strike — the player's window to dodge. */
  windup: number;
  recover: number;
  /** Multiplier on how far away it can hear noise. */
  hearing: number;
  /** Multiplier on how far it can see. 0 = blind. */
  sight: number;
  /**
   * How the flashlight affects it:
   *  sees    — the beam gives you away from much further (most creatures)
   *  ignores — blind; the light means nothing to it
   *  freezes — light locks its muscles: it can't move while the beam is on it
   */
  light: "sees" | "ignores" | "freezes";
  /** Special behaviour on top of the shared hunt logic. */
  behaviour?: "ceiling" | "ranged" | "lurker" | "howler" | "boss";
  /** Spitters and the boss: a lobbed, dodgeable projectile. */
  ranged?: RangedAttack;
  /** One glyph places this many (swarms). */
  pack?: number;
  /** Can be killed instantly with a quiet melee strike from behind while it's unaware. */
  takedown: boolean;
  /** Multiplier on damage to anything but the head (the boss's hide). */
  armor?: number;
  /** Collision radius. */
  radius: number;
  /** Walk-cycle speed relative to ground speed (lower = heavier gait). */
  stride: number;
  /** Voice pitch multiplier for synthesized vocals. */
  voicePitch: number;
  look: CreatureLook;
}

export interface RangedAttack {
  /** Spits when you're within this range and in sight. */
  range: number;
  /** Backs away if you're closer than this. */
  minRange: number;
  speed: number;
  damage: number;
  /** Seconds between spits. */
  cooldown: number;
}

/** How a creature's body is built. Humanoid options are ignored by other rigs. */
export interface CreatureLook {
  rig: "humanoid" | "rat" | "mass";
  /** Colour of the glowing veins under the skin. */
  veins: number;
  /** Torso width. */
  build?: number;
  /** Arm length. */
  arms?: number;
  /** Leg length. */
  legs?: number;
  /** Forward lean of the torso, radians. */
  hunch?: number;
  /** Number of eyes (0 = eyeless). */
  eyes?: number;
  /** "open": the skull has split into a resonating chamber. "split": a jaw that opens far too wide. */
  skull?: "normal" | "open" | "split";
  /** A swollen throat sac (spitters). */
  sac?: boolean;
  /** A second, half-absorbed head on the shoulder (brutes). */
  extraHead?: boolean;
  /** "crawl": moves on all fours (and upside down along the ceiling). */
  gait?: "upright" | "crawl";
}

export const ENEMIES = {
  husk: {
    id: "husk",
    name: "Husk",
    glyph: "E",
    health: 60,
    scale: 1,
    tint: 0x2a201c,
    patrolSpeed: 1.0,
    investigateSpeed: 1.9,
    chaseSpeed: 3.6,
    attackRange: 1.35,
    attackDamage: 16,
    windup: 0.38,
    recover: 0.8,
    hearing: 1,
    sight: 1,
    light: "sees",
    takedown: true,
    radius: 0.35,
    stride: 3.6,
    voicePitch: 1,
    look: { rig: "humanoid", veins: 0xff5a2a },
  },
  brute: {
    id: "brute",
    name: "Brute",
    glyph: "H",
    health: 190,
    scale: 1.4,
    tint: 0x281a1c,
    patrolSpeed: 0.8,
    investigateSpeed: 1.5,
    chaseSpeed: 2.5,
    attackRange: 1.75,
    attackDamage: 34,
    windup: 0.65,
    recover: 0.9,
    hearing: 0.8,
    sight: 1,
    light: "sees",
    takedown: false,
    radius: 0.5,
    stride: 2.6,
    voicePitch: 0.6,
    look: { rig: "humanoid", veins: 0xff3a1a, build: 1.45, arms: 1.1, extraHead: true, hunch: 0.7 },
  },
  listener: {
    id: "listener",
    name: "Listener",
    glyph: "U",
    health: 80,
    scale: 1.05,
    tint: 0x3a302c,
    patrolSpeed: 0.9,
    investigateSpeed: 2.2,
    chaseSpeed: 3.9,
    attackRange: 1.4,
    attackDamage: 22,
    windup: 0.45,
    recover: 0.8,
    hearing: 2.1,
    sight: 0,
    light: "ignores",
    takedown: true,
    radius: 0.35,
    stride: 3.4,
    voicePitch: 1.3,
    look: { rig: "humanoid", veins: 0xffa040, eyes: 0, skull: "open", hunch: 0.35 },
  },
  watcher: {
    id: "watcher",
    name: "Watcher",
    glyph: "W",
    health: 110,
    scale: 1.15,
    tint: 0x4a4440,
    patrolSpeed: 1.2,
    investigateSpeed: 2.6,
    chaseSpeed: 5.2,
    attackRange: 1.5,
    attackDamage: 28,
    windup: 0.3,
    recover: 0.7,
    hearing: 0.9,
    sight: 1,
    light: "freezes",
    takedown: true,
    radius: 0.35,
    stride: 3,
    voicePitch: 0.85,
    look: { rig: "humanoid", veins: 0x7ab8e0, build: 0.8, arms: 1.35, legs: 1.3, eyes: 6, hunch: 0.15 },
  },
  crawler: {
    id: "crawler",
    name: "Crawler",
    glyph: "V",
    health: 45,
    scale: 0.95,
    tint: 0x2e2622,
    patrolSpeed: 0.9,
    investigateSpeed: 2.4,
    chaseSpeed: 4.2,
    attackRange: 1.3,
    attackDamage: 14,
    windup: 0.3,
    recover: 0.7,
    hearing: 1.3,
    sight: 0.6,
    light: "sees",
    behaviour: "ceiling",
    takedown: true,
    radius: 0.32,
    stride: 4.2,
    voicePitch: 1.5,
    look: { rig: "humanoid", veins: 0xff6a2a, build: 0.85, arms: 1.5, legs: 1.1, eyes: 4, hunch: 1.0, gait: "crawl" },
  },
  spitter: {
    id: "spitter",
    name: "Spitter",
    glyph: "P",
    health: 70,
    scale: 1.05,
    tint: 0x2c2a1a,
    patrolSpeed: 0.9,
    investigateSpeed: 1.8,
    chaseSpeed: 2.8,
    attackRange: 1.3,
    attackDamage: 12,
    windup: 0.7,
    recover: 0.6,
    hearing: 1,
    sight: 1,
    light: "sees",
    behaviour: "ranged",
    ranged: { range: 13, minRange: 5, speed: 11, damage: 18, cooldown: 2.6 },
    takedown: true,
    radius: 0.38,
    stride: 3,
    voicePitch: 0.8,
    look: { rig: "humanoid", veins: 0xb8ff3a, build: 1.15, sac: true, skull: "split", hunch: 0.45 },
  },
  swarm: {
    id: "swarm",
    name: "Swarm",
    glyph: "%",
    health: 9,
    scale: 1,
    tint: 0x2a2220,
    patrolSpeed: 1.4,
    investigateSpeed: 3,
    chaseSpeed: 5,
    attackRange: 0.9,
    attackDamage: 5,
    windup: 0.18,
    recover: 0.5,
    hearing: 1.3,
    sight: 0.5,
    light: "sees",
    pack: 6,
    takedown: true,
    radius: 0.16,
    stride: 9,
    voicePitch: 3,
    look: { rig: "rat", veins: 0xff5a2a },
  },
  mimic: {
    id: "mimic",
    name: "Mimic",
    glyph: "Q",
    health: 90,
    scale: 1.05,
    tint: 0x302624,
    patrolSpeed: 0.6,
    investigateSpeed: 2,
    chaseSpeed: 4,
    attackRange: 1.4,
    attackDamage: 24,
    windup: 0.35,
    recover: 0.8,
    hearing: 1.2,
    sight: 0.8,
    light: "sees",
    behaviour: "lurker",
    takedown: true,
    radius: 0.36,
    stride: 3.4,
    voicePitch: 0.9,
    look: { rig: "humanoid", veins: 0xff4a8a, skull: "split", eyes: 0, hunch: 0.55 },
  },
  remnant: {
    id: "remnant",
    name: "The Remnant",
    glyph: "@",
    health: 1100,
    scale: 1,
    tint: 0x4a2622,
    patrolSpeed: 0,
    investigateSpeed: 0,
    chaseSpeed: 0,
    attackRange: 6,
    attackDamage: 30,
    windup: 0.9,
    recover: 1.1,
    hearing: 2,
    sight: 1.5,
    light: "ignores",
    behaviour: "boss",
    ranged: { range: 24, minRange: 0, speed: 12, damage: 16, cooldown: 3 },
    takedown: false,
    armor: 0.35,
    radius: 2.2,
    stride: 1,
    voicePitch: 0.4,
    look: { rig: "mass", veins: 0xff6a3a },
  },
  howler: {
    id: "howler",
    name: "Howler",
    glyph: "N",
    health: 70,
    scale: 1.05,
    tint: 0x3a2a18,
    patrolSpeed: 0.9,
    investigateSpeed: 2.0,
    chaseSpeed: 3.3,
    attackRange: 1.35,
    attackDamage: 14,
    windup: 0.5,
    recover: 0.9,
    hearing: 1.1,
    sight: 1.25,
    light: "sees",
    // The moment it finds you it screams, and everything within earshot comes running.
    behaviour: "howler",
    takedown: true,
    radius: 0.35,
    stride: 3.4,
    voicePitch: 1.35,
    look: { rig: "humanoid", veins: 0xffc23a, build: 0.75, arms: 1.3, legs: 1.15, eyes: 4, skull: "split", hunch: 0.25 },
  },
  choir: {
    id: "choir",
    name: "The Choir",
    glyph: "&",
    health: 1700,
    scale: 1.35,
    tint: 0x3a2240,
    patrolSpeed: 0,
    investigateSpeed: 0,
    chaseSpeed: 0,
    attackRange: 6.5,
    attackDamage: 36,
    windup: 0.85,
    recover: 1,
    hearing: 2.2,
    sight: 1.6,
    light: "ignores",
    behaviour: "boss",
    ranged: { range: 26, minRange: 0, speed: 13, damage: 18, cooldown: 2.8 },
    takedown: false,
    armor: 0.3,
    radius: 2.7,
    stride: 1,
    voicePitch: 0.33,
    look: { rig: "mass", veins: 0xa86aff },
  },
} as const satisfies Record<string, EnemyDef>;

export type EnemyKind = keyof typeof ENEMIES;

/** Widened view of a definition, so optional traits can be read on any kind. */
export function enemyDef(kind: EnemyKind): EnemyDef {
  return ENEMIES[kind];
}

/** Map glyph → enemy kind, derived from the definitions above. */
export const ENEMY_GLYPHS: ReadonlyMap<string, EnemyKind> = new Map(
  (Object.keys(ENEMIES) as EnemyKind[]).map((kind) => [ENEMIES[kind].glyph, kind])
);
