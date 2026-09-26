import type { SoundManager, Spatial } from "../audio/soundManager";
import type { Hud } from "../ui/hud";
import { lineDuration, type RadioLine } from "./script";

const GAP = 0.35; // pause between lines

/**
 * Plays queued radio lines one at a time: subtitles on the HUD and a
 * synthesized "voice" through the radio. Advanced by the simulation clock,
 * so pausing the game pauses the conversation.
 */
export class RadioChannel {
  private readonly queue: { line: RadioLine; from?: Spatial }[] = [];
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
    this.queue.push(...lines.map((line) => ({ line })));
  }

  /** A voice from a place in the world rather than the radio. Dropped if the channel is busy. */
  sayFrom(line: RadioLine, from: Spatial): boolean {
    if (this.busy) return false;
    this.queue.push({ line, from });
    return true;
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
    const { line, from } = next;
    this.current = line;
    this.remaining = lineDuration(line.text);
    this.hud.subtitle(line);
    if (line.speaker !== "aida") this.sound.playRadioVoice(this.remaining, line.speaker === "unknown", from);
  }

  clear(): void {
    this.queue.length = 0;
    this.current = null;
    this.remaining = 0;
    this.hud.subtitle(null);
  }
}
