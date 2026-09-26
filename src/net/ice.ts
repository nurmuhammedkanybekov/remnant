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

/**
 * What happened when the relay was last set up:
 * off (none configured), ready, rejected (the relay said the key or login is
 * wrong), unreachable (couldn't ask it).
 */
export type RelayState = "off" | "ready" | "rejected" | "unreachable";
let state: RelayState = "off";

/** The relay's state after the latest `iceServers()` (checks it if it hasn't been yet). */
export async function relayState(cfg = iceConfig()): Promise<RelayState> {
  await iceServers(cfg);
  return state;
}

/** The last known relay state, without checking. */
export function lastRelayState(): RelayState {
  return state;
}

let cached: Promise<RTCIceServer[]> | null = null;

/** The ICE servers for a new connection. Never throws: a relay that can't be reached is just left out. */
export function iceServers(cfg = iceConfig()): Promise<RTCIceServer[]> {
  cached ??= build(cfg);
  return cached;
}

async function build(cfg: IceConfig): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [STUN];
  state = "off";
  if (cfg.turnUrls.length) {
    servers.push({ urls: cfg.turnUrls, username: cfg.turnUser, credential: cfg.turnPass });
    state = "ready";
  }
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
        const relays = Array.isArray(list) ? list.filter((s): s is RTCIceServer => typeof s === "object" && s !== null && "urls" in s) : [];
        servers.push(...relays);
        if (relays.length) state = "ready";
        else if (state === "off") state = "rejected";
      } else {
        // 401/403: the key is wrong (a different kind of Metered key, or a typo).
        console.warn(`TURN credentials request failed (${res.status}); connecting without a relay.`);
        if (state === "off") state = res.status === 401 || res.status === 403 ? "rejected" : "unreachable";
        if (state === "unreachable") cached = null;
      }
    } catch {
      console.warn("TURN credentials unavailable; connecting without a relay.");
      if (state === "off") state = "unreachable";
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
