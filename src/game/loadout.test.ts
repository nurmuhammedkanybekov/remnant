import { describe, expect, it } from "vitest";
import { DIFFICULTIES, DIFFICULTY_ORDER } from "../content/difficulty";
import { carryOver, startingLoadout } from "./loadout";

describe("loadout", () => {
  it("starts with the difficulty's reserve ammo", () => {
    expect(startingLoadout(DIFFICULTIES.story).reserve).toBeGreaterThan(startingLoadout(DIFFICULTIES.nightmare).reserve);
  });

  it("tops up health and battery between levels, but never lowers them", () => {
    const d = DIFFICULTIES.normal;
    const low = carryOver({ health: 5, battery: 0, mag: 3, reserve: 4 }, d);
    expect(low).toEqual({ health: d.carryHealthFloor, battery: d.carryBatteryFloor, mag: 3, reserve: 4 });
    const high = carryOver({ health: 90, battery: 80, mag: 3, reserve: 4 }, d);
    expect(high.health).toBe(90);
    expect(high.battery).toBe(80);
  });

  it("difficulties get harder in order", () => {
    const [story, normal, nightmare] = DIFFICULTY_ORDER.map((id) => DIFFICULTIES[id]);
    expect(story.enemyDamage).toBeLessThan(normal.enemyDamage);
    expect(normal.enemyDamage).toBeLessThan(nightmare.enemyDamage);
    expect(DIFFICULTIES.ironman.permadeath).toBe(true);
  });
});
