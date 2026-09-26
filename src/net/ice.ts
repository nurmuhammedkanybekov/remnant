/**
 * The servers WebRTC may use to connect two players.
 *
 * - **STUN** (free, public, always on) lets two browsers find a direct path
 *   through their home routers. That works on most networks.
 * - **TURN** is a relay for the networks where no direct path exists (strict
 *   school, office or mobile networks). A relay costs bandwidth, so there's
 *   no free public one without an account; the game supports two setups:
 *
 *   1. Metered's free Open Relay (20 GB/month, no credit card) — set
 *      `VITE_METERED_APP` (e.g. `remnant.metered.live`) and
 *      `VITE_METERED_API_KEY` when building. Credentials are fetched per game.
 *   2. Any TURN server — set `VITE_TURN_URLS` (comma-separated),
 *      `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL`.
 *
 * For testing, the same can be given in the page URL:
 * `?turn=turn:host:3478&turnUser=…&turnPass=…`, and `?relayOnly` forces the
 * relay so it can be checked.
 *
 * WebRTC always prefers a direct path and only falls back to the relay.
 */

const STUN: RTCIceServer = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.relay.metered.ca:80"] };
const FETCH_TIMEOUT_MS = 5000;

/** Build-time settings, read once. Empty strings mean "not set". */
interface IceConfig {
  meteredApp: string;
  meteredKey: string;
  turnUrls: string[];
  turnUser: string;
  turnPass: string;
  relayOnly: boolean;
}

export function iceConfig(env: Record<string, string | undefined> = import.meta.env, search = location.search): IceConfig {
  const q = new URLSearchParams(search);
  const list = (s: string | null | undefined) =>
    (s ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
  return {
    meteredApp: (q.get("meteredApp") ?? env.VITE_METERED_APP ?? "").trim(),
    meteredKey: (q.get("meteredKey") ?? env.VITE_METERED_API_KEY ?? "").trim(),
    turnUrls: list(q.get("turn") ?? env.VITE_TURN_URLS),
    turnUser: q.get("turnUser") ?? env.VITE_TURN_USERNAME ?? "",
    turnPass: q.get("turnPass") ?? env.VITE_TURN_CREDENTIAL ?? "",
    relayOnly: q.has("relayOnly"),
  };
}

/** Is any relay set up? (Changes what we tell players whose connection fails.) */
export function hasRelay(cfg = iceConfig()): boolean {
  return (cfg.meteredApp !== "" && cfg.meteredKey !== "") || cfg.turnUrls.length > 0;
}

let cached: Promise<RTCIceServer[]> | null = null;

/** The ICE servers for a new connection. Never throws: a relay that can't be reached is just left out. */
export function iceServers(cfg = iceConfig()): Promise<RTCIceServer[]> {
  cached ??= build(cfg);
  return cached;
}

async function build(cfg: IceConfig): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [STUN];
  if (cfg.turnUrls.length) servers.push({ urls: cfg.turnUrls, username: cfg.turnUser, credential: cfg.turnPass });
  if (cfg.meteredApp && cfg.meteredKey) {
    const host = cfg.meteredApp.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(`https://${host}/api/v1/turn/credentials?apiKey=${encodeURIComponent(cfg.meteredKey)}`, {
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const list = (await res.json()) as unknown;
        if (Array.isArray(list)) servers.push(...list.filter((s): s is RTCIceServer => typeof s === "object" && s !== null && "urls" in s));
      } else console.warn(`TURN credentials request failed (${res.status}); connecting without a relay.`);
    } catch {
      console.warn("TURN credentials unavailable; connecting without a relay.");
      // Try again next game rather than caching the failure.
      cached = null;
    }
  }
  return servers;
}

/** Forget cached credentials (they expire). */
export function resetIceServers(): void {
  cached = null;
}
