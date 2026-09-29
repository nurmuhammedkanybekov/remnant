import { describe, expect, it } from "vitest";
import { DIFFICULTIES, DIFFICULTY_ORDER } from "../content/difficulty";
import { MAX_MEDKITS } from "../content/items";
import { WEAPONS } from "../content/weapons";
import { LEVELS } from "../world/levels";
import { carryOver, parseLoadout, startingLoadout, upgradeLegacyLoadout, withAmmoFloor, type Loadout } from "./loadout";

const ids = LEVELS.map((l) => l.id);

describe("loadout", () => {
  it("starts with a pistol, the difficulty's reserve ammo and medkits", () => {
    const story = startingLoadout(DIFFICULTIES.story);
    const nightmare = startingLoadout(DIFFICULTIES.nightmare);
    expect(Object.keys(story.weapons)).toEqual(["pistol"]);
    expect(story.current).toBe("pistol");
    expect(story.weapons.pistol!.reserve).toBeGreaterThan(nightmare.weapons.pistol!.reserve);
    expect(story.medkits).toBeGreaterThan(nightmare.medkits);
  });

  it("a later chapter starts with the weapons found before it", () => {
    const armory = ids.indexOf("armory");
    const beforeArmory = startingLoadout(DIFFICULTIES.normal, ids, armory);
    expect(Object.keys(beforeArmory.weapons).sort()).toEqual(["pistol", "rivet"]);
    const hive = startingLoadout(DIFFICULTIES.normal, ids, ids.indexOf("hive"));
    expect(Object.keys(hive.weapons).sort()).toEqual(["pistol", "rivet", "shotgun"]);
    expect(hive.weapons.shotgun!.mag).toBe(WEAPONS.shotgun.magSize);
  });

  it("tops up health and battery between levels (not ammo), but never lowers them", () => {
    const d = DIFFICULTIES.normal;
    const base: Loadout = {
      health: 5,
      battery: 0,
      medkits: 1,
      throwables: 0,
      weapons: { pistol: { mag: 3, reserve: 4 } },
      current: "pistol",
    };
    const low = carryOver(base, d);
    expect(low).toEqual({
      ...base,
      health: d.carryHealthFloor,
      battery: d.carryBatteryFloor,
    });
    expect(low.weapons).not.toBe(base.weapons);
    const high = carryOver({ ...base, health: 90, battery: 80 }, d);
    expect(high.health).toBe(90);
    expect(high.battery).toBe(80);
  });

  it("tops the pistol up to the difficulty's floor, but never lowers it", () => {
    const d = DIFFICULTIES.nightmare;
    const empty: Loadout = {
      health: 50,
      battery: 50,
      medkits: 0,
      throwables: 0,
      weapons: { pistol: { mag: 0, reserve: 0 } },
      current: "pistol",
    };
    const topped = withAmmoFloor(empty, d);
    expect(topped.weapons.pistol).toEqual({ mag: 0, reserve: d.carryAmmoFloor });
    expect(empty.weapons.pistol!.reserve).toBe(0);
    const full = { ...empty, weapons: { pistol: { mag: 8, reserve: 30 } } };
    expect(withAmmoFloor(full, d).weapons.pistol).toEqual({ mag: 8, reserve: 30 });
  });

  it("difficulties get harder in order", () => {
    const [story, normal, nightmare] = DIFFICULTY_ORDER.map((id) => DIFFICULTIES[id]);
    expect(story.enemyDamage).toBeLessThan(normal.enemyDamage);
    expect(normal.enemyDamage).toBeLessThan(nightmare.enemyDamage);
    expect(DIFFICULTIES.ironman.permadeath).toBe(true);
    // Aizi is the hardest: tougher than Nightmare on every axis, and one life.
    const aizi = DIFFICULTIES.aizi;
    expect(DIFFICULTY_ORDER[DIFFICULTY_ORDER.length - 1]).toBe("aizi");
    expect(aizi.permadeath).toBe(true);
    for (const k of ["enemyHealth", "enemyDamage", "enemyPerception", "enemySpeed", "extraEnemies", "batteryDrain"] as const)
      expect(aizi[k]).toBeGreaterThan(nightmare[k]);
    for (const k of ["pickupMultiplier", "startingReserve", "carryHealthFloor", "carryAmmoFloor"] as const)
      expect(aizi[k]).toBeLessThan(nightmare[k]);
  });
});

describe("parseLoadout", () => {
  it("repairs bad values and always keeps a pistol", () => {
    const l = parseLoadout({
      health: 500,
      battery: -1,
      medkits: 99,
      weapons: { shotgun: { mag: 99, reserve: -4 }, laser: { mag: 1, reserve: 1 } },
      current: "laser",
    })!;
    expect(l.health).toBe(100);
    expect(l.battery).toBe(0);
    expect(l.medkits).toBe(MAX_MEDKITS);
    expect(l.weapons.shotgun).toEqual({ mag: WEAPONS.shotgun.magSize, reserve: 0 });
    expect(l.weapons.pistol).toEqual({ mag: 0, reserve: 0 });
    expect(Object.keys(l.weapons)).not.toContain("laser");
    expect(l.current).toBe("pistol");
    expect(parseLoadout("nope")).toBeNull();
  });

  it("upgrades a single-pistol loadout from an older save", () => {
    const up = parseLoadout(upgradeLegacyLoadout({ health: 80, battery: 50, mag: 6, reserve: 12 }))!;
    expect(up).toEqual({
      health: 80,
      battery: 50,
      medkits: 0,
      throwables: 0,
      weapons: { pistol: { mag: 6, reserve: 12 } },
      current: "pistol",
    });
  });
});
