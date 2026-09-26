import { afterEach, describe, expect, it, vi } from "vitest";
import { lastRelayState, resetIceServers } from "./ice";
import { MeteredSignaling, realtimeKey, type RealtimeClient } from "./meteredSignaling";

/** An in-memory stand-in for the Metered Realtime service: one shared channel bus. */
function fakeService() {
  const clients: FakeClient[] = [];
  class FakeClient implements RealtimeClient {
    handlers = new Map<string, ((p: never) => void)[]>();
    channels = new Set<string>();
    async connect() {
      this.emit("connected", { isReconnect: false, iceServers: [{ urls: "turn:relay.example:443", username: "u", credential: "c" }] });
    }
    async close() {}
    async subscribe(channel: string) {
      const others = clients.filter((c) => c !== this && c.channels.has(channel));
      this.channels.add(channel);
      this.emit("presence", { channel, joined: others.map(() => ({ peerId: "x" })) });
    }
    async publish(channel: string, data: unknown) {
      for (const c of clients) if (c !== this && c.channels.has(channel)) c.emit("message", { channel, data });
    }
    on(event: string, handler: (p: never) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string, payload: unknown) {
      for (const h of this.handlers.get(event) ?? []) h(payload as never);
    }
  }
  return async () => {
    const c = new FakeClient();
    clients.push(c);
    return c;
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("co-op matchmaking over Metered Realtime", () => {
  afterEach(() => {
    resetIceServers();
    vi.useRealTimers();
  });

  it("delivers messages only to the id they're addressed to", async () => {
    const factory = fakeService();
    const host = new MeteredSignaling("room-1", "room-1", "pk", false, factory);
    const guest = new MeteredSignaling("room-1-g1", "room-1", "pk", true, factory);
    const other = new MeteredSignaling("room-1-g2", "room-1", "pk", true, factory);
    const got: Record<string, string[]> = { host: [], guest: [], other: [] };
    host.onMessage = (m) => got.host.push(`${m.type} from ${m.src}`);
    guest.onMessage = (m) => got.guest.push(`${m.type} from ${m.src}`);
    other.onMessage = (m) => got.other.push(m.type);
    host.connect();
    await flush();
    guest.connect();
    other.connect();
    await flush();
    guest.send("room-1", "OFFER", { sdp: "v=0" });
    host.send("room-1-g1", "ANSWER", { sdp: "v=0" });
    await flush();
    expect(got.host).toEqual(["OFFER from room-1-g1"]);
    expect(got.guest).toEqual(["ANSWER from room-1"]);
    expect(got.other).toEqual([]);
  });

  it("tells a guest at once when nobody is hosting that code", async () => {
    const guest = new MeteredSignaling("room-2-g1", "room-2", "pk", true, fakeService());
    const types: string[] = [];
    guest.onMessage = (m) => types.push(m.type);
    guest.connect();
    await flush();
    expect(types).toEqual(["EXPIRE"]);
  });

  it("uses the relay servers the service hands out", async () => {
    const host = new MeteredSignaling("room-3", "room-3", "pk", false, fakeService());
    host.connect();
    await flush();
    expect(lastRelayState()).toBe("ready");
  });

  it("reports a service it can't reach", async () => {
    const guest = new MeteredSignaling("g", "room-4", "pk", true, async () => Promise.reject(new Error("offline")));
    let reason = "";
    guest.onError = (r) => (reason = r);
    guest.connect();
    await flush();
    await flush();
    expect(reason).toBe("unreachable");
  });

  it("ships with a key, which a build or URL setting can replace or switch off", () => {
    expect(realtimeKey({}, "")).toMatch(/^pk_live_/);
    expect(realtimeKey({ VITE_METERED_REALTIME_KEY: "pk_live_mine" }, "")).toBe("pk_live_mine");
    // An unset GitHub variable reaches the build as "", which must still mean the default.
    expect(realtimeKey({ VITE_METERED_REALTIME_KEY: "" }, "")).toMatch(/^pk_live_/);
    expect(realtimeKey({ VITE_METERED_REALTIME_KEY: "  " }, "")).toMatch(/^pk_live_/);
    expect(realtimeKey({}, "?realtimeKey=off")).toBeNull();
  });
});
