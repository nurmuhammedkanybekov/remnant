import { describe, expect, it } from "vitest";
import { gearHtml, journalHtml, noteTitle, radioHtml, type InventoryView } from "./inventory";

const view = (over: Partial<InventoryView> = {}): InventoryView => ({
  place: "Sublevel 10 · Infirmary",
  objective: "Find a way <up>.",
  difficulty: "Aizi",
  health: 30,
  maxHealth: 100,
  battery: 50,
  maxBattery: 100,
  medkits: 2,
  maxMedkits: 3,
  keycard: true,
  weapons: [
    { name: "Sidearm", slot: 1, owned: true, inHand: true, mag: 0, magSize: 12, reserve: 0, reserveMax: 60 },
    { name: "Shotgun", slot: 3, owned: false, inHand: false, mag: 0, magSize: 6, reserve: 0, reserveMax: 24 },
  ],
  notes: [],
  radio: [],
  healKey: "H",
  closeKey: "Tab",
  live: false,
  ...over,
});

describe("inventory", () => {
  it("shows what is carried, escapes text, and marks empty and missing weapons", () => {
    const html = gearHtml(view());
    expect(html).toContain("Find a way &lt;up&gt;.");
    expect(html).toContain("CARRIED");
    expect(html).toContain('class="empty"');
    expect(html).toContain("Not found yet");
    expect(html).toContain("2/3");
  });

  it("says when there is nothing to read yet", () => {
    expect(journalHtml(view(), 0)).toContain("Nothing yet");
    expect(radioHtml(view())).toContain("quiet");
  });

  it("opens the chosen note, clamping a stale index", () => {
    const notes = [
      { place: "A", text: "First note. More text.", fresh: true },
      { place: "B", text: "Second note.", fresh: false },
    ];
    expect(journalHtml(view({ notes }), 9)).toContain("<p>Second note.</p>");
    expect(journalHtml(view({ notes }), 0)).toContain("· new");
  });

  it("titles notes by their first sentence, kept short", () => {
    expect(noteTitle("PATIENT 14 — KESSLER, T. Drilling crew.")).toBe("PATIENT 14 — KESSLER, T.");
    expect(noteTitle("Nur — if you wake up before I get back: I've gone up to find the others.")).toMatch(/^Nur — if you wake up.*…$/);
    expect(noteTitle("x".repeat(80)).length).toBeLessThanOrEqual(46);
  });
});
