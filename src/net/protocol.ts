import type { DifficultyId } from "../content/difficulty";
import type { EnemyKind } from "../content/enemies";
import type { EndingId } from "../content/story";
import type { WeaponId } from "../content/weapons";
import type { Gait } from "../player/playerController";

/**
 * Everything the copies of the game say to each other: two or three players.
 *
 * The host runs the world: creatures, doors, generators, the boss, the level
 * ending. Each player moves their own character (so movement never feels
 * laggy) and reports where they are 20 times a second. Everything else is an
 * event: a guest asks, the host decides and tells everyone.
 *
 * Each guest is connected to the host only. The host passes on what one
 * guest says that the other needs to see (`RELAYED`), stamped with who said
 * it (`from`: 0 is the host, 1 and 2 the guests).
 */

/** Bump when messages change shape: mismatched versions refuse to play together. */
export const PROTOCOL_VERSION = 2;

/** Guests a host takes: three players in all. */
export const MAX_GUESTS = 2;

/** No 0/O or 1/I/L, so a code read out loud or off a screen can't be misread. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

export function makeRoomCode(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

/** Cleans up what a player typed (case, spaces, dashes). Null if it can't be a code. */
export function normalizeRoomCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== CODE_LENGTH) return null;
  return [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}

/** The signaling id the host registers under. */
export function roomPeerId(code: string): string {
  return `remnant-v${PROTOCOL_VERSION}-${code.toLowerCase()}`;
}

// ------------------------------------------------------------------ game flow

export type FlowMsg =
  /** Both, on connecting: `app` is the game's version — both must run the same build. */
  | { t: "hello"; v: number; app: string }
  /**
   * Host → guest: start (or move on to) a level. `fresh` = a new run, starting loadouts.
   * `ep` numbers each level attempt; in-level messages carry it, and ones from an
   * earlier attempt (still in flight after a retry) are dropped.
   */
  | { t: "start"; level: number; difficulty: DifficultyId; fresh: boolean; ep: number; slot?: number; players?: number }
  /** Host → guest: retry the level after a wipe, from the checkpoint if `checkpoint`. */
  | { t: "restart"; checkpoint: boolean; ep: number; players?: number };

// ------------------------------------------------------------------ in a level

/** One player's state, 20 times a second. Positions are rounded to centimetres. */
export interface PlayerState {
  t: "ps";
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  gait: Gait;
  wet: boolean;
  /** Flashlight brightness 0..1, or 0 when off. */
  torch: number;
  weapon: WeaponId;
  /** Health 0..1. */
  hp: number;
  /** Downed, waiting to be revived. */
  down: boolean;
  /** Seconds of bleed-out left while down. */
  bleed: number;
  /** Their chosen look (`CharacterLook`); checked on arrival. */
  look?: string;
  /** Holding their breath (creatures beside them can't hear them breathe). */
  held?: boolean;
  /** Talking on voice chat right now (creatures close by can hear it). */
  talk?: boolean;
  /** Counts up with every state sent (see `EnemySnapshot.n`). */
  n?: number;
}

/**
 * Host → guest, 15 times a second: every creature, flattened. See
 * `Enemy.netState` for the layout of each entry.
 */
export interface EnemySnapshot {
  t: "es";
  e: number[][];
  /** Counts up with every snapshot: the fast channel can deliver out of order, and an older one is dropped. */
  n?: number;
}

export type SessionMsg =
  | PlayerState
  | EnemySnapshot
  // --- creatures (host → guest)
  | { t: "vocal"; i: number; k: string }
  | { t: "spawn"; kind: EnemyKind; x: number; z: number }
  | { t: "proj"; from: number[]; to: number[]; speed: number; dmg: number }
  | { t: "lure"; i: number; r: number }
  /** A creature struck the guest. */
  | { t: "hurt"; dmg: number; from: number[]; heavy: boolean }
  | { t: "killed"; i: number }
  | { t: "bossPhase"; phase: number }
  | { t: "bossDead" }
  // --- combat (both ways)
  | { t: "shot"; w: WeaponId; walls: number[][]; blood: number[][]; lamps?: number[] }
  /** Guest → host. */
  | { t: "noise"; x: number; z: number; r: number }
  | { t: "hit"; i: number; dmg: number; part: "head" | "body"; x: number; z: number }
  | { t: "takedown"; i: number; x: number; z: number }
  | { t: "shove"; i: number; dx: number; dz: number }
  /** A bottle thrown: start and velocity (both ways; each side flies it, only the thrower's makes noise). */
  | { t: "toss"; p: number[]; v: number[] }
  // --- world
  /** Guest → host: "I pressed use on interactable i". Host → guest: "interactable i was used". */
  | { t: "use"; i: number }
  | { t: "used"; i: number }
  | { t: "pickup"; i: number }
  | { t: "restock"; i: number }
  | { t: "trigger"; key: string }
  | { t: "marker"; i: number }
  // --- the team
  /** `who` (a player slot) is back on their feet. */
  | { t: "revive"; who: number }
  /** Host → guests: the player in `slot` left the game. */
  | { t: "gone"; slot: number }
  /** Everyone is down (or someone bled out): the level is lost. */
  | { t: "wipe" }
  /** Host → guest: the level is done. */
  | { t: "finish"; ending: EndingId | null };

/** In-level messages on the wire carry the level attempt they belong to, and (relayed) who sent them. */
export type NetMsg = FlowMsg | (SessionMsg & { ep?: number; from?: number });

/** What a guest says that the other guest needs too: the host passes these on. */
export const RELAYED: ReadonlySet<SessionMsg["t"]> = new Set(["ps", "shot", "toss", "pickup", "trigger", "revive", "wipe"]);

/** Rounds for the wire: centimetres are plenty and keep packets small. */
export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
