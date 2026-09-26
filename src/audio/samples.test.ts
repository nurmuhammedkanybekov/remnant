import { afterEach, describe, expect, it, vi } from "vitest";
import { SampleBank } from "./samples";

/** Just enough of an AudioContext for the bank. */
function fakeCtx() {
  const started: number[] = [];
  const node = () => ({ connect: (n: unknown) => n, gain: { value: 1 }, playbackRate: { value: 1 } });
  return {
    started,
    decodeAudioData: vi.fn(async (b: ArrayBuffer) => ({ length: b.byteLength }) as unknown as AudioBuffer),
    createGain: node,
    createBufferSource: () => ({ ...node(), buffer: null, start: (t: number) => started.push(t) }),
  };
}

describe("SampleBank", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("plays recordings that loaded and skips ones that didn't", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("ok.ogg") ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } : { ok: false, status: 404 }
      )
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bank = new SampleBank({
      pistolShot: { files: ["ok.ogg", "missing.ogg"], gain: 1, pitchJitter: 0.05 },
      shotgunShot: { files: ["missing.ogg"], gain: 1, pitchJitter: 0 },
    });
    const ctx = fakeCtx();
    await bank.load(ctx as unknown as BaseAudioContext);
    expect(bank.has("pistolShot")).toBe(true);
    expect(bank.has("shotgunShot")).toBe(false);
    const dest = { connect: () => {} } as unknown as AudioNode;
    expect(bank.play(ctx as unknown as BaseAudioContext, "pistolShot", dest, 1.5)).toBe(true);
    expect(ctx.started).toEqual([1.5]);
    // No recording: the caller falls back to synthesis.
    expect(bank.play(ctx as unknown as BaseAudioContext, "shotgunShot", dest, 2)).toBe(false);
    expect(bank.play(ctx as unknown as BaseAudioContext, "dryFire", dest, 2)).toBe(false);
  });
});
