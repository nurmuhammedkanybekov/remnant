import { roomPeerId } from "./protocol";
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

const ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
/** Give up on a connection that hasn't opened by then. */
const CONNECT_TIMEOUT_MS = 20000;
/** No message at all for this long means the other side is gone. */
const SILENCE_TIMEOUT_MS = 8000;
const PING_MS = 1000;

/** Why a link ended, in words for the player. */
export const CLOSE_REASONS: Record<string, string> = {
  "id-taken": "That room code is already in use. Try hosting again.",
  "no-room": "No game with that code. Check it with the host.",
  full: "That game already has two players.",
  unreachable: "Couldn't reach the matchmaking server. Check your connection.",
  server: "The matchmaking server refused the connection. Try again in a moment.",
  closed: "Lost the connection to the matchmaking server.",
  timeout: "Couldn't connect to the other player. Some networks block direct connections between browsers — try another network.",
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

  private readonly signaling: Signaling;
  private pc: RTCPeerConnection | null = null;
  private remoteId: string | null = null;
  private reliable: RTCDataChannel | null = null;
  private fast: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private timers: number[] = [];
  private lastHeard = 0;
  private closed = false;
  private isOpen = false;

  constructor(
    readonly role: Role,
    readonly code: string,
    signalUrl = DEFAULT_SIGNAL_URL
  ) {
    const id = role === "host" ? roomPeerId(code) : `${roomPeerId(code)}-g${Math.random().toString(36).slice(2, 8)}`;
    this.signaling = new Signaling(id, signalUrl);
    this.signaling.onOpen = () => {
      if (role === "guest") void this.call();
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
    this.signaling.close();
    this.reliable?.close();
    this.fast?.close();
    this.pc?.close();
    this.isOpen = false;
    this.onClose?.(reason);
  }

  // ------------------------------------------------------------------ WebRTC

  private newConnection(remoteId: string): RTCPeerConnection {
    this.remoteId = remoteId;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling.send(remoteId, "CANDIDATE", { candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.close(this.isOpen ? "lost" : "timeout");
    };
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
    const ping = window.setInterval(() => {
      if (this.closed) return window.clearInterval(ping);
      this.send({ t: "ping" });
      if (performance.now() - this.lastHeard > SILENCE_TIMEOUT_MS) this.close("lost");
    }, PING_MS);
    this.timers.push(ping);
    this.onOpen?.();
  }

  /** Guest: open the channels and send an offer to the room's host. */
  private async call(): Promise<void> {
    const pc = this.newConnection(roomPeerId(this.code));
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
        if (this.pc) {
          // Someone else is already in: turn the newcomer away.
          this.signaling.send(m.src, "ANSWER", { full: true });
          return;
        }
        const pc = this.newConnection(m.src);
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

  private async flushCandidates(): Promise<void> {
    const list = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => undefined);
  }
}
