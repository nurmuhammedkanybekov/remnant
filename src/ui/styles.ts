/** All UI styling lives here and is injected once as a <style> tag. */
const CSS = /* css */ `
:root {
  --ui-fg: #e8e2d6;
  --ui-dim: rgba(232, 226, 214, 0.55);
  --ui-faint: rgba(232, 226, 214, 0.18);
  --ui-red: #d8432f;
  --ui-amber: #e2b04a;
  --ui-green: #6fdc8c;
  --ui-blue: #7fd0f0;
  --font-display: "Oswald", "Arial Narrow", Impact, sans-serif;
  --font-mono: "Share Tech Mono", "Courier New", monospace;
  --font-type: "Special Elite", "Courier New", monospace;
}

.hud { position: absolute; inset: 0; pointer-events: none; user-select: none;
  color: var(--ui-fg); font-family: var(--font-mono); text-shadow: 0 1px 3px rgba(0,0,0,0.9); }

/* ---- crosshair ---- */
.xhair { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transition: opacity .15s; }
.xhair i { position: absolute; background: rgba(240,236,228,0.85); box-shadow: 0 0 2px rgba(0,0,0,.9); }
.xhair i.t, .xhair i.b { width: 2px; height: 7px; left: -1px; }
.xhair i.l, .xhair i.r { height: 2px; width: 7px; top: -1px; }
.xhair i.c { width: 2px; height: 2px; left: -1px; top: -1px; }
.hitmark { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; opacity: 0;
  transition: opacity .18s; }
.hitmark::before, .hitmark::after { content: ""; position: absolute; left: 10px; top: -2px; width: 2px; height: 26px;
  transform: rotate(45deg); filter: drop-shadow(0 0 2px rgba(0,0,0,.9));
  background: linear-gradient(#fff 0 32%, transparent 32% 68%, #fff 68%); }
.hitmark::after { transform: rotate(-45deg); }
.hitmark.head::before, .hitmark.head::after { background: linear-gradient(var(--ui-red) 0 32%, transparent 32% 68%, var(--ui-red) 68%); }
.hitmark.kill { transform: scale(1.4); }

/* ---- damage direction ---- */
.dmgdir { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.dmgdir div { position: absolute; left: -60px; top: -170px; width: 120px; height: 40px; opacity: 0; transition: opacity .6s;
  background: radial-gradient(ellipse at 50% 100%, rgba(220,30,20,.75), rgba(220,30,20,0) 70%);
  transform-origin: 60px 170px; }

/* ---- vitals ---- */
.vitals { position: absolute; left: 28px; bottom: 26px; width: 250px; }
.vrow { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.vrow svg { width: 16px; height: 16px; flex: none; opacity: .85; }
.vbar { position: relative; flex: 1; height: 6px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
  transform: skewX(-18deg); overflow: hidden; }
.vbar > b { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; transition: width .2s ease; }
.vbar > b.lag { background: rgba(255,255,255,.35); transition: width .9s ease .25s; }
.vnum { width: 34px; text-align: right; font-size: 14px; }
.vrow.health .vbar { height: 10px; }
.vrow.health .vbar > b.fill { background: linear-gradient(90deg, #8e1f16, var(--ui-red)); }
.vrow.stamina .vbar { height: 3px; }
.vrow.stamina .vbar > b.fill { background: rgba(232,226,214,.7); }
.vrow.battery .vbar > b.fill { background: linear-gradient(90deg, #8a6a20, var(--ui-amber)); }
.vrow.battery.low .vbar > b.fill { background: var(--ui-red); animation: blink .6s steps(2) infinite; }
.vrow.battery.off svg { opacity: .3; }
.keycard { margin-top: 10px; font-size: 12px; letter-spacing: 2px; color: var(--ui-green); display: none; }
.keycard.show { display: block; }

/* ---- ammo ---- */
.ammo { position: absolute; right: 30px; bottom: 24px; text-align: right; }
.ammo .mag { font-family: var(--font-display); font-size: 54px; line-height: 1; font-weight: 500; }
.ammo .mag.empty { color: var(--ui-red); }
.ammo .res { font-size: 18px; color: var(--ui-dim); margin-left: 6px; }
.ammo .pips { display: flex; gap: 3px; justify-content: flex-end; margin-top: 6px; }
.ammo .pips i { width: 5px; height: 14px; background: var(--ui-amber); border-radius: 1px 1px 0 0; opacity: .9; }
.ammo .pips i.spent { background: rgba(255,255,255,.12); }
.ammo .status { font-size: 12px; letter-spacing: 3px; margin-top: 6px; height: 14px; color: var(--ui-amber); }

/* ---- noise meter + awareness ---- */
.noise { position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%); text-align: center; }
.noise .bars { display: flex; gap: 4px; align-items: flex-end; justify-content: center; height: 20px; }
.noise .bars i { width: 6px; background: rgba(255,255,255,.12); transition: background .15s, height .15s; }
.noise .bars i.on { background: rgba(232,226,214,.8); }
.noise .bars i.on.loud { background: var(--ui-red); }
.noise .lbl { font-size: 10px; letter-spacing: 4px; color: var(--ui-dim); margin-top: 5px; }
.aware { position: absolute; left: 50%; top: 28px; transform: translateX(-50%); text-align: center; transition: opacity .3s; opacity: 0; }
.aware svg { width: 36px; height: 20px; }
.aware .lbl { font-size: 11px; letter-spacing: 5px; margin-top: 2px; }
.aware.hunted { color: var(--ui-red); animation: pulse 0.8s ease-in-out infinite; }
.aware.sus { color: var(--ui-amber); }

/* ---- objective / toasts / prompts ---- */
.objective { position: absolute; left: 28px; top: 24px; max-width: 360px; }
.objective .lvl { font-size: 11px; letter-spacing: 4px; color: var(--ui-dim); }
.objective .txt { font-size: 15px; margin-top: 4px; }
.toasts { position: absolute; right: 30px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column;
  align-items: flex-end; gap: 6px; }
.toast { font-size: 14px; letter-spacing: 2px; padding: 5px 12px; background: linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,.6));
  border-right: 2px solid var(--ui-amber); animation: toast 2.6s ease forwards; }
.prompt { position: absolute; left: 50%; top: 62%; transform: translateX(-50%); font-size: 14px; letter-spacing: 3px;
  padding: 6px 14px; background: rgba(0,0,0,.55); opacity: 0; transition: opacity .25s; }
.prompt.show { opacity: 1; }

/* ---- note ---- */
.note { position: absolute; left: 50%; bottom: 150px; transform: translate(-50%, 20px) rotate(-1deg); width: min(460px, 80vw);
  padding: 22px 26px 20px; background: #e4dcc4; color: #2a2620; font-family: var(--font-type); font-size: 16px; line-height: 1.55;
  text-shadow: none; box-shadow: 0 10px 40px rgba(0,0,0,.7); opacity: 0; transition: opacity .4s, transform .4s; }
.note.show { opacity: .96; transform: translate(-50%, 0) rotate(-1deg); }
.note .hdr { font-size: 11px; letter-spacing: 3px; opacity: .6; margin-bottom: 8px; }

/* ---- level intro ---- */
.intro { position: absolute; left: 0; right: 0; top: 34%; text-align: center; opacity: 0; transition: opacity 1.2s; }
.intro.show { opacity: 1; }
.intro .a { font-family: var(--font-display); font-size: 58px; letter-spacing: 14px; font-weight: 300; }
.intro .b { font-size: 14px; letter-spacing: 8px; color: var(--ui-dim); margin-top: 6px; }

/* ---- screens (menus) ---- */
.screen { position: absolute; inset: 0; z-index: 10; display: none; flex-direction: column; align-items: center; justify-content: safe center;
  overflow-y: auto; padding: 24px 16px; box-sizing: border-box;
  color: var(--ui-fg); font-family: var(--font-mono); text-align: center;
  background: radial-gradient(ellipse at center, rgba(8,8,10,.55) 0%, rgba(0,0,0,.92) 85%); }
.screen.show { display: flex; animation: fadein .35s ease; }
.screen.opaque { background: radial-gradient(ellipse at center, rgba(12,10,10,.85), #000 80%); }
.screen h1 { font-family: var(--font-display); font-weight: 500; font-size: clamp(56px, 11vw, 124px); letter-spacing: .28em;
  margin: 0 0 4px .28em; line-height: 1; color: #efe9dc; text-shadow: 0 0 30px rgba(216,67,47,.25); animation: flicker 6s infinite; }
.screen h2 { font-family: var(--font-display); font-weight: 400; font-size: clamp(34px, 6vw, 60px); letter-spacing: .2em; margin: 0 0 8px .2em; }
.screen h2.red { color: var(--ui-red); text-shadow: 0 0 24px rgba(216,67,47,.5); }
.screen .tag { font-size: 13px; letter-spacing: 6px; color: var(--ui-dim); margin-bottom: 42px; }
.screen .sub { font-size: 14px; color: var(--ui-dim); max-width: 520px; line-height: 1.7; margin-bottom: 30px; white-space: pre-line; }
.menu { display: flex; flex-direction: column; gap: 6px; min-width: 260px; }
.menu button { font-family: var(--font-display); font-size: 20px; letter-spacing: 6px; text-transform: uppercase; color: var(--ui-dim);
  background: none; border: none; padding: 8px 20px; cursor: pointer; position: relative; transition: color .15s, letter-spacing .2s; }
.menu button:hover, .menu button:focus-visible { color: #fff; letter-spacing: 8px; outline: none; }
.menu button:hover::before, .menu button:focus-visible::before { content: "›"; position: absolute; left: 12px; color: var(--ui-red); }
.menu button.primary { color: var(--ui-fg); }
.stats { display: grid; grid-template-columns: auto auto; gap: 6px 36px; margin: 10px 0 34px; font-size: 14px; text-align: left; }
.stats span:nth-child(odd) { color: var(--ui-dim); letter-spacing: 2px; }
.stats span:nth-child(even) { text-align: right; }
.panel { width: min(440px, 88vw); text-align: left; margin-bottom: 26px; }
.panel label { display: flex; justify-content: space-between; align-items: center; gap: 16px; font-size: 13px; letter-spacing: 2px;
  padding: 10px 0; border-bottom: 1px solid var(--ui-faint); color: var(--ui-dim); }
.panel label output { width: 44px; text-align: right; color: var(--ui-fg); }
.panel input[type=range] { flex: 1; accent-color: var(--ui-red); }
.panel input[type=checkbox] { accent-color: var(--ui-red); width: 16px; height: 16px; }
.keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 22px; font-size: 13px; align-items: center; }
.keys kbd { font-family: var(--font-mono); font-size: 12px; padding: 3px 8px; border: 1px solid rgba(255,255,255,.3);
  border-bottom-width: 2px; border-radius: 3px; color: var(--ui-fg); justify-self: end; white-space: nowrap; }
.keys span { color: var(--ui-dim); }
.tips { margin-top: 16px; font-size: 12px; line-height: 1.6; color: var(--ui-dim); }
.hint { position: absolute; bottom: 26px; left: 0; right: 0; font-size: 11px; letter-spacing: 3px; color: rgba(232,226,214,.35); }

@keyframes blink { 50% { opacity: .25; } }
@keyframes pulse { 50% { opacity: .55; } }
@keyframes fadein { from { opacity: 0; } }
@keyframes toast { 0% { opacity: 0; transform: translateX(20px); } 10%, 80% { opacity: 1; transform: none; } 100% { opacity: 0; } }
@keyframes flicker { 0%, 92%, 94%, 97%, 100% { opacity: 1; } 93% { opacity: .35; } 96% { opacity: .7; } }
`;

let injected = false;
export function injectStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
}
