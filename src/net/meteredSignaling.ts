import { addRelayServers } from "./ice";
import type { SignalMessage, SignalType } from "./signaling";

/**
 * Signaling over Metered Realtime (free: 100k messages a month; a game
 * needs a few dozen to connect). Same job as `Signaling` — a mailbox for
 * the connection offer, answer and ICE candidates — but over a managed
 * pub/sub service instead of the public PeerJS server, which stopped
 * forwarding offers.
 *
 * Each room is a channel named after the room's id. Everyone in it sees
 * every message, so messages carry `src` and `dst` and each side keeps only
 * the ones addressed to it. Presence tells a guest straight away whether
 * anyone is hosting under that code. The service's welcome also carries
 * TURN credentials, which go to the relay list.
 *
 * Needs a publishable key (`pk_live_…`) with Subscribe, Publish and
 * Presence allowed — Metered's defaults.
 */

/**
 * The game's publishable key for Metered Realtime. Publishable keys are made
 * to ship in browser code (they can only join channels and exchange small
 * messages, within the free quota). Override with `VITE_METERED_REALTIME_KEY`
 * at build time or `?realtimeKey=` in the URL; set either to "off" to use the
 * PeerJS server instead.
 */
const DEFAULT_REALTIME_KEY = "pk_live_d92343d55efddbd122c16b21de18fdc672cc1ef9";

export function realtimeKey(env: Record<string, string | undefined> = import.meta.env, search = location.search): string | null {
  // `||`, not `??`: a build variable that isn't set arrives as an empty string, which means "use the default".
  const key = (new URLSearchParams(search).get("realtimeKey") || env.VITE_METERED_REALTIME_KEY?.trim() || DEFAULT_REALTIME_KEY).trim();
  return key && key !== "off" ? key : null;
}

/** The parts of the SDK's `SignallingClient` used here (and faked in tests). */
export interface RealtimeClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  subscribe(channel: string): Promise<void>;
  publish(channel: string, data: unknown): Promise<void>;
  on(event: string, handler: (payload: never) => void): unknown;
}

export type RealtimeFactory = (apiKey: string) => Promise<RealtimeClient>;

/** Loads the SDK only when co-op is actually used. */
const defaultFactory: RealtimeFactory = async (apiKey) => {
  const { SignallingClient } = await import("@metered-ca/realtime");
  // Testing only: `?realtimeUrl=` points at a stand-in or a local bridge.
  const url = new URLSearchParams(location.search).get("realtimeUrl") ?? undefined;
  return new SignallingClient({ apiKey, url, reconnect: { maxAttempts: 8 }, autoResubscribe: true }) as unknown as RealtimeClient;
};

/** How long a guest waits for the room's presence list before deciding nobody hosts it. */
const PRESENCE_WAIT_MS = 4000;

interface Envelope {
  type: string;
  src: string;
  dst: string;
  payload?: unknown;
}

export class MeteredSignaling {
  onOpen: ((reconnected: boolean) => void) | null = null;
  onMessage: ((msg: SignalMessage) => void) | null = null;
  onError: ((reason: string) => void) | null = null;
  /** Something worth showing while connecting (the service dropped us and is reconnecting, and why). */
  onNote: ((note: string) => void) | null = null;

  private client: RealtimeClient | null = null;
  private closed = false;
  private everOpened = false;
  private presenceTimer = 0;

  constructor(
    readonly id: string,
    private readonly channel: string,
    private readonly apiKey: string,
    /** Guests check that someone is hosting the room. */
    private readonly guest: boolean,
    private readonly factory: RealtimeFactory = defaultFactory
  ) {}

  connect(): void {
    void this.run();
  }

  private async run(): Promise<void> {
    let client: RealtimeClient;
    try {
      client = await this.factory(this.apiKey);
    } catch {
      return this.fail("unreachable");
    }
    if (this.closed) return void client.close().catch(() => undefined);
    this.client = client;

    client.on("connected", ((e: { isReconnect?: boolean; iceServers?: RTCIceServer[] }) => {
      if (e.iceServers) addRelayServers(e.iceServers);
      // After a reconnection the SDK joins the channel again by itself.
      if (e.isReconnect && !this.closed) this.onOpen?.(true);
    }) as (p: never) => void);
    client.on("message", ((m: { channel: string; data: unknown }) => this.receive(m.channel, m.data)) as (p: never) => void);
    client.on("presence", ((p: { channel: string; joined?: unknown[] }) => {
      // The first presence list after joining: is anyone else here?
      if (!this.guest || p.channel !== this.channel || !this.presenceTimer) return;
      clearTimeout(this.presenceTimer);
      this.presenceTimer = 0;
      if (!p.joined || p.joined.length === 0) this.onMessage?.({ type: "EXPIRE" });
      else this.onNote?.(`room found (${p.joined.length} there)`);
    }) as (p: never) => void);
    client.on("server-error", ((e: { code?: string; message?: string }) => {
      const code = String(e.code ?? "").toLowerCase();
      this.onNote?.(`matchmaking error: ${e.code ?? "?"}${e.message ? ` (${e.message})` : ""}`);
      if (/auth|key|unauthori|forbidden|permission/.test(code)) this.fail("server");
    }) as (p: never) => void);
    client.on("disconnected", ((e: { willReconnect?: boolean; code?: number }) => {
      if (e.willReconnect) this.onNote?.(`matchmaking dropped (code ${e.code ?? "?"}), reconnecting`);
      else this.fail(this.everOpened ? "closed" : "unreachable");
    }) as (p: never) => void);

    try {
      await client.connect();
    } catch {
      return this.fail("unreachable");
    }
    await this.join();
  }

  private async join(): Promise<void> {
    if (this.closed || !this.client) return;
    try {
      if (this.guest) {
        // If no presence list arrives at all, assume the room is empty.
        this.presenceTimer = setTimeout(() => {
          this.presenceTimer = 0;
          this.onMessage?.({ type: "EXPIRE" });
        }, PRESENCE_WAIT_MS);
      }
      await this.client.subscribe(this.channel);
    } catch {
      return this.fail("server");
    }
    this.everOpened = true;
    this.onOpen?.(false);
  }

  private receive(channel: string, data: unknown): void {
    if (channel !== this.channel || !data || typeof data !== "object") return;
    const m = data as Partial<Envelope>;
    if (m.dst !== this.id || typeof m.type !== "string" || typeof m.src !== "string") return;
    this.onMessage?.({ type: m.type, src: m.src, payload: m.payload });
  }

  send(dst: string, type: SignalType, payload: unknown): void {
    const env: Envelope = { type, src: this.id, dst, payload };
    void this.client
      ?.publish(this.channel, env)
      .catch((e: { code?: string; message?: string }) => this.onNote?.(`sending ${type} failed: ${e?.code ?? e?.message ?? "?"}`));
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.close();
    this.onError?.(reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.presenceTimer);
    void this.client?.close().catch(() => undefined);
    this.client = null;
  }
}
