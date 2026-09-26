import type { SoundManager } from "../audio/soundManager";
import type { Hud } from "../ui/hud";
import { lineDuration, type RadioLine } from "./script";

const GAP = 0.35; // pause between lines

/**
 * Plays queued radio lines one at a time: subtitles on the HUD and a
 * synthesized "voice" through the radio. Advanced by the simulation clock,
 * so pausing the game pauses the conversation.
 */
export class RadioChannel {
  private readonly queue: RadioLine[] = [];
  private current: RadioLine | null = null;
  private remaining = 0;

  constructor(
    private readonly hud: Hud,
    private readonly sound: SoundManager
  ) {}

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  say(lines: RadioLine[]): void {
    this.queue.push(...lines);
  }

  update(dt: number): void {
    this.remaining -= dt;
    if (this.remaining > 0) return;
    if (this.current) {
      this.current = null;
      this.hud.subtitle(null);
      this.remaining = GAP;
      return;
    }
    const next = this.queue.shift();
    if (!next) return;
    this.current = next;
    this.remaining = lineDuration(next.text);
    this.hud.subtitle(next);
    if (next.speaker !== "aida") this.sound.playRadioVoice(this.remaining, next.speaker === "unknown");
  }

  clear(): void {
    this.queue.length = 0;
    this.current = null;
    this.remaining = 0;
    this.hud.subtitle(null);
  }
}
