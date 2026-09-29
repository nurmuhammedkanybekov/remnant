import type { SoundManager } from "../audio/soundManager";
import type { VoiceMode } from "../core/settings";

/**
 * Your microphone, for co-op voice. Push to talk (hold T), open mic, or
 * off (Settings). The voice goes straight to the other players over the
 * game's own peer-to-peer connection (see `PeerLink.setVoice`), no server in
 * between, and plays from where you stand in their world.
 *
 * Talking is noise: while you're actually speaking, creatures close by can
 * hear you (see `LevelSession`).
 */
export class VoiceChat {
  mode: VoiceMode = "ptt";
  /** The browser (or the player) refused the microphone. */
  denied = false;
  private stream: MediaStream | null = null;
  private meter: (() => number) | null = null;
  private starting: Promise<MediaStreamTrack | null> | null = null;
  private held = false;
  private level = 0;

  constructor(private readonly sound: SoundManager) {}

  get track(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
  }

  /** The microphone is live (open mic, or the push-to-talk key held). */
  get open(): boolean {
    return !!this.track && (this.mode === "open" || (this.mode === "ptt" && this.held));
  }

  /** You're talking right now (live and loud enough to be more than breath). */
  get speaking(): boolean {
    return this.open && this.level > SPEAKING_LEVEL;
  }

  /** Asks for the microphone (the browser asks the player once). Null if voice is off or refused. */
  start(): Promise<MediaStreamTrack | null> {
    if (this.mode === "off") return Promise.resolve(null);
    if (this.track) return Promise.resolve(this.track);
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      this.denied = true;
      return Promise.resolve(null);
    }
    this.starting ??= media
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((stream) => {
        if (this.mode === "off") {
          stream.getTracks().forEach((t) => t.stop());
          return null;
        }
        this.stream = stream;
        this.denied = false;
        const track = stream.getAudioTracks()[0] ?? null;
        this.meter = track ? this.sound.meter(track) : null;
        this.apply();
        return track;
      })
      .catch(() => {
        this.denied = true;
        return null;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  /** Every frame: the push-to-talk key, and how loud you are. */
  update(dt: number, talkHeld: boolean): void {
    this.held = talkHeld;
    this.apply();
    const raw = this.open && this.meter ? this.meter() : 0;
    this.level += (raw - this.level) * Math.min(1, dt * 10);
  }

  /** Mic off and released (leaving co-op, or voice switched off). */
  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.meter = null;
    this.level = 0;
  }

  private apply(): void {
    const t = this.track;
    // A muted track sends silence: nothing leaves the microphone unless you mean it to.
    if (t) t.enabled = this.open;
  }
}

/** Mic level (0..1, see `SoundManager.meter`) above which you count as talking. */
const SPEAKING_LEVEL = 0.08;
