/**
 * Co-op end-to-end check: two real browsers, one hosting and one joining by
 * room code through the actual menus, then a series of scenarios — the guest
 * using an intercom and a door, a pickup vanishing for both, the guest's
 * shots killing the host's creature, going down and being revived, a wipe
 * and retry, leaving a level together, and the guest leaving.
 *
 *   npx peerjs --port 9000        # a local signaling server (or set SIGNAL_URL)
 *   npm run dev                   # http://localhost:5173
 *   node tools/coop/run.mjs
 *
 * Set PLAYWRIGHT_MODULE to an installed Playwright's index.mjs if it isn't a
 * project dependency. Software rendering runs both browsers at a frame or two
 * per second, which is why the checks wait generously.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const signal = process.env.SIGNAL_URL ?? "ws://127.0.0.1:9000/peerjs";
// SIGNAL_URL="" uses the game's real matchmaking (Metered Realtime).
// COOP_QUERY adds URL options, e.g. "&turn=turn:127.0.0.1:3478&turnUser=u&turnPass=p&relayOnly" to play through a relay.
const URL = `${process.env.GAME_URL ?? "http://localhost:5173/"}?debug${signal ? `&signal=${encodeURIComponent(signal)}` : ""}${process.env.COOP_QUERY ?? ""}`;
// BROWSER_ARGS: extra Chromium flags (e.g. a proxy), space-separated.
const extraArgs = (process.env.BROWSER_ARGS ?? "").split(" ").filter(Boolean);
const launch = () =>
  chromium.launch({
    args: [
      ...extraArgs,
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
const [bh, bg] = await Promise.all([launch(), launch()]);
const errors = [];
const mk = async (b, name) => {
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(name, m.type(), m.text().slice(0, 200));
  });
  await p.goto(URL);
  await p.waitForFunction(() => window.game && document.querySelector(".screen.show"), null, { timeout: 60000 });
  await p.keyboard.press("Enter");
  await p.waitForTimeout(500);
  return p;
};
const host = await mk(bh, "host");
const guest = await mk(bg, "guest");
const click = async (p, text) => {
  await p.locator(".screen.show button", { hasText: text }).first().click();
  await p.waitForTimeout(300);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// Host: Co-op → Host → chapter 1 → Story
await click(host, "Co-op");
await click(host, "Host a Game");
await click(host, "1.");
await click(host, "Story");
const code = (await host.locator(".room-code").innerText()).replace(/\s/g, "");
log("room code", code);

// Guest: Co-op → Join → type code
await click(guest, "Co-op");
await click(guest, "Join a Game");
await guest.locator(".code-input").fill(code.toLowerCase());
await guest.keyboard.press("Enter");
await host.locator(".screen.show button", { hasText: "Start" }).waitFor({ timeout: 30000 });
log("host sees partner");
await click(host, "Start");
await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.game.debugState() === "playing", null, { timeout: 60000 })));
log("both playing");

await sleep(3000);

const st = (p) =>
  p.evaluate(() => {
    const g = window.game;
    const s = g.session;
    const r = s.remote;
    return {
      state: g.debugState(),
      me: [s.player.position.x, s.player.position.z].map((v) => +v.toFixed(2)),
      remoteVisible: r?.visible,
      remote: r ? [r.position.x, r.position.z].map((v) => +v.toFixed(2)) : null,
      puppets: s.enemies.enemies.filter((e) => e.puppet).length,
      enemies: s.enemies.enemies.length,
      kills: s.stats.kills,
      hp: s.player.health.current,
    };
  });
log("host", JSON.stringify(await st(host)));
log("guest", JSON.stringify(await st(guest)));

const C = (c) => c * 4 + 2;
const put = (p, col, row, yaw, pitch = 0, dx = 0) =>
  p.evaluate(
    ([x, z, yaw, pitch]) => {
      const s = window.game.session;
      s.player.position.x = x;
      s.player.position.z = z;
      s.player.setLook(yaw, pitch);
    },
    [C(col) + dx, C(row), yaw, pitch]
  );
const sim = (p, sec, keys = []) => p.evaluate(([sec, keys]) => window.game.debugSimulate(sec, keys), [sec, keys]);
const check = (name, ok, extra = "") => {
  console.log(ok ? "PASS" : "FAIL", name, extra);
  if (!ok) failures.push(name);
};
const failures = [];

// 1. The guest answers the intercom; it happens on the host.
await put(guest, 3, 1, -Math.PI / 2, 0, 2.6);
await sim(guest, 0.1, ["KeyE"]);
await sleep(800);
const icUsed = await host.evaluate(
  () =>
    window.game.session.interactables.find((i) => "used" in i && i.prompt !== undefined && i.constructor.name.includes("Intercom"))?.used
);
const icGuest = await guest.evaluate(() =>
  window.game.session.interactables.filter((i) => i.constructor.name.includes("Intercom")).map((i) => i.used)
);
check("guest uses intercom → host", icUsed === true, `guest=${icGuest}`);
const objs = await Promise.all([host, guest].map((p) => p.evaluate(() => window.game.session.objective)));
check("objective updates for both", objs[0] === objs[1] && objs[0] === "Reach the stairwell.", JSON.stringify(objs));

// 1b. Each sees the other in their chosen look.
await guest.evaluate(() => (window.game.settings.look = "woman"));
await host.evaluate(() => (window.game.settings.look = "dark"));
await sleep(1500);
const looks = await Promise.all([host, guest].map((p) => p.evaluate(() => window.game.session.remote?.look)));
check("partner looks travel both ways", looks[0] === "woman" && looks[1] === "dark", JSON.stringify(looks));

// 2. The guest opens a door.
await put(guest, 4, 2, -Math.PI / 2, 0, 1.5);
await sim(guest, 0.1, ["KeyE"]);
await sleep(800);
const doors = await Promise.all([host, guest].map((p) => p.evaluate(() => window.game.session.doors.map((d) => d.isOpen))));
check("guest opens door → both", doors[0][0] === true && doors[1][0] === true, JSON.stringify(doors));

// 3. The guest picks something up: gone for the host too.
const pk = await guest.evaluate(() => {
  const s = window.game.session;
  const i = s.pickups.findIndex((p) => !p.collected && p.type !== "note" && p.type !== "keycard");
  const p = s.pickups[i];
  return { i, x: p.group.position.x - 0.6, z: p.group.position.z + 0.4, type: p.type };
});
await guest.evaluate(
  ([x, z]) => {
    const s = window.game.session;
    s.player.position.x = x;
    s.player.position.z = z;
  },
  [pk.x, pk.z]
);
await sim(guest, 0.3);
await sleep(800);
const pkHost = await host.evaluate((i) => window.game.session.pickups[i].collected, pk.i);
check("guest pickup vanishes for host", pkHost === true, JSON.stringify(pk));

// 4. The guest shoots a creature: the host's copy takes the damage, and the kill counts for the guest.
const target = await host.evaluate(() => {
  const s = window.game.session;
  const i = s.enemies.enemies.findIndex((e) => !e.isDead);
  const e = s.enemies.enemies[i];
  return { i, x: e.root.position.x, z: e.root.position.z, hp: e.health, kind: e.kind };
});
console.log("target", JSON.stringify(target));
let before = target.hp;
for (let n = 0; n < 12; n++) {
  const alive = await host.evaluate((i) => !window.game.session.enemies.enemies[i].isDead, target.i);
  if (!alive) break;
  await guest.evaluate((i) => {
    const s = window.game.session;
    const e = s.enemies.enemies[i];
    // Stand 3 m from it, facing it.
    const ex = e.root.position.x,
      ez = e.root.position.z;
    s.player.position.x = ex + 3;
    s.player.position.z = ez;
    const d = 3;
    s.player.setLook(Math.atan2(-(ex - s.player.position.x), -(ez - s.player.position.z)), -Math.atan((1.7 - 1.15) / d));
    const w = s.weapon;
    w.ammoInMag = Math.max(w.ammoInMag, 3);
  }, target.i);
  await guest.evaluate(() => window.game.debugFire());
  await sim(guest, 0.4);
  await sleep(500);
}
const after = await host.evaluate((i) => {
  const e = window.game.session.enemies.enemies[i];
  return { hp: e.health, dead: e.isDead };
}, target.i);
await guest.waitForFunction((i) => window.game.session.enemies.enemies[i].isDead, target.i, { timeout: 15000 }).catch(() => {});
const gk = await guest.evaluate(() => window.game.session.stats.kills);
const guestSeesDead = await guest.evaluate((i) => window.game.session.enemies.enemies[i].isDead, target.i);
check("guest's shots hurt host creature", after.hp < before, JSON.stringify(after));
check("kill counted for guest, corpse on both", after.dead && gk === 1 && guestSeesDead, `kills=${gk} guestSeesDead=${guestSeesDead}`);

// 5. The host goes down; the guest revives them.
await put(host, 8, 9, 0);
await put(guest, 8, 9, Math.PI / 2, 0, 1.2);
for (const p of [host, guest])
  await p.evaluate(() => {
    for (const e of window.game.session.enemies.enemies) if (!e.puppet) e.removeFromPlay();
  });
await host.evaluate(() => {
  const h = window.game.session.player.health;
  h.mercy = 0;
  h.takeDamage(500);
});
await sleep(1000);
const down = await host.evaluate(() => ({ downed: window.game.session.downed, state: window.game.debugState() }));
const guestSeesDown = await guest.evaluate(() => window.game.session.remote.down);
check("host goes down (not dead) with a partner", down.downed && down.state === "playing" && guestSeesDown, JSON.stringify(down));
await guest.evaluate(() => window.game.hud.setVisible(true));
await sim(guest, 3.5, ["KeyE"]);
await host.waitForFunction(() => !window.game.session.downed, null, { timeout: 15000 }).catch(() => {});
const revived = await host.evaluate(() => ({ downed: window.game.session.downed, hp: window.game.session.player.health.current }));
check("guest revives host", !revived.downed && revived.hp === 35, JSON.stringify(revived));

// 6. Both go down: the level is lost for both; the host's retry brings both back.
await host.evaluate(() => {
  const h = window.game.session.player.health;
  h.mercy = 0;
  h.takeDamage(500);
});
await sleep(600);
await guest.evaluate(() => {
  const h = window.game.session.player.health;
  h.mercy = 0;
  h.takeDamage(500);
});
await Promise.all(
  [host, guest].map((p) => p.waitForFunction(() => window.game.debugState() === "dead", null, { timeout: 20000 }).catch(() => {}))
);
const states = await Promise.all([host, guest].map((p) => p.evaluate(() => window.game.debugState())));

check("both down → both dead", states[0] === "dead" && states[1] === "dead", JSON.stringify(states));
await sleep(1000);
await click(host, "Retry");
await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.game.debugState() === "playing", null, { timeout: 60000 })));
const hp2 = await Promise.all([host, guest].map((p) => p.evaluate(() => window.game.session.player.health.current)));
check("host retry restarts both", hp2[0] > 0 && hp2[1] > 0, JSON.stringify(hp2));
await sleep(1500);

// 7. Leaving together: the host alone at the exit waits; both there, the level ends for both.
const reason = await host.evaluate(() => window.game.session.exitLockReason());
console.log("exit lock reason", reason);
await host.evaluate(() => {
  const s = window.game.session;
  const x = s.level.spawns.exit;
  s.player.position.x = x.x;
  s.player.position.z = x.y;
});
await sleep(1500);
check("host alone at the exit waits", (await host.evaluate(() => window.game.debugState())) === "playing");
await guest.evaluate(() => {
  const s = window.game.session;
  const x = s.level.spawns.exit;
  s.player.position.x = x.x + 0.5;
  s.player.position.z = x.y;
});
await Promise.all(
  [host, guest].map((p) => p.waitForFunction(() => window.game.debugState() === "levelComplete", null, { timeout: 20000 }).catch(() => {}))
);
const st7 = await Promise.all([host, guest].map((p) => p.evaluate(() => window.game.debugState())));
check("both at the exit → level complete for both", st7[0] === "levelComplete" && st7[1] === "levelComplete", JSON.stringify(st7));
await click(host, "Continue");
await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.game.debugState() === "playing", null, { timeout: 60000 })));
const lv = await Promise.all([host, guest].map((p) => p.evaluate(() => window.game.session.def.id)));
check("host continue → both on the next level", lv[0] === lv[1] && lv[0] === "maintenance-wing", JSON.stringify(lv));
await sleep(3000);

// 8. The guest leaves: the host carries on alone.
await guest.evaluate(() => window.game.debugLeave());
await host.waitForFunction(() => !window.game.session.remote.visible, null, { timeout: 20000 }).catch(() => {});
const hostAfter = await host.evaluate(() => ({ state: window.game.debugState(), remote: window.game.session.remote.visible }));
check("guest leaves → host keeps playing alone", hostAfter.state === "playing" && hostAfter.remote === false, JSON.stringify(hostAfter));

console.log("FAILURES:", failures.length ? failures.join(", ") : "none");
console.log("errors:", errors.join("\n") || "none");
await Promise.all([bh.close(), bg.close()]);
process.exit(failures.length || errors.length ? 1 : 0);
