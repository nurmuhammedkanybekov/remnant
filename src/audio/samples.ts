import { SAMPLES, type SampleDef, type SampleId } from "../content/sounds";

/**
 * Loads the recorded sounds listed in `content/sounds.ts` and plays them.
 * Loading is asynchronous and forgiving: a missing or broken file just
 * leaves that sound to the synthesizer.
 */
export class SampleBank {
  private readonly buffers = new Map<SampleId, AudioBuffer[]>();

  constructor(
    private readonly defs: Partial<Record<SampleId, SampleDef>> = SAMPLES,
    private readonly base = "sfx/"
  ) {}

  async load(ctx: BaseAudioContext): Promise<void> {
    const jobs = (Object.entries(this.defs) as [SampleId, SampleDef][]).flatMap(([id, def]) =>
      def.files.map(async (file) => {
        try {
          const res = await fetch(this.base + file);
          if (!res.ok) throw new Error(`${res.status}`);
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          const list = this.buffers.get(id) ?? [];
          list.push(buf);
          this.buffers.set(id, list);
        } catch (err) {
          console.warn(`Sound "${file}" could not be loaded; using the synthesized version.`, err);
        }
      })
    );
    await Promise.all(jobs);
  }

  has(id: SampleId): boolean {
    return (this.buffers.get(id)?.length ?? 0) > 0;
  }

  /** Plays a random variant of `id` into `dest` at `when`. Returns false if there's no recording for it. */
  play(ctx: BaseAudioContext, id: SampleId, dest: AudioNode, when: number, gain = 1, rate = 1): boolean {
    const list = this.buffers.get(id);
    const def = this.defs[id];
    if (!list?.length || !def) return false;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * def.pitchJitter);
    const g = ctx.createGain();
    g.gain.value = def.gain * gain;
    src.connect(g).connect(dest);
    src.start(when);
    return true;
  }
}
