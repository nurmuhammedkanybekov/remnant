import type { DifficultyId } from "../content/difficulty";
import type { EnemyKind } from "../content/enemies";
import type { EndingId } from "../content/story";
import type { WeaponId } from "../content/weapons";
import type { Gait } from "../player/playerController";

/**
 * Everything the two copies of the game say to each other.
 *
 * The host runs the world: creatures, doors, generators, the boss, the level
 * ending. Each player moves their own character (so movement never feels
 * laggy) and reports where they are 20 times a second. Everything else is an
 * event: the guest asks, the host decides and tells both.
 */

/** Bump when messages change shape: mismatched versions refuse to play together. */
export const PROTOCOL_VERSION = 1;

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
  | { t: "hello"; v: number }
  /** Host → guest: start (or move on to) a level. `fresh` = a new run, starting loadouts. */
  | { t: "start"; level: number; difficulty: DifficultyId; fresh: boolean }
  /** Host → guest: retry the level after a wipe, from the checkpoint if `checkpoint`. */
  | { t: "restart"; checkpoint: boolean };

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
}

/**
 * Host → guest, 15 times a second: every creature, flattened. See
 * `Enemy.netState` for the layout of each entry.
 */
export interface EnemySnapshot {
  t: "es";
  e: number[][];
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
  | { t: "shot"; w: WeaponId; walls: number[][]; blood: number[][] }
  /** Guest → host. */
  | { t: "noise"; x: number; z: number; r: number }
  | { t: "hit"; i: number; dmg: number; part: "head" | "body"; x: number; z: number }
  | { t: "takedown"; i: number; x: number; z: number }
  | { t: "shove"; i: number; dx: number; dz: number }
  // --- world
  /** Guest → host: "I pressed use on interactable i". Host → guest: "interactable i was used". */
  | { t: "use"; i: number }
  | { t: "used"; i: number }
  | { t: "pickup"; i: number }
  | { t: "restock"; i: number }
  | { t: "trigger"; key: string }
  | { t: "marker"; i: number }
  // --- the team
  | { t: "revive" }
  /** Everyone is down (or someone bled out): the level is lost. */
  | { t: "wipe" }
  /** Host → guest: the level is done. */
  | { t: "finish"; ending: EndingId | null };

export type NetMsg = FlowMsg | SessionMsg;

/** Rounds for the wire: centimetres are plenty and keep packets small. */
export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
