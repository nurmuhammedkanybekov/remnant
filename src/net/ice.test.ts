import { afterEach, describe, expect, it, vi } from "vitest";
import { hasRelay, iceConfig, iceServers, relayState, resetIceServers } from "./ice";

describe("co-op relay settings", () => {
  it("has no relay unless one is configured", () => {
    expect(hasRelay(iceConfig({}, ""))).toBe(false);
    expect(hasRelay(iceConfig({ VITE_METERED_APP: "x.metered.live" }, ""))).toBe(false); // the key is needed too
    expect(hasRelay(iceConfig({ VITE_METERED_APP: "x.metered.live", VITE_METERED_API_KEY: "k" }, ""))).toBe(true);
    expect(hasRelay(iceConfig({ VITE_TURN_URLS: "turn:a:3478, turns:a:443" }, ""))).toBe(true);
  });

  it("lets the page URL override the build (for testing), including forcing the relay", () => {
    const cfg = iceConfig({}, "?turn=turn:127.0.0.1:3478&turnUser=u&turnPass=p&relayOnly");
    expect(cfg.turnUrls).toEqual(["turn:127.0.0.1:3478"]);
    expect(cfg.turnUser).toBe("u");
    expect(cfg.relayOnly).toBe(true);
  });

  afterEach(() => {
    resetIceServers();
    vi.unstubAllGlobals();
  });

  it("always includes STUN, and a configured TURN server after it", async () => {
    const servers = await iceServers(iceConfig({ VITE_TURN_URLS: "turn:t:3478", VITE_TURN_USERNAME: "u", VITE_TURN_CREDENTIAL: "c" }, ""));
    expect(String(servers[0].urls)).toContain("stun:");
    expect(servers[1]).toEqual({ urls: ["turn:t:3478"], username: "u", credential: "c" });
  });

  const metered = iceConfig({ VITE_METERED_APP: "remnant.metered.live", VITE_METERED_API_KEY: "k" }, "");

  it("reports a relay that accepts the key as ready, and uses its servers", async () => {
    const relay = { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "u", credential: "c" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([relay]), { status: 200 }))
    );
    expect(await relayState(metered)).toBe("ready");
    expect(await iceServers(metered)).toContainEqual(relay);
  });

  it("reports a key the relay refuses (a different kind of Metered key) as rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"Invalid API Key"}', { status: 401 }))
    );
    expect(await relayState(metered)).toBe("rejected");
    // Still connects without it: STUN only.
    expect(await iceServers(metered)).toHaveLength(1);
  });

  it("reports a relay it can't reach as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline")))
    );
    expect(await relayState(metered)).toBe("unreachable");
  });
});
