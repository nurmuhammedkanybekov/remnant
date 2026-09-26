import { iceConfig, iceServers, lastRelayState } from "./ice";
import { roomPeerId } from "./protocol";
import { steadyInterval } from "./timer";
import { MeteredSignaling, realtimeKey } from "./meteredSignaling";
import { DEFAULT_SIGNAL_URL, Signaling, type SignalMessage } from "./signaling";

/**
 * A direct browser-to-browser connection (WebRTC data channels) between the
 * host and one guest, found through a room code.
 *
 * Two channels: `reliable` (ordered, every message arrives — events) and
 * `fast` (unordered, no retransmits — the 20 Hz state stream, where a late
 * packet is worthless anyway).
 */

export type Role = "host" | "guest";

/** Give up on a connection that hasn't opened by then (a relay takes a little longer to set up). */
const CONNECT_TIMEOUT_MS = 30000;
/** No message at all for this long means the other side is gone. */
const SILENCE_TIMEOUT_MS = 8000;
const PING_MS = 1000;

/** Why a link ended, in words for the player — for a failed connection, taking the relay's state into account. */
export function describeClose(reason: string): string {
  if (reason === "timeout") {
    switch (lastRelayState()) {
      case "ready":
        return "Couldn't connect to the other player, even through the relay. Check both internet connections and try again.";
      case "rejected":
        return "Couldn't connect directly, and the relay refused its key. The relay needs the API key shown next to a TURN credential in the Metered dashboard (see the README).";
      case "unreachable":
        return "Couldn't connect directly, and the relay couldn't be reached. Try again in a minute.";
    }
  }
  return CLOSE_REASONS[reason] ?? CLOSE_REASONS.lost;
}

/** Why a link ended, in words for the player. */
export const CLOSE_REASONS: Record<string, string> = {
  "id-taken": "That room code is already in use. Try hosting again.",
  "no-room": "No game with that code. Check it with the host.",
  full: "That game already has two players.",
  unreachable: "Couldn't reach the matchmaking server. Check your connection.",
  server: "The matchmaking server refused the connection. Try again in a moment.",
  closed:
    "Lost the connection to the matchmaking server and couldn't get it back. Check your internet connection and try again — if it keeps happening, the free server may be busy; wait a minute.",
  timeout:
    "Couldn't connect to the other player. Some networks (school, office, some mobile data) block direct connections between browsers — try another network, or turn on the free relay (see the README).",
  unsupported: "This browser can't make direct connections (WebRTC). Try an up-to-date Chrome, Edge or Firefox.",
  version: "The other player is running a different version of REMNANT. Both refresh the page and try again.",
  left: "The other player left the game.",
  lost: "The connection to the other player was lost.",
};

interface Offer {
  sdp: RTCSessionDescriptionInit;
}

export class PeerLink {
  /** The direct connection is open: messages can flow. */
  onOpen: (() => void) | null = null;
  onMessage: ((data: unknown) => void) | null = null;
  /** The link ended (or never started); `reason` is a key of CLOSE_REASONS. */
  onClose: ((reason: string) => void) | null = null;
  /** Host: someone tried to join but the connection couldn't be made. The room stays open for another try. */
  onJoinFailed: (() => void) | null = null;

  private readonly signaling: Signaling | MeteredSignaling;
  private pc: RTCPeerConnection | null = null;
  /** Set as soon as a partner is chosen (before the connection exists), so a second one is turned away. */
  private remoteId: string | null = null;
  private reliable: RTCDataChannel | null = null;
  private fast: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private timers: number[] = [];
  private lastHeard = 0;
  private stopPing: (() => void) | null = null;
  private closed = false;
  private isOpen = false;

  constructor(
    readonly role: Role,
    readonly code: string,
    /** A PeerJS-protocol server to use instead of Metered Realtime (`?signal=`, or when no key is set). */
    signalUrl: string | null = null
  ) {
    const id = role === "host" ? roomPeerId(code) : `${roomPeerId(code)}-g${Math.random().toString(36).slice(2, 8)}`;
    const key = realtimeKey();
    this.signaling =
      !signalUrl && key
        ? new MeteredSignaling(id, roomPeerId(code), key, role === "guest")
        : new Signaling(id, signalUrl ?? DEFAULT_SIGNAL_URL);
    this.signaling.onOpen = () => {
      // A guest calls the host once; after a reconnection mid-handshake the call already under way carries on.
      if (role === "guest" && !this.remoteId) void this.call();
    };
    this.signaling.onMessage = (m) => void this.onSignal(m);
    this.signaling.onError = (reason) => {
      // Once connected directly, the mailbox going away doesn't matter.
      if (!this.isOpen) this.close(reason);
    };
  }

  get open(): boolean {
    return this.isOpen;
  }

  /** Same as `open` (the name the game session uses). */
  get connected(): boolean {
    return this.isOpen;
  }

  start(): void {
    if (typeof RTCPeerConnection === "undefined") {
      // Let the caller finish wiring up before hearing about it.
      window.setTimeout(() => this.close("unsupported"));
      return;
    }
    this.signaling.connect();
    if (this.role === "guest") this.timers.push(window.setTimeout(() => !this.isOpen && this.close("timeout"), CONNECT_TIMEOUT_MS));
  }

  /** Sends a message. `fast` ones may be dropped; everything else arrives in order. */
  send(data: unknown, fast = false): void {
    const ch = fast && this.fast?.readyState === "open" ? this.fast : this.reliable;
    if (ch?.readyState !== "open") return;
    try {
      ch.send(JSON.stringify(data));
    } catch {
      // A full buffer on the fast channel just drops this state packet.
    }
  }

  close(reason = "left"): void {
    if (this.closed) return;
    this.closed = true;
    // Tell the other side straight away rather than letting it time out.
    if (reason === "left") this.send({ t: "bye" });
    this.timers.forEach((t) => window.clearTimeout(t));
    this.stopPing?.();
    this.signaling.close();
    this.reliable?.close();
    this.fast?.close();
    this.pc?.close();
    this.isOpen = false;
    this.onClose?.(reason);
  }

  // ------------------------------------------------------------------ WebRTC

  /** Whether this link is direct or goes through a TURN relay (null if it can't tell). */
  async route(): Promise<"direct" | "relay" | null> {
    const pc = this.pc;
    if (!pc || !this.isOpen) return null;
    try {
      const stats = await pc.getStats();
      let pairId: string | undefined;
      stats.forEach((r: { type: string; selectedCandidatePairId?: string }) => {
        if (r.type === "transport" && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
      });
      const pair = pairId ? (stats.get(pairId) as { localCandidateId?: string } | undefined) : undefined;
      const local = pair?.localCandidateId ? (stats.get(pair.localCandidateId) as { candidateType?: string } | undefined) : undefined;
      if (!local?.candidateType) return null;
      return local.candidateType === "relay" ? "relay" : "direct";
    } catch {
      return null;
    }
  }

  private async newConnection(remoteId: string): Promise<RTCPeerConnection> {
    this.remoteId = remoteId;
    const cfg = iceConfig();
    const servers = await iceServers(cfg);
    const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: cfg.relayOnly ? "relay" : "all" });
    if (this.closed) {
      pc.close();
      return pc;
    }
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling.send(remoteId, "CANDIDATE", { candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== "failed") return;
      if (this.isOpen) this.close("lost");
      else if (this.role === "host") this.dropPending();
      else this.close("timeout");
    };
    // Host: a guest that never gets through mustn't hold the room.
    if (this.role === "host")
      this.timers.push(window.setTimeout(() => this.pc === pc && !this.isOpen && this.dropPending(), CONNECT_TIMEOUT_MS));
    pc.ondatachannel = (e) => this.adopt(e.channel);
    return pc;
  }

  private adopt(ch: RTCDataChannel): void {
    if (ch.label === "fast") this.fast = ch;
    else this.reliable = ch;
    ch.onmessage = (e) => {
      this.lastHeard = performance.now();
      let data: unknown;
      try {
        data = JSON.parse(String(e.data));
      } catch {
        return;
      }
      const t = (data as { t?: string }).t;
      if (t === "ping") return;
      if (t === "bye") return this.close("left");
      this.onMessage?.(data);
    };
    ch.onopen = () => this.checkOpen();
    ch.onclose = () => {
      if (this.isOpen) this.close("lost");
    };
  }

  private checkOpen(): void {
    if (this.isOpen || this.reliable?.readyState !== "open") return;
    this.isOpen = true;
    this.lastHeard = performance.now();
    // The mailbox has done its job; free the room code.
    this.signaling.close();
    // A steady timer: a hidden tab mustn't go quiet long enough to look disconnected.
    this.stopPing = steadyInterval(PING_MS, () => {
      if (this.closed) return;
      this.send({ t: "ping" });
      if (performance.now() - this.lastHeard > SILENCE_TIMEOUT_MS) this.close("lost");
    });
    this.onOpen?.();
  }

  /** Guest: open the channels and send an offer to the room's host. */
  private async call(): Promise<void> {
    const pc = await this.newConnection(roomPeerId(this.code));
    if (this.closed) return;
    this.adopt(pc.createDataChannel("reliable", { ordered: true }));
    this.adopt(pc.createDataChannel("fast", { ordered: false, maxRetransmits: 0 }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.send(this.remoteId!, "OFFER", { sdp: pc.localDescription!.toJSON() } satisfies Offer);
  }

  private async onSignal(m: SignalMessage): Promise<void> {
    const payload = (m.payload ?? {}) as Record<string, unknown>;
    switch (m.type) {
      case "OFFER": {
        if (this.role !== "host" || !m.src) return;
        if (this.remoteId) {
          // Someone else is already in (or on their way in): turn the newcomer away.
          if (m.src !== this.remoteId) this.signaling.send(m.src, "ANSWER", { full: true });
          return;
        }
        const pc = await this.newConnection(m.src);
        if (this.closed) return;
        await pc.setRemoteDescription((payload as unknown as Offer).sdp);
        await this.flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signaling.send(m.src, "ANSWER", { sdp: pc.localDescription!.toJSON() });
        break;
      }
      case "ANSWER": {
        if (this.role !== "guest" || !this.pc) return;
        if (payload.full) return this.close("full");
        await this.pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
        await this.flushCandidates();
        break;
      }
      case "CANDIDATE": {
        const c = payload.candidate as RTCIceCandidateInit | undefined;
        if (!c || (this.remoteId && m.src !== this.remoteId)) return;
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(c).catch(() => undefined);
        else this.pendingCandidates.push(c);
        break;
      }
      case "EXPIRE":
        // The server couldn't deliver our offer: nobody is hosting under that code.
        if (this.role === "guest" && !this.isOpen) this.close("no-room");
        break;
    }
  }

  /** Host: forget a half-made connection so the next guest can try. */
  private dropPending(): void {
    if (this.isOpen || this.closed) return;
    this.pc?.close();
    this.pc = null;
    this.reliable = this.fast = null;
    this.remoteId = null;
    this.pendingCandidates = [];
    this.onJoinFailed?.();
  }

  private async flushCandidates(): Promise<void> {
    const list = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => undefined);
  }
}
