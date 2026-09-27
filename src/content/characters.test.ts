import { describe, expect, it } from "vitest";
import { LEVELS } from "../world/levels";
import { fullName, LOOK_ORDER, LOOKS, personalise } from "./characters";
import { PROLOGUE, TRANSMISSIONS } from "./story";

describe("characters", () => {
  it("has three named survivors", () => {
    expect(LOOK_ORDER.map(fullName)).toEqual(["Nur Kanybekov", "Raiymbek Asanov", "Nuraiza Temirbekova"]);
  });

  it("tells the story to whoever is playing", () => {
    expect(personalise("Keep going, Nur. Nearly there.", "woman")).toBe("Keep going, Nuraiza. Nearly there.");
    expect(personalise("You are Nur Kanybekov, structural engineer.", "dark")).toBe("You are Raiymbek Asanov, drilling foreman.");
    expect(personalise("Nur? Nur!", "light")).toBe("Nur? Nur!");
    // Whole words only.
    expect(personalise("The nurse on Nurzhan's ward.", "woman")).toBe("The nurse on Nurzhan's ward.");
  });

  it("leaves no 'Nur' behind in any line, note or prologue for the other characters", () => {
    const texts = [
      ...PROLOGUE.lines,
      ...TRANSMISSIONS,
      ...LEVELS.flatMap((l) => [...Object.values(l.notes), l.tagline, l.objective]),
      ...LEVELS.flatMap((l) => JSON.stringify([l.events, l.intercoms, l.triggers]).match(/"text":"[^"]*"/g) ?? []),
    ];
    for (const look of ["dark", "woman"] as const) {
      for (const t of texts) expect(personalise(t, look)).not.toMatch(/\bNur\b|Kanybekov/);
      expect(texts.some((t) => personalise(t, look).includes(LOOKS[look].firstName))).toBe(true);
    }
  });
});
