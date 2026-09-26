import { steadyInterval } from "./timer";

/**
 * Signaling: how two browsers find each other before they can talk directly.
 *
 * Uses the free public PeerJS server (or any server speaking the same
 * protocol) purely as a mailbox: each side connects over a WebSocket under
 * an id, and the server forwards OFFER / ANSWER / CANDIDATE messages to the
 * id named in `dst`. Payloads are opaque to the server. Once the WebRTC
 * connection is up, signaling isn't needed any more.
 *
 * The socket is kept alive with a heartbeat that doesn't slow down in a
 * background tab (the host is often in another tab sending the code), and if
 * it drops anyway it reconnects under the same id a few times before giving up.
 */

export const DEFAULT_SIGNAL_URL = "wss://0.peerjs.com/peerjs";
const KEY = "peerjs";
const HEARTBEAT_MS = 5000;
/** Waits before each reconnection attempt; after the last one, give up. */
const RETRY_DELAYS_MS = [500, 1500, 3000, 5000, 8000];

export type SignalType = "OFFER" | "ANSWER" | "CANDIDATE" | "LEAVE";

export interface SignalMessage {
  type: string;
  src?: string;
  dst?: string;
  payload?: unknown;
}

export class Signaling {
  /** Connected (again): fired on the first connection and after every reconnection. */
  onOpen: ((reconnected: boolean) => void) | null = null;
  onMessage: ((msg: SignalMessage) => void) | null = null;
  /** The server refused us, or the socket died and couldn't be brought back. */
  onError: ((reason: string) => void) | null = null;

  private ws: WebSocket | null = null;
  private stopHeartbeat: (() => void) | null = null;
  private retryTimer = 0;
  private attempt = 0;
  private everOpened = false;
  private closed = false;

  constructor(
    readonly id: string,
    private readonly url = DEFAULT_SIGNAL_URL
  ) {}

  connect(): void {
    if (this.closed) return;
    const token = Math.random().toString(36).slice(2);
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${this.url}?key=${KEY}&id=${encodeURIComponent(this.id)}&token=${token}&version=1.5.4`);
    } catch {
      this.lost("unreachable");
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onmessage = (e) => {
      let msg: SignalMessage;
      try {
        msg = JSON.parse(String(e.data)) as SignalMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case "OPEN": {
          opened = true;
          const reconnected = this.everOpened;
          this.everOpened = true;
          this.attempt = 0;
          this.stopHeartbeat?.();
          this.stopHeartbeat = steadyInterval(HEARTBEAT_MS, () => this.raw({ type: "HEARTBEAT" }));
          this.onOpen?.(reconnected);
          break;
        }
        case "ID-TAKEN":
          // Right after a drop the server may still hold our old socket under this id: that clears in a moment.
          if (this.everOpened) this.lost("closed");
          else this.fail("id-taken");
          break;
        case "INVALID-KEY":
        case "ERROR":
          this.fail("server");
          break;
        default:
          this.onMessage?.(msg);
      }
    };
    ws.onerror = () => {
      if (!opened) this.lost(this.everOpened ? "closed" : "unreachable");
    };
    ws.onclose = () => this.lost(opened || this.everOpened ? "closed" : "unreachable");
  }

  send(dst: string, type: SignalType, payload: unknown): void {
    this.raw({ type, dst, payload });
  }

  private raw(msg: SignalMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** The socket went away: try again, a few times, before telling anyone. */
  private lost(reason: string): void {
    if (this.closed) return;
    this.dropSocket();
    if (this.retryTimer) return; // a retry is already scheduled
    const delay = RETRY_DELAYS_MS[this.attempt];
    if (delay === undefined) return this.fail(reason);
    this.attempt++;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      this.connect();
    }, delay);
  }

  private dropSocket(): void {
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.close();
    this.onError?.(reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.retryTimer);
    this.dropSocket();
  }
}
