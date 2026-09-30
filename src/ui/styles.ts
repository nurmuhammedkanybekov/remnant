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
.hitmark.armoured { transform: scale(0.6); filter: grayscale(1) brightness(.6); }

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
.vrow.breath .vbar { height: 3px; }
.vrow.breath .vbar > b.fill { background: #7fb8d8; }
.vrow.breath.held .vbar > b.fill { background: #a8dcff; box-shadow: 0 0 6px rgba(127,184,216,.6); }
.vrow.breath.low .vbar > b.fill { background: var(--ui-red); animation: blink .5s steps(2) infinite; }
.vrow.breath { display: none; }
.vrow.breath.on { display: flex; }
.vrow.breath .vnum { font-size: 11px; }
.vrow.battery .vbar > b.fill { background: linear-gradient(90deg, #8a6a20, var(--ui-amber)); }
.vrow.battery.low .vbar > b.fill { background: var(--ui-red); animation: blink .6s steps(2) infinite; }
.vrow.battery.off svg { opacity: .3; }
.medkits { margin-top: 10px; font-size: 13px; letter-spacing: 2px; display: flex; align-items: center; gap: 8px; }
.medkits b { color: var(--ui-red); font-size: 15px; }
.medkits kbd { font-family: var(--font-mono); font-size: 10px; padding: 0 5px; border: 1px solid rgba(255,255,255,.3); border-radius: 2px;
  color: var(--ui-dim); }
.medkits.none { opacity: .35; }
.throwables { margin-top: 4px; }
.throwables b { color: #9adfa0; }
.keycard { margin-top: 10px; font-size: 12px; letter-spacing: 2px; color: var(--ui-green); display: none; }
.keycard.show { display: block; }
.partner { margin-top: 12px; font-size: 11px; letter-spacing: 2px; color: #7ab8ff; display: none; align-items: center; gap: 8px; }
.partner.show { display: flex; }
.partner .pbar { flex: 0 0 90px; height: 4px; background: rgba(255,255,255,.12); }
.partner .pbar b { display: block; height: 100%; background: #7ab8ff; transition: width .2s; }
.partner.down { color: var(--ui-red); animation: pulse 1s infinite; }
.partner.down .pbar b { background: var(--ui-red); }
.partner.talking > span:first-child::after { content: " ◉"; color: var(--ui-amber); }
.mic { margin-top: 8px; font-size: 10px; letter-spacing: .2em; display: none; opacity: .6; }
.mic.open { display: block; }
.mic.talking { opacity: 1; color: var(--ui-amber); }

/* ---- ammo ---- */
.ammo { position: absolute; right: 30px; bottom: 24px; text-align: right; }
.ammo .mag { font-family: var(--font-display); font-size: 54px; line-height: 1; font-weight: 500; }
.ammo .mag.empty { color: var(--ui-red); }
.ammo .res { font-size: 18px; color: var(--ui-dim); margin-left: 6px; }
.ammo .pips { display: flex; gap: 3px; justify-content: flex-end; margin-top: 6px; }
.ammo .pips i { width: 5px; height: 14px; background: var(--ui-amber); border-radius: 1px 1px 0 0; opacity: .9; }
.ammo .pips i.spent { background: rgba(255,255,255,.12); }
.ammo .slots { display: flex; gap: 4px; justify-content: flex-end; margin-bottom: 8px; }
.ammo .slots i { font-style: normal; font-size: 10px; letter-spacing: 1px; padding: 2px 6px; border: 1px solid rgba(255,255,255,.1);
  color: rgba(232,226,214,.25); }
.ammo .slots i span { margin-left: 5px; }
.ammo .slots i.owned { color: var(--ui-dim); border-color: rgba(255,255,255,.25); }
.ammo .slots i.on { color: var(--ui-fg); border-color: var(--ui-amber); background: rgba(226,176,74,.12); }
.ammo .wname { font-size: 11px; letter-spacing: 4px; color: var(--ui-dim); margin-bottom: 2px; }
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

/* ---- boss ---- */
.boss { position: absolute; left: 50%; top: 84px; transform: translateX(-50%); width: min(520px, 70vw); text-align: center;
  opacity: 0; transition: opacity .6s; }
.boss.show { opacity: 1; }
.boss .name { font-family: var(--font-display); font-size: 15px; letter-spacing: 8px; color: #f0c8c0; margin-bottom: 6px; }
.boss .bar { position: relative; height: 8px; background: rgba(255,255,255,.08); border: 1px solid rgba(216,67,47,.5); overflow: hidden; }
.boss .bar b { position: absolute; left: 0; top: 0; bottom: 0; transition: width .2s; }
.boss .bar b.lag { background: rgba(255,255,255,.35); transition: width 1s ease .3s; }
.boss .bar b.fill { background: linear-gradient(90deg, #6a1410, var(--ui-red)); }

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

.interact { position: absolute; left: 50%; top: calc(50% + 46px); transform: translateX(-50%); display: none; align-items: center; gap: 10px;
  font-size: 13px; letter-spacing: 3px; color: var(--ui-fg); white-space: nowrap; }
.interact.show { display: flex; }
.interact kbd { font-family: var(--font-mono); font-size: 12px; padding: 2px 8px; border: 1px solid rgba(255,255,255,.55);
  border-bottom-width: 2px; border-radius: 3px; background: rgba(0,0,0,.45); }
.subtitle { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); width: min(760px, 86vw); text-align: center;
  opacity: 0; transition: opacity .25s ease; pointer-events: none; }
.subtitle.show { opacity: 1; }
.subtitle .who { font-size: 10px; letter-spacing: 4px; color: var(--ui-amber); margin-bottom: 5px; }
.subtitle .line { display: inline-block; font-size: 17px; line-height: 1.5; padding: 6px 14px; background: rgba(0,0,0,.55); border-radius: 2px; }
.subtitle.nur .who { color: var(--ui-dim); }
.subtitle.nur .line { font-style: italic; color: rgba(232,226,214,.85); }
.subtitle.unknown .who { color: var(--ui-red); }
.subtitle.unknown .line { color: #f0c8c0; letter-spacing: 1px; }
.subtitle.echo .who { color: #d88ab0; }
.subtitle.echo .line { color: #e8d0dc; font-style: italic; }
/* ---- no text selection in the game UI (the page-wide rule is in index.html) ---- */
.screen, .hud { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; cursor: default; }
/* ...except where copying is the point: typing a room code, and the host's code to send to a friend. */
.screen input, .screen textarea, .room-code { -webkit-user-select: text; user-select: text; }
.screen button { -webkit-user-select: none; user-select: none; }

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
.room-code { display: flex; gap: 10px; margin: -18px 0 26px; }
.room-code b { font-family: var(--font-display); font-weight: 400; font-size: clamp(40px, 8vw, 72px); width: 1.1em; padding: 4px 0; text-align: center;
  border: 1px solid rgba(255,255,255,.25); background: rgba(0,0,0,.35); letter-spacing: 0; }
.code-input { font-family: var(--font-display); font-size: clamp(36px, 7vw, 60px); letter-spacing: .35em; text-align: center; text-transform: uppercase;
  width: min(420px, 86vw); padding: 10px 0 10px .35em; margin: -14px 0 14px; color: inherit; background: rgba(0,0,0,.4);
  border: 1px solid rgba(255,255,255,.3); outline: none; }
.code-input:focus { border-color: var(--ui-green); }
.screen .sub.err { color: var(--ui-red); min-height: 1.7em; margin-bottom: 18px; }
.story { width: min(620px, 88vw); text-align: left; margin: 6px 0 30px; }
.story p { font-family: "Special Elite", var(--font-mono); font-size: 15px; line-height: 1.75; color: rgba(232,226,214,.88); margin: 0 0 16px;
  opacity: 0; animation: storyin 1.4s ease forwards; }
@keyframes storyin { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.menu.row { flex-direction: row; gap: 18px; }
.menu button small { display: block; font-family: var(--font-mono); font-size: 11px; letter-spacing: 1px; text-transform: none;
  color: var(--ui-dim); margin-top: 3px; opacity: .8; }
.menu button:disabled { opacity: .3; cursor: default; }
.menu button:disabled:hover { letter-spacing: 6px; }
.menu button:disabled:hover::before { content: none; }
.screen .best { color: var(--ui-amber); }
.binds { display: grid; grid-template-columns: 1fr auto auto; gap: 5px 10px; font-size: 13px; align-items: center; }
.binds > span { color: var(--ui-dim); letter-spacing: 1px; }
.binds kbd, .binds button.slot { font-family: var(--font-mono); font-size: 12px; min-width: 92px; padding: 4px 8px; text-align: center;
  border: 1px solid rgba(255,255,255,.3); border-bottom-width: 2px; border-radius: 3px; background: rgba(0,0,0,.35); color: var(--ui-fg); }
.binds kbd { color: var(--ui-dim); border-color: rgba(255,255,255,.12); }
.binds button.slot { cursor: pointer; transition: border-color .15s, color .15s; }
.binds button.slot:hover, .binds button.slot:focus-visible { border-color: var(--ui-red); outline: none; }
.binds button.slot.listening { color: var(--ui-amber); border-color: var(--ui-amber); animation: pulse .9s ease-in-out infinite; }
.version { position: absolute; bottom: 26px; right: 28px; font-size: 11px; letter-spacing: 2px; color: rgba(232,226,214,.3); }
.board { border-collapse: collapse; margin: 6px auto 18px; font-size: 13px; min-width: min(760px, 94vw); }
.board th { font-size: 10px; letter-spacing: .25em; opacity: .5; font-weight: normal; padding: 0 10px 8px; text-align: left; }
.board td { padding: 6px 10px; border-top: 1px solid rgba(255,255,255,.08); text-align: left; white-space: nowrap; }
.board td small { display: block; font-size: 11px; opacity: .6; letter-spacing: .08em; }
.board td.me { color: var(--ui-amber); }
.board td.dim { opacity: .3; }
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

/* ---- title ---- */
.screen.title h1 { font-size: clamp(64px, 13vw, 150px); }
.screen .press { margin-top: 34px; font-size: 13px; letter-spacing: 6px; color: var(--ui-dim); animation: pulse 1.8s ease-in-out infinite; }

/* ---- main menu ---- */
.screen.main-menu { align-items: flex-start; padding-left: clamp(24px, 8vw, 120px); text-align: left;
  background: linear-gradient(90deg, rgba(0,0,0,.88) 0%, rgba(0,0,0,.55) 45%, rgba(0,0,0,.15) 75%, rgba(0,0,0,.6) 100%); }
.main-menu .brand h1 { margin-left: 0; font-size: clamp(56px, 9vw, 112px); }
.main-menu .brand .tag { margin-bottom: 36px; }
.main-menu .menu { min-width: 300px; }
.main-menu .menu button { text-align: left; padding-left: 26px; }
.main-menu .menu button:hover::before, .main-menu .menu button:focus-visible::before { left: 4px; }
.gauge { position: absolute; right: clamp(20px, 5vw, 70px); top: 50%; transform: translateY(-50%); list-style: none; margin: 0;
  padding: 0 0 0 18px; border-left: 1px solid var(--ui-faint); font-size: 11px; letter-spacing: 2px; text-align: left; }
.gauge li { position: relative; display: grid; grid-template-columns: 110px 130px; gap: 8px; padding: 5px 0; color: rgba(232,226,214,.28); }
.gauge li i { position: absolute; left: -23px; top: 8px; width: 9px; height: 9px; border-radius: 50%; background: #111;
  border: 1px solid rgba(255,255,255,.2); }
.gauge li span { color: rgba(232,226,214,.22); letter-spacing: 1px; }
.gauge li.reached { color: var(--ui-dim); }
.gauge li.reached span { color: rgba(232,226,214,.4); }
.gauge li.reached i { background: var(--ui-amber); border-color: var(--ui-amber); box-shadow: 0 0 8px rgba(226,176,74,.6); }
.gauge li.cur { color: var(--ui-fg); }
.gauge li.cur span { color: var(--ui-amber); }
.gauge li.cur i { background: var(--ui-red); border-color: var(--ui-red); box-shadow: 0 0 12px var(--ui-red); animation: pulse 1.2s infinite; }
.transmission { position: absolute; left: clamp(24px, 8vw, 120px); bottom: 26px; right: 220px; font-size: 12px; letter-spacing: 1px;
  color: rgba(232,226,214,.45); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.transmission .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-red); margin-right: 10px;
  animation: blink 1s steps(2) infinite; }
.transmission .who { letter-spacing: 4px; margin-right: 14px; color: var(--ui-amber); }
.transmission .txt { font-style: italic; }
@media (max-width: 820px) { .gauge { display: none; } }

/* ---- level card ---- */
.screen.level-card { align-items: flex-start; padding-left: clamp(24px, 8vw, 120px); padding-right: 330px;
  background: radial-gradient(ellipse at 30% 50%, rgba(18,14,12,.94), #000 75%); }
@media (max-width: 820px) { .screen.level-card { padding-right: 24px; } }
.level-card .card-body { display: flex; align-items: center; gap: 34px; text-align: left; max-width: 820px; }
.level-card .depth-no { font-family: var(--font-display); font-weight: 300; font-size: clamp(90px, 16vw, 190px); line-height: .85;
  color: rgba(216,67,47,.85); text-shadow: 0 0 40px rgba(216,67,47,.35); }
.level-card .card-name { font-family: var(--font-display); font-size: clamp(26px, 3.6vw, 48px); letter-spacing: .2em; }
.level-card .card-sub { font-size: 14px; letter-spacing: 8px; color: var(--ui-dim); margin-top: 4px; }
.level-card .card-tagline { font-family: var(--font-type); font-size: 17px; color: rgba(232,226,214,.8); margin: 26px 0 18px; max-width: 520px; line-height: 1.5; }
.level-card .card-obj { font-size: 13px; letter-spacing: 1px; color: var(--ui-fg); }
.level-card .card-obj span { color: var(--ui-amber); letter-spacing: 4px; margin-right: 12px; }
.level-card .menu { position: absolute; left: clamp(24px, 8vw, 120px); bottom: 70px; min-width: 0; }
.level-card .menu button { padding-left: 0; }
.level-card .press { position: absolute; left: clamp(24px, 8vw, 120px); bottom: 36px; margin: 0; }
.card-body { animation: cardin 1.1s ease both; }
@keyframes cardin { from { opacity: 0; transform: translateY(10px); letter-spacing: 0; } to { opacity: 1; transform: none; } }

/* ---- settings ---- */
.screen.settings h2 { margin-bottom: 22px; }
.settings .panel { display: grid; grid-template-columns: 1fr 1fr; gap: 0 56px; width: min(960px, 92vw); margin-bottom: 14px; }
.settings .note-line { font-size: 11px; letter-spacing: 1px; color: var(--ui-dim); margin-bottom: 22px; }
@media (max-width: 860px) { .settings .panel { grid-template-columns: 1fr; } }
.panel .group { font-size: 11px; letter-spacing: 5px; color: var(--ui-amber); padding: 18px 0 4px; }
.panel .group:first-child { padding-top: 0; }
.panel button.cycle { font-family: var(--font-mono); font-size: 13px; letter-spacing: 1px; color: var(--ui-fg); background: none;
  border: 1px solid rgba(255,255,255,.25); padding: 3px 10px; cursor: pointer; min-width: 120px; }
.panel button.cycle:hover, .panel button.cycle:focus-visible { border-color: var(--ui-red); outline: none; }
.panel input:focus-visible { outline: 1px solid var(--ui-red); outline-offset: 3px; }
.panel .keys { margin-top: 6px; }

/* ---- accessibility ---- */
.hud { --hud-scale: 1; }
.hud .vitals, .hud .ammo, .hud .objective, .hud .noise, .hud .aware, .hud .boss, .hud .toasts { zoom: var(--hud-scale); }
.hud.sub-small .subtitle .line { font-size: 14px; }
.hud.sub-large .subtitle .line { font-size: 23px; }
.hud.sub-large .subtitle .who { font-size: 12px; }
.hud.sub-large .subtitle { width: min(960px, 92vw); bottom: 150px; }
/* ---- inventory ---- */
.screen.inventory { justify-content: flex-start; padding-top: max(24px, 6vh);
  background: radial-gradient(ellipse at center, rgba(10,9,9,.9) 0%, rgba(0,0,0,.97) 80%); }
.screen.inventory .tag { margin-bottom: 18px; }
.inv-tabs { display: flex; gap: 4px; margin-bottom: 18px; border-bottom: 1px solid var(--ui-faint); }
.inv-tabs button { font-family: var(--font-display); font-size: 15px; letter-spacing: 4px; text-transform: uppercase; color: var(--ui-dim);
  background: none; border: none; border-bottom: 2px solid transparent; padding: 8px 18px; cursor: pointer; margin-bottom: -1px; }
.inv-tabs button:hover, .inv-tabs button:focus-visible { color: #fff; outline: none; }
.inv-tabs button.on { color: var(--ui-fg); border-bottom-color: var(--ui-red); }
.inv-body { width: min(860px, 92vw); text-align: left; margin-bottom: 18px; }
.inv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 40px; }
@media (max-width: 720px) { .inv-grid { grid-template-columns: 1fr; } }
.inv-body h3 { font-family: var(--font-display); font-weight: 400; font-size: 13px; letter-spacing: 5px; color: var(--ui-amber);
  margin: 16px 0 8px; border-bottom: 1px solid var(--ui-faint); padding-bottom: 4px; }
.inv-body section > h3:first-child { margin-top: 0; }
.inv-row { display: flex; align-items: center; gap: 12px; margin: 7px 0; font-size: 14px; }
.inv-row > span:first-child { width: 110px; color: var(--ui-dim); letter-spacing: 1px; }
.inv-row > b { margin-left: auto; min-width: 58px; text-align: right; font-weight: 400; }
.inv-row > b.ok { color: var(--ui-green); } .inv-row > b.dim { color: var(--ui-dim); }
.inv-bar { flex: 1; height: 8px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); transform: skewX(-18deg); }
.inv-bar b { display: block; height: 100%; }
.inv-bar.hp b { background: linear-gradient(90deg, #8e1f16, var(--ui-red)); }
.inv-bar.hp.low b { animation: blink .8s steps(2) infinite; }
.inv-bar.bat b { background: linear-gradient(90deg, #8a6a20, var(--ui-amber)); }
.inv-kits { flex: 1; display: flex; gap: 6px; }
.inv-kits i { width: 22px; height: 22px; border: 1px solid rgba(255,255,255,.2); position: relative; }
.inv-kits i.on { border-color: var(--ui-red); background: rgba(216,67,47,.15); }
.inv-kits i.on::before, .inv-kits i.on::after { content: ""; position: absolute; background: var(--ui-red); left: 9px; top: 4px; width: 4px; height: 14px; }
.inv-kits i.on::after { left: 4px; top: 9px; width: 14px; height: 4px; }
.inv-kits.bottles i.on { border-color: #9adfa0; background: rgba(154,223,160,.12); }
.inv-kits.bottles i.on::before { background: #9adfa0; left: 8px; top: 7px; width: 6px; height: 12px; border-radius: 2px; }
.inv-kits.bottles i.on::after { background: #9adfa0; left: 10px; top: 3px; width: 2px; height: 5px; }
.inv-hint { font-size: 12px; color: var(--ui-dim); margin: 4px 0 0; }
.inv-weapon { display: flex; align-items: center; gap: 12px; padding: 8px 10px; margin-bottom: 6px; border: 1px solid rgba(255,255,255,.1);
  background: rgba(0,0,0,.3); font-size: 14px; }
.inv-weapon.hand { border-color: var(--ui-amber); background: rgba(226,176,74,.08); }
.inv-weapon.missing { opacity: .35; }
.inv-weapon .slot { font-size: 11px; border: 1px solid rgba(255,255,255,.3); padding: 1px 6px; }
.inv-weapon .wname { flex: 1; letter-spacing: 2px; text-transform: uppercase; }
.inv-weapon .wname em { font-style: normal; font-size: 10px; letter-spacing: 3px; color: var(--ui-amber); margin-left: 10px; }
.inv-weapon .wammo b { font-size: 18px; font-weight: 400; } .inv-weapon .wammo b.empty { color: var(--ui-red); }
.inv-weapon .wammo small { color: var(--ui-dim); margin-left: 8px; }
.inv-obj { font-size: 14px; line-height: 1.6; }
.inv-empty { color: var(--ui-dim); text-align: center; padding: 40px 0; font-size: 14px; }
.inv-journal { display: grid; grid-template-columns: minmax(200px, 1fr) 1.6fr; gap: 20px; }
@media (max-width: 720px) { .inv-journal { grid-template-columns: 1fr; } }
.inv-notes { display: flex; flex-direction: column; gap: 4px; max-height: 52vh; overflow-y: auto; }
.inv-note { text-align: left; font-family: var(--font-mono); font-size: 13px; color: var(--ui-dim); background: rgba(0,0,0,.3);
  border: 1px solid rgba(255,255,255,.08); border-left: 2px solid transparent; padding: 8px 10px; cursor: pointer; }
.inv-note small { display: block; font-size: 10px; letter-spacing: 2px; margin-top: 3px; opacity: .7; text-transform: uppercase; }
.inv-note:hover, .inv-note:focus-visible { color: #fff; outline: none; }
.inv-note.open { color: var(--ui-fg); border-left-color: var(--ui-amber); }
.inv-paper { font-family: var(--font-type); color: #2a241a; background: linear-gradient(#e9dfc6, #d9cba8); padding: 22px 26px;
  box-shadow: 0 8px 30px rgba(0,0,0,.6); transform: rotate(-.6deg); line-height: 1.75; font-size: 15px; }
.inv-paper .where { font-family: var(--font-mono); font-size: 10px; letter-spacing: 3px; color: #6a5a3a; margin-bottom: 10px; }
.inv-paper p { margin: 0; white-space: pre-line; }
.inv-radio { max-height: 56vh; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; font-size: 14px; line-height: 1.5; }
.inv-radio .line { display: grid; grid-template-columns: 190px 1fr; gap: 12px; }
.inv-radio .who { font-size: 10px; letter-spacing: 3px; color: var(--ui-amber); padding-top: 3px; }
.inv-radio .nur .who { color: var(--ui-dim); } .inv-radio .unknown .who { color: var(--ui-red); } .inv-radio .echo .who { color: #d88ab0; }
@media (max-width: 720px) { .inv-radio .line { grid-template-columns: 1fr; gap: 2px; } }

/* Colour-blind friendly: the signals that were red vs green become orange vs blue. */
.cb { --ui-red: #ff7b1c; --ui-green: #3ea8ff; --ui-amber: #ffd23f; }
.cb .vrow.health .vbar > b.fill { background: linear-gradient(90deg, #a04a00, var(--ui-red)); }
.cb .hitmark.head::before, .cb .hitmark.head::after { background: linear-gradient(var(--ui-green) 0 32%, transparent 32% 68%, var(--ui-green) 68%); }

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
