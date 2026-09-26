import type { RadioLine } from "../game/script";
import { injectStyles } from "./styles";

const ICON = {
  heart: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>`,
  run: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="14" cy="4" r="2.2"/><path d="M9 21l2.2-6 2.4 2.2V22h2v-6.2l-2.6-2.6.8-3.6c1.2 1.5 3 2.4 5.2 2.4v-2c-1.7 0-3.2-.9-4-2.2l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5 0-.8.1L6 7.6V12h2V9l1.8-.7L7 21h2z"/></svg>`,
  torch: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h10v5l-3 4v11h-4V11L7 7V2zm2 2v2h6V4H9z"/></svg>`,
  eye: `<svg viewBox="0 0 36 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 10C7 3 12 1 18 1s11 2 16 9c-5 7-10 9-16 9S7 17 2 10z"/><circle cx="18" cy="10" r="4" fill="currentColor"/></svg>`,
};

const SPEAKER_NAMES: Record<RadioLine["speaker"], string> = {
  operator: "OPERATOR — RADIO",
  aida: "AIDA",
  unknown: "??? — RADIO",
  echo: "OPERATOR — NOT ON THE RADIO",
};

export interface WeaponSlot {
  slot: number;
  name: string;
  owned: boolean;
}

export interface HudState {
  health: number; // 0..1
  stamina: number; // 0..1
  battery: number; // 0..1
  torchOn: boolean;
  mag: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  noise: number; // 0..5 bars
  threat: number; // 0..1
  spreadPx: number;
  hasKeycard: boolean;
  weapon: string;
  /** Single-loading weapons show "LOADING" rather than "RELOADING". */
  singleLoad: boolean;
  medkits: number;
  healing: boolean;
  /** The weapon slot in hand (1-based). */
  slot: number;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly pips: HTMLElement[] = [];
  private readonly noiseBars: HTMLElement[] = [];
  private readonly dmgArcs: HTMLElement[] = [];
  private dmgArcCursor = 0;
  private noteTimeout = 0;
  private promptTimeout = 0;
  private hitTimeout = 0;
  private introTimeout = 0;
  private last: Partial<HudState> = {};
  private lastInteract: string | null = null;
  private lastInteractKey: string | null = null;

  constructor(container: HTMLElement) {
    injectStyles();
    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="objective"><div class="lvl" data-k="lvl"></div><div class="txt" data-k="obj"></div></div>
      <div class="aware" data-k="aware">${ICON.eye}<div class="lbl" data-k="awareLbl"></div></div>
      <div class="xhair" data-k="xhair"><i class="c"></i><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i></div>
      <div class="hitmark" data-k="hit"></div>
      <div class="dmgdir" data-k="dmg"></div>
      <div class="intro" data-k="intro"><div class="a" data-k="introA"></div><div class="b" data-k="introB"></div></div>
      <div class="prompt" data-k="prompt"></div>
      <div class="interact" data-k="interact"><kbd data-k="interactKey"></kbd><span data-k="interactTxt"></span></div>
      <div class="subtitle" data-k="sub"><div class="who" data-k="subWho"></div><div class="line" data-k="subLine"></div></div>
      <div class="toasts" data-k="toasts"></div>
      <div class="note" data-k="note"><div class="hdr">RECOVERED NOTE</div><div data-k="noteTxt"></div></div>
      <div class="vitals">
        <div class="vrow health">${ICON.heart}<div class="vbar"><b class="lag" data-k="hpLag"></b><b class="fill" data-k="hp"></b></div><div class="vnum" data-k="hpNum"></div></div>
        <div class="vrow stamina">${ICON.run}<div class="vbar"><b class="fill" data-k="st"></b></div><div class="vnum"></div></div>
        <div class="vrow battery" data-k="batRow">${ICON.torch}<div class="vbar"><b class="fill" data-k="bat"></b></div><div class="vnum" data-k="batNum"></div></div>
        <div class="medkits" data-k="med"><b>✚</b><span data-k="medNum"></span><kbd data-k="medKey"></kbd></div>
        <div class="keycard" data-k="key">▣ KEYCARD</div>
      </div>
      <div class="boss" data-k="boss"><div class="name" data-k="bossName"></div><div class="bar"><b class="lag" data-k="bossLag"></b><b class="fill" data-k="bossHp"></b></div></div>
      <div class="noise"><div class="bars" data-k="noiseBars"></div><div class="lbl">NOISE</div></div>
      <div class="ammo">
        <div class="slots" data-k="slots"></div>
        <div class="wname" data-k="wname"></div>
        <div><span class="mag" data-k="mag"></span><span class="res" data-k="res"></span></div>
        <div class="pips" data-k="pips"></div>
        <div class="status" data-k="ammoStatus"></div>
      </div>`;
    container.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>("[data-k]").forEach((n) => (this.el[n.dataset.k!] = n));

    for (let i = 0; i < 5; i++) {
      const b = document.createElement("i");
      b.style.height = `${6 + i * 3.5}px`;
      this.el.noiseBars.appendChild(b);
      this.noiseBars.push(b);
    }
    for (let i = 0; i < 4; i++) {
      const d = document.createElement("div");
      this.el.dmg.appendChild(d);
      this.dmgArcs.push(d);
    }
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? "block" : "none";
  }

  setMagSize(n: number): void {
    this.el.pips.innerHTML = "";
    this.pips.length = 0;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i");
      this.el.pips.appendChild(p);
      this.pips.push(p);
    }
  }

  /** The weapon strip above the ammo counter. */
  setWeapons(slots: WeaponSlot[]): void {
    this.el.slots.innerHTML = slots
      .map(
        (w) => `<i data-slot="${w.slot}" class="${w.owned ? "owned" : ""}">${w.slot}<span>${w.owned ? w.name.toUpperCase() : ""}</span></i>`
      )
      .join("");
    this.last.slot = undefined;
  }

  /** The heal key's label, shown next to the medkit count. */
  setHealKey(key: string): void {
    this.el.medKey.textContent = key;
  }

  /** The boss health bar. Pass null to hide it. */
  boss(name: string | null, fraction = 0): void {
    this.el.boss.classList.toggle("show", name !== null);
    if (name === null) return;
    if (this.el.bossName.textContent !== name.toUpperCase()) this.el.bossName.textContent = name.toUpperCase();
    const pct = `${Math.max(0, fraction) * 100}%`;
    if (this.el.bossHp.style.width !== pct) {
      this.el.bossHp.style.width = pct;
      this.el.bossLag.style.width = pct;
    }
  }

  setObjective(level: string, text: string): void {
    this.el.lvl.textContent = level.toUpperCase();
    this.el.obj.textContent = text;
  }

  /** Only touches the DOM for values that changed — this runs every frame. */
  update(s: HudState): void {
    const L = this.last;
    if (L.health !== s.health) {
      const pct = `${Math.max(0, s.health) * 100}%`;
      this.el.hp.style.width = pct;
      this.el.hpLag.style.width = pct;
      this.el.hpNum.textContent = `${Math.ceil(s.health * 100)}`;
    }
    if (L.stamina !== s.stamina) this.el.st.style.width = `${s.stamina * 100}%`;
    if (L.battery !== s.battery || L.torchOn !== s.torchOn) {
      this.el.bat.style.width = `${s.battery * 100}%`;
      this.el.batNum.textContent = `${Math.round(s.battery * 100)}%`;
      this.el.batRow.classList.toggle("low", s.battery < 0.2);
      this.el.batRow.classList.toggle("off", !s.torchOn);
    }
    if (L.mag !== s.mag || L.reserve !== s.reserve || L.reloading !== s.reloading || L.healing !== s.healing || L.weapon !== s.weapon) {
      this.el.mag.textContent = `${s.mag}`;
      this.el.mag.classList.toggle("empty", s.mag === 0);
      this.el.res.textContent = `/ ${s.reserve}`;
      this.pips.forEach((p, i) => p.classList.toggle("spent", i >= s.mag));
      this.el.ammoStatus.textContent = s.healing
        ? "HEALING"
        : s.reloading
          ? s.singleLoad
            ? "LOADING"
            : "RELOADING"
          : s.mag === 0 && s.reserve === 0
            ? "NO AMMO"
            : s.mag <= 2 && s.reserve > 0
              ? "[R] RELOAD"
              : "";
    }
    if (L.noise !== s.noise) {
      this.noiseBars.forEach((b, i) => {
        b.classList.toggle("on", i < s.noise);
        b.classList.toggle("loud", s.noise >= 4);
      });
    }
    if (L.threat !== s.threat) {
      const a = this.el.aware;
      a.style.opacity = s.threat > 0.05 ? `${Math.min(1, 0.3 + s.threat)}` : "0";
      a.classList.toggle("hunted", s.threat >= 1);
      a.classList.toggle("sus", s.threat > 0 && s.threat < 1);
      this.el.awareLbl.textContent = s.threat >= 1 ? "HUNTED" : s.threat > 0.05 ? "SUSPICIOUS" : "";
    }
    if (L.spreadPx !== s.spreadPx) {
      const g = Math.round(4 + s.spreadPx);
      const [, t, b, l, r] = Array.from(this.el.xhair.children) as HTMLElement[];
      t.style.top = `${-g - 7}px`;
      b.style.top = `${g}px`;
      l.style.left = `${-g - 7}px`;
      r.style.left = `${g}px`;
    }
    if (L.hasKeycard !== s.hasKeycard) this.el.key.classList.toggle("show", s.hasKeycard);
    if (L.weapon !== s.weapon) this.el.wname.textContent = s.weapon.toUpperCase();
    if (L.slot !== s.slot)
      this.el.slots.querySelectorAll<HTMLElement>("i").forEach((i) => i.classList.toggle("on", Number(i.dataset.slot) === s.slot));
    if (L.medkits !== s.medkits) {
      this.el.medNum.textContent = `×${s.medkits}`;
      this.el.med.classList.toggle("none", s.medkits === 0);
    }
    this.last = { ...s };
  }

  hitMarker(headshot: boolean, kill: boolean): void {
    const h = this.el.hit;
    h.className = `hitmark${headshot ? " head" : ""}${kill ? " kill" : ""}`;
    h.style.transition = "none";
    h.style.opacity = "1";
    window.clearTimeout(this.hitTimeout);
    this.hitTimeout = window.setTimeout(
      () => {
        h.style.transition = "";
        h.style.opacity = "0";
      },
      kill ? 220 : 90
    );
  }

  /** angle: radians, 0 = straight ahead, positive = to the right. */
  damageFrom(angle: number): void {
    const d = this.dmgArcs[this.dmgArcCursor];
    this.dmgArcCursor = (this.dmgArcCursor + 1) % this.dmgArcs.length;
    d.style.transform = `rotate(${angle}rad)`;
    d.style.transition = "none";
    d.style.opacity = "1";
    void d.offsetWidth;
    d.style.transition = "";
    d.style.opacity = "0";
  }

  toast(text: string, color = "var(--ui-amber)"): void {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    t.style.borderRightColor = color;
    this.el.toasts.appendChild(t);
    window.setTimeout(() => t.remove(), 2700);
  }

  prompt(text: string, seconds = 2): void {
    this.el.prompt.textContent = text;
    this.el.prompt.classList.add("show");
    window.clearTimeout(this.promptTimeout);
    this.promptTimeout = window.setTimeout(() => this.el.prompt.classList.remove("show"), seconds * 1000);
  }

  showNote(text: string): void {
    this.el.noteTxt.textContent = text;
    this.el.note.classList.add("show");
    window.clearTimeout(this.noteTimeout);
    this.noteTimeout = window.setTimeout(() => this.el.note.classList.remove("show"), 7000);
  }

  /** Shows a radio line (or the player's own thought), or hides the subtitle with null. */
  subtitle(line: RadioLine | null): void {
    const el = this.el.sub;
    if (!line) {
      el.classList.remove("show");
      return;
    }
    el.className = `subtitle show ${line.speaker}`;
    this.el.subWho.textContent = SPEAKER_NAMES[line.speaker];
    this.el.subLine.textContent = line.text;
  }

  /** The "[E] OPEN DOOR" prompt. Pass null to hide. */
  interactPrompt(key: string | null, text: string | null): void {
    const show = key !== null && text !== null;
    if (show && (this.lastInteract !== text || this.lastInteractKey !== key)) {
      this.el.interactKey.textContent = key;
      this.el.interactTxt.textContent = text;
    }
    this.lastInteract = show ? text : null;
    this.lastInteractKey = show ? key : null;
    this.el.interact.classList.toggle("show", show);
  }

  hideTransient(): void {
    this.subtitle(null);
    this.interactPrompt(null, null);
    this.el.note.classList.remove("show");
    this.el.intro.classList.remove("show");
    this.el.prompt.classList.remove("show");
    this.el.toasts.innerHTML = "";
    this.boss(null);
  }

  intro(a: string, b: string): void {
    this.el.introA.textContent = a.toUpperCase();
    this.el.introB.textContent = b.toUpperCase();
    this.el.intro.classList.add("show");
    window.clearTimeout(this.introTimeout);
    this.introTimeout = window.setTimeout(() => this.el.intro.classList.remove("show"), 3200);
  }
}
