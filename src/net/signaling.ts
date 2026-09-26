/**
 * Signaling: how two browsers find each other before they can talk directly.
 *
 * Uses the free public PeerJS server (or any server speaking the same
 * protocol) purely as a mailbox: each side connects over a WebSocket under
 * an id, and the server forwards OFFER / ANSWER / CANDIDATE messages to the
 * id named in `dst`. Payloads are opaque to the server. Once the WebRTC
 * connection is up, signaling isn't needed any more.
 */

export const DEFAULT_SIGNAL_URL = "wss://0.peerjs.com/peerjs";
const KEY = "peerjs";
const HEARTBEAT_MS = 5000;

export type SignalType = "OFFER" | "ANSWER" | "CANDIDATE" | "LEAVE";

export interface SignalMessage {
  type: string;
  src?: string;
  dst?: string;
  payload?: unknown;
}

export class Signaling {
  onOpen: (() => void) | null = null;
  onMessage: ((msg: SignalMessage) => void) | null = null;
  /** The server refused us or the socket died. */
  onError: ((reason: string) => void) | null = null;

  private ws: WebSocket | null = null;
  private heartbeat = 0;
  private closed = false;

  constructor(
    readonly id: string,
    private readonly url = DEFAULT_SIGNAL_URL
  ) {}

  connect(): void {
    const token = Math.random().toString(36).slice(2);
    const ws = new WebSocket(`${this.url}?key=${KEY}&id=${encodeURIComponent(this.id)}&token=${token}&version=1.5.4`);
    this.ws = ws;
    ws.onmessage = (e) => {
      let msg: SignalMessage;
      try {
        msg = JSON.parse(String(e.data)) as SignalMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case "OPEN":
          this.heartbeat = window.setInterval(() => this.raw({ type: "HEARTBEAT" }), HEARTBEAT_MS);
          this.onOpen?.();
          break;
        case "ID-TAKEN":
          this.fail("id-taken");
          break;
        case "INVALID-KEY":
        case "ERROR":
          this.fail("server");
          break;
        default:
          this.onMessage?.(msg);
      }
    };
    ws.onerror = () => this.fail("unreachable");
    ws.onclose = () => this.fail("closed");
  }

  send(dst: string, type: SignalType, payload: unknown): void {
    this.raw({ type, dst, payload });
  }

  private raw(msg: SignalMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.close();
    this.onError?.(reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.heartbeat);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onerror = ws.onmessage = null;
      ws.close();
    }
  }
}
