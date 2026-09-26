/**
 * Enemy definitions. Adding a creature starts here: give it an id, a map
 * glyph and its numbers, and levels can place it straight away.
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
  /** Collision radius. */
  radius: number;
  /** Walk-cycle speed relative to ground speed (lower = heavier gait). */
  stride: number;
  /** Voice pitch multiplier for synthesized vocals. */
  voicePitch: number;
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
    radius: 0.35,
    stride: 3.6,
    voicePitch: 1,
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
    radius: 0.5,
    stride: 2.6,
    voicePitch: 0.6,
  },
} as const satisfies Record<string, EnemyDef>;

export type EnemyKind = keyof typeof ENEMIES;

/** Map glyph → enemy kind, derived from the definitions above. */
export const ENEMY_GLYPHS: ReadonlyMap<string, EnemyKind> = new Map(
  (Object.keys(ENEMIES) as EnemyKind[]).map((kind) => [ENEMIES[kind].glyph, kind])
);
