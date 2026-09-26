/**
 * A playtest bot, injected into the page by run.mjs (needs `?debug`).
 * `botPlayLevel(maxSeconds, { skill, trace })` plays the current level
 * through the real input path: it pathfinds to the objective (weapons,
 * then the keycard, generators, the boss, the exit), opens doors, fights
 * what it has noticed (in view, close by, or what just hurt it), heals and
 * reloads, and reports stats. It knows the route, so it gets surprised far
 * less than a person exploring for the first time.
 */
window.botPlayLevel = function (maxSeconds, opts = {}) {
  const g = window.game;
  const CELL = 4;
  const DT = 1 / 30;
  const log = [];
  let stuckT = 0,
    lastPos = null,
    jiggle = 0,
    jiggleKey = "KeyA";
  let engageT = 0;
  let sinceShot = 0;
  const SKILL = {
    good: { reaction: 0.4, aim: 0.025, fireGap: 0.3, coreAware: true, healAt: 45 },
    average: { reaction: 0.7, aim: 0.06, fireGap: 0.5, coreAware: false, healAt: 35 },
  }[opts.skill ?? "average"];
  const stats = { deaths: 0, heals: 0, time: 0, events: [] };

  const S = () => g.session;
  const cellOf = (x, z) => ({ c: Math.floor(x / CELL), r: Math.floor(z / CELL) });
  const center = (c, r) => ({ x: (c + 0.5) * CELL, z: (r + 0.5) * CELL });
  function los(ax, az, bx, bz) {
    const L = S().level;
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.8);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const { c, r } = cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      if (L.solid[r]?.[c] !== false) return false;
    }
    return true;
  }
  function doorAt(c, r) {
    return S().doors.find((d) => d.spawn.cell.col === c && d.spawn.cell.row === r);
  }
  function passable(c, r) {
    const L = S().level;
    if (c < 0 || r < 0 || c >= L.cols || r >= L.rows) return false;
    const d = doorAt(c, r);
    if (d) return d.isOpen || !d.security || S().hasKeycard;
    return !L.solid[r][c];
  }
  function bfs(from, goalTest) {
    const L = S().level;
    const key = (c, r) => r * L.cols + c;
    const prev = new Map([[key(from.c, from.r), null]]);
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      if (goalTest(cur.c, cur.r)) {
        const path = [];
        let k = key(cur.c, cur.r);
        let node = cur;
        while (node) {
          path.unshift(node);
          node = prev.get(key(node.c, node.r));
        }
        return path;
      }
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = { c: cur.c + dc, r: cur.r + dr };
        const k = key(n.c, n.r);
        if (prev.has(k) || !passable(n.c, n.r)) continue;
        prev.set(k, cur);
        q.push(n);
      }
    }
    return null;
  }
  const yawTo = (px, pz, tx, tz) => Math.atan2(-(tx - px), -(tz - pz));
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8;

  function goal() {
    const s = S();
    const sp = s.level.spawns;
    const me0 = s.player.position;
    const near = (p, r) => Math.hypot(p.group.position.x - me0.x, p.group.position.z - me0.z) < r;
    // Weapons are worth a detour; other supplies only if they're close.
    const wpn = s.pickups.find((p) => !p.collected && (p.type === "shotgun" || p.type === "rivetGun") && near(p, 40));
    if (wpn) return { kind: "item", x: wpn.group.position.x, z: wpn.group.position.z, what: wpn.type };
    const key = s.pickups.find((p) => p.type === "keycard" && !p.collected);
    if (key) return { kind: "item", x: key.group.position.x, z: key.group.position.z, what: "keycard" };
    const full = (w) => !w || w.reserveAmmo >= w.config.reserveMax;
    const wanted = (p) =>
      (p.type === "ammo" && !full(s.weapons.get("pistol"))) ||
      (p.type === "shells" && !full(s.weapons.get("shotgun"))) ||
      (p.type === "rivets" && !full(s.weapons.get("rivet"))) ||
      (p.type === "medkit" && s.medkits < 3) ||
      (p.type === "battery" && s.player.flashlight.battery < 99);
    const supply = s.pickups.find((p) => !p.collected && wanted(p) && near(p, 9));
    if (supply) return { kind: "item", x: supply.group.position.x, z: supply.group.position.z, what: supply.type };
    const gen = s.generators.find((g2) => !g2.running);
    if (gen) return { kind: "use", x: gen.pos.x, z: gen.pos.y, cell: gen.spawn.cell, what: "generator", obj: gen };
    // Low on everything: detour for ammo.
    const ammo = [...s.weapons.values()].reduce((a, w) => a + w.reserveAmmo + w.ammoInMag, 0);
    if (ammo < 8) {
      const me = s.player.position;
      const a = s.pickups
        .filter(
          (p) =>
            !p.collected &&
            ["ammo", "shells", "rivets"].includes(p.type) &&
            s.weapons.has({ ammo: "pistol", shells: "shotgun", rivets: "rivet" }[p.type])
        )
        .sort(
          (p, q) =>
            Math.hypot(p.group.position.x - me.x, p.group.position.z - me.z) -
            Math.hypot(q.group.position.x - me.x, q.group.position.z - me.z)
        )[0];
      if (a) return { kind: "item", x: a.group.position.x, z: a.group.position.z, what: "ammo" };
    }
    const boss = s.boss;
    if (boss && !boss.isDead) {
      const b = boss.position2D;
      return { kind: "item", x: b.x, z: b.y + 12, what: "boss" };
    }
    if (s.level.def.finale && opts.ending === "seal") {
      const c = sp.consoles[0];
      return { kind: "use", x: c.pos.x, z: c.pos.y, cell: c.cell, what: "console" };
    }
    return { kind: "item", x: sp.exit.x, z: sp.exit.y, what: "exit" };
  }

  // What the player actually knows about: things seen in front, heard up close, or that just hurt them.
  const noticed = new Set();
  let lastHp = null;
  function target() {
    const s = S();
    const me = s.player.position;
    const hp = s.player.health.current;
    const hurt = lastHp !== null && hp < lastHp;
    lastHp = hp;
    const facing = s.player.facing;
    const fx = -Math.sin(facing),
      fz = -Math.cos(facing);
    for (const e of s.enemies.enemies) {
      if (e.isDead) {
        noticed.delete(e);
        continue;
      }
      const p = e.position2D;
      const dx = p.x - me.x,
        dz = p.y - me.z;
      const d = Math.hypot(dx, dz);
      const inView = d > 0.01 && (dx * fx + dz * fz) / d > Math.cos(0.9) && d < 16 && los(me.x, me.z, p.x, p.y);
      if (inView || d < 3.5 || (hurt && d < 6) || e.kind === "remnant") noticed.add(e);
    }
    let best = null,
      bd = 1e9;
    for (const e of s.enemies.enemies) {
      if (e.isDead || e.onCeiling || !noticed.has(e)) continue;
      const hunting = e.isHunting || e.state === "drop";
      if (!hunting && !(e.kind === "remnant")) continue;
      const p = e.position2D;
      const d = Math.hypot(p.x - me.x, p.y - me.z);
      if (d > (e.kind === "remnant" ? 22 : 16) || !los(me.x, me.z, p.x, p.y)) continue;
      if (e.kind === "remnant" && !e.awake && d > 16) continue;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best ? { e: best, d: bd } : null;
  }

  function step() {
    const s = S();
    const p = s.player;
    const me = p.position;
    const keys = [];
    // Heal when hurt and nothing is in our face.
    const t = target();
    sinceShot += DT;
    if (p.health.current < SKILL.healAt && s.medkits > 0 && s.healTimer <= 0 && (!t || t.d > 6)) {
      keys.push("KeyH");
      stats.heals++;
    }
    const totalAmmo = [...s.weapons.values()].reduce((a, w) => a + w.reserveAmmo + w.ammoInMag, 0);
    // Out of ammo against the boss: go and find some instead of standing there.
    if (t && !(t.e.kind === "remnant" && totalAmmo === 0)) {
      engageT += DT;
      const e = t.e;
      const aimAt = e.kind === "remnant" ? e.hitVolumes().head.center : e.hitVolumes().body[0].center;
      const yaw = yawTo(me.x, me.z, aimAt.x, aimAt.z) + gauss() * SKILL.aim;
      const pitch = Math.atan2(aimAt.y - me.y, t.d) + gauss() * SKILL.aim * 0.7;
      g.debugLook(yaw, pitch);
      // Reaction time: a person takes a moment before the first shot.
      const holdFire = e.kind === "remnant" && SKILL.coreAware && e.coreOpen < 0.5;
      if (engageT > SKILL.reaction && sinceShot > SKILL.fireGap && !holdFire) {
        const want =
          t.d < 7 && s.weapons.get("shotgun")?.ammoInMag + (s.weapons.get("shotgun")?.reserveAmmo ?? 0) > 0 ? "Digit3" : "Digit1";
        const cur = s.weapon.config.slot === 3 ? "Digit3" : s.weapon.config.slot === 2 ? "Digit2" : "Digit1";
        if (want !== cur && !(want === "Digit1" && cur === "Digit2")) keys.push(want);
        else if (s.weapon.ammoInMag > 0) {
          keys.push("Mouse0");
          sinceShot = 0;
        } else if (s.weapon.reserveAmmo > 0) keys.push("KeyR");
        else {
          // Out of ammo for this gun: try another, else melee if close.
          const other = [...s.weapons.values()].find((w) => w.ammoInMag + w.reserveAmmo > 0);
          if (other && other !== s.weapon) keys.push("Digit" + other.config.slot);
          else if (t.d < 2.2) keys.push("KeyV");
        }
      }
      // Keep a little distance: back off from anything in reach, and from the boss's tendrils.
      if (t.d < 2.4 || (e.kind === "remnant" && t.d < 8)) keys.push("KeyS");
      if (e.kind === "remnant") keys.push(Math.sin(stats.time * 0.8) > 0 ? "KeyA" : "KeyD"); // strafe acid
      return keys;
    }
    engageT = 0;
    // Navigation.
    const G = goal();
    const from = cellOf(me.x, me.z);
    const gc = cellOf(G.x, G.z);
    let path;
    if (G.kind === "use") {
      const tc = G.cell;
      path = bfs(from, (c, r) => Math.abs(c - tc.col) + Math.abs(r - tc.row) === 1 && passable(c, r));
      const dist = Math.hypot(G.x - me.x, G.z - me.z);
      if (path && path.length <= 1 && dist < 3.5) {
        g.debugLook(yawTo(me.x, me.z, G.x, G.z), -0.1);
        keys.push("KeyE");
        return keys;
      }
    } else {
      path = bfs(from, (c, r) => c === gc.c && r === gc.r);
    }
    if (!path) {
      stats.events.push(`no path to ${G.what}`);
      return ["KeyW"];
    }
    let wx, wz;
    if (path.length <= 1) {
      wx = G.x;
      wz = G.z;
    } else {
      const n = path[1];
      const d = doorAt(n.c, n.r);
      const cc = center(n.c, n.r);
      if (d && !d.isOpen) {
        g.debugLook(yawTo(me.x, me.z, cc.x, cc.z), 0);
        if (Math.hypot(cc.x - me.x, cc.z - me.z) < d.reach - 0.2) {
          keys.push("KeyE");
          return keys;
        }
      }
      // Look a step further when the path runs straight, so we don't hug cell centres.
      wx = cc.x;
      wz = cc.z;
    }
    g.debugLook(yawTo(me.x, me.z, wx, wz), 0);
    keys.push("KeyW");
    if (jiggle > 0) {
      jiggle -= DT;
      keys.push(jiggleKey);
    }
    return keys;
  }

  const start = performance.now();
  let ticks = 0;
  while (stats.time < maxSeconds) {
    const st = g.debugState();
    if (st === "levelComplete" || st === "victory") break;
    if (st === "dead") {
      stats.deaths++;
      stats.events.push(`died at ${Math.round(stats.time)}s near ${S().player.position.x.toFixed(0)},${S().player.position.z.toFixed(0)}`);
      if (stats.deaths > 6) break;
      g.startLevel();
      continue;
    }
    const keys = step();
    if (opts.trace && ticks % 300 === 0) {
      const me = S().player.position;
      const G = goal();
      stats.events.push(
        `t${Math.round(stats.time)} at ${(me.x / 4).toFixed(1)},${(me.z / 4).toFixed(1)} goal ${G.what} ${(G.x / 4).toFixed(1)},${(G.z / 4).toFixed(1)} keys ${keys.join("+")}`
      );
    }
    g.debugSimulate(DT, keys);
    stats.time += DT;
    ticks++;
    // Stuck detection.
    const me = S().player.position;
    stuckT += DT;
    if (stuckT > 2) {
      if (lastPos && Math.hypot(me.x - lastPos.x, me.z - lastPos.z) < 0.6 && !target()) {
        jiggle = 0.6;
        jiggleKey = Math.random() < 0.5 ? "KeyA" : "KeyD";
      }
      lastPos = { x: me.x, z: me.z };
      stuckT = 0;
    }
  }
  const s = S();
  return {
    level: s.def.id,
    state: g.debugState(),
    simTime: Math.round(stats.time),
    realMs: Math.round(performance.now() - start),
    deaths: stats.deaths,
    heals: stats.heals,
    hp: Math.round(s.player.health.current),
    dmgTaken: Math.round(s.stats.damageTaken),
    kills: s.stats.kills,
    shots: s.stats.shots,
    hits: s.stats.hits,
    ammo: Object.fromEntries([...s.weapons].map(([id, w]) => [id, w.ammoInMag + w.reserveAmmo])),
    medkits: s.medkits,
    battery: Math.round(s.player.flashlight.battery),
    alive: s.enemies.enemies.filter((e) => !e.isDead).length,
    bossHp: s.boss ? Math.round(s.boss.health) : undefined,
    events: stats.events.slice(opts.trace ? -40 : -6),
  };
};
