import { describe, expect, it } from "vitest";
import { notePage, notePageHtml } from "./notePage";
import { LEVELS } from "../world/levels";

describe("notePage", () => {
  it("a record is typed, with its heading apart", () => {
    const p = notePage("ARKADIN, LOG 151 (1990). The last clean sample of my blood is in this cabinet.");
    expect(p.kind).toBe("typed");
    expect(p.heading).toBe("ARKADIN, LOG 151 (1990).");
    expect(p.body.startsWith("The last clean sample")).toBe(true);
    expect(notePage("PATIENT 14 — KESSLER, T. Drilling crew, admitted day 3.").heading).toBe("PATIENT 14 — KESSLER, T.");
    expect(notePage("SECURITY: the lift keycard stays with Hendricks.").heading).toBe("SECURITY:");
  });

  it("a signed note is a handwritten letter, signature on its own", () => {
    const p = notePage("Supplies I hid from the others. You slept through all of it. — M.");
    expect(p.kind).toBe("letter");
    expect(p.signature).toBe("M.");
    expect(p.body.endsWith("all of it.")).toBe(true);
    expect(notePage("Don't let the tall one see you. — (no name)").signature).toBe("(no name)");
  });

  it("anything else is a scrawl, and a sentence in capitals isn't a heading", () => {
    expect(notePage("Scratched into the duct: THE VOICE IS NOT THE SUPERVISOR.").kind).toBe("scrawl");
    expect(notePage("I. Am. Here.").kind).toBe("scrawl");
  });

  it("each page is its own, and the same every time", () => {
    const a = notePage("One note.");
    expect(notePage("One note.")).toEqual(a);
    expect(Math.abs(a.tilt)).toBeLessThanOrEqual(1.6);
    expect(a.fold).toBeGreaterThan(0.3);
    expect(a.fold).toBeLessThan(0.7);
  });

  it("escapes what it shows", () => {
    expect(notePageHtml("<b>x</b> — A").html).not.toContain("<b>");
  });

  it("every note in the game reads as a page with a body", () => {
    for (const level of LEVELS)
      for (const text of Object.values(level.notes ?? {})) {
        const p = notePage(text);
        expect(p.body.length, text).toBeGreaterThan(10);
      }
  });
});
