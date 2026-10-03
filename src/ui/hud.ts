import { HOLD_TIME } from "../player/breath";
import { esc } from "./inventory";
import { currentCharacter } from "../content/characters";
import type { RadioLine } from "../game/script";
import { injectStyles } from "./styles";

const ICON = {
  lungs: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 3h2v7.5l1.6 1.1C15 8 16.6 5 19 5c2 0 3 3 3 8 0 5-1 7-3 7-2.5 0-5-1.5-5-5v-2.2L12 11.6 10 12.8V15c0 3.5-2.5 5-5 5-2 0-3-2-3-7 0-5 1-8 3-8 2.4 0 4 3 4.4 6.6L11 10.5z"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>`,
  run: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="14" cy="4" r="2.2"/><path d="M9 21l2.2-6 2.4 2.2V22h2v-6.2l-2.6-2.6.8-3.6c1.2 1.5 3 2.4 5.2 2.4v-2c-1.7 0-3.2-.9-4-2.2l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5 0-.8.1L6 7.6V12h2V9l1.8-.7L7 21h2z"/></svg>`,
  torch: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h10v5l-3 4v11h-4V11L7 7V2zm2 2v2h6V4H9z"/></svg>`,
  eye: `<svg viewBox="0 0 36 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 10C7 3 12 1 18 1s11 2 16 9c-5 7-10 9-16 9S7 17 2 10z"/><circle cx="18" cy="10" r="4" fill="currentColor"/></svg>`,
};

/** The name shown over a line: your own lines carry your character's name. */
export function speakerName(speaker: RadioLine["speaker"]): string {
  return speaker === "nur" ? currentCharacter().firstName.toUpperCase() : SPEAKER_NAMES[speaker];
}

export const SPEAKER_NAMES: Record<RadioLine["speaker"], string> = {
  operator: "OPERATOR — RADIO",
  nur: "NUR",
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
  /** Air left while holding your breath, 0..1 (1 = breathing normally). */
  breath: number;
  breathHeld: boolean;
  /** Bottles carried. */
  throwables: number;
  /** Co-op voice: your microphone is off, live, or picking you up talking. */
  mic: "off" | "open" | "talking";
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
  /** Label of the reload key, for the low-ammo hint. */
  reloadKey: string;
  /** False while you can't shoot (sprinting, switching, healing): the crosshair fades. */
  canFire: boolean;
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
      <div class="slats" data-k="slats"></div>
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
        <div class="vrow breath" data-k="brRow">${ICON.lungs}<div class="vbar"><b class="fill" data-k="br"></b></div><div class="vnum" data-k="brTxt"></div></div>
        <div class="vrow battery" data-k="batRow">${ICON.torch}<div class="vbar"><b class="fill" data-k="bat"></b></div><div class="vnum" data-k="batNum"></div></div>
        <div class="medkits" data-k="med"><b>✚</b><span data-k="medNum"></span><kbd data-k="medKey"></kbd></div>
        <div class="medkits throwables" data-k="thr"><b>◆</b><span data-k="thrNum"></span><kbd data-k="thrKey"></kbd></div>
        <div class="keycard" data-k="key">▣ KEYCARD</div>
        <div class="partners" data-k="partners"></div>
        <div class="mic" data-k="mic">● MIC</div>
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

  /** Co-op: the other player's health and state, or null to hide it. */
  /** The other players' health, one line each (none outside co-op). */
  partners(list: { hp: number; down: boolean; bleed: number; talking?: boolean; name?: string; color?: string }[]): void {
    const html = list
      .map(
        (p) =>
          `<div class="partner show${p.down ? " down" : ""}${p.talking ? " talking" : ""}"><span${p.color && !p.down ? ` style="color:${esc(p.color)}"` : ""}>${esc((p.name ?? "PARTNER").toUpperCase())}</span><div class="pbar"><b style="width:${Math.round(
            p.hp * 100
          )}%"></b></div><span>${p.down ? `DOWN ${p.bleed}s` : ""}</span></div>`
      )
      .join("");
    if (html !== this.partnersHtml) this.el.partners.innerHTML = this.partnersHtml = html;
  }
  private partnersHtml = "";

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

  /** The heal key's label, shown next to the medkit count. Cheap to call every frame. */
  setHealKey(key: string, throwKey?: string): void {
    if (this.el.medKey.textContent !== key) this.el.medKey.textContent = key;
    if (throwKey !== undefined && this.el.thrKey.textContent !== throwKey) this.el.thrKey.textContent = throwKey;
  }

  /** HUD size and subtitle size (accessibility settings). */
  applyDisplay(hudScale: number, subtitleSize: "small" | "medium" | "large"): void {
    this.root.style.setProperty("--hud-scale", String(hudScale));
    this.root.classList.toggle("sub-small", subtitleSize === "small");
    this.root.classList.toggle("sub-large", subtitleSize === "large");
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
    if (L.breath !== s.breath || L.breathHeld !== s.breathHeld) {
      this.el.br.style.width = `${s.breath * 100}%`;
      this.el.brRow.classList.toggle("on", s.breathHeld || s.breath < 1);
      this.el.brRow.classList.toggle("held", s.breathHeld);
      this.el.brRow.classList.toggle("low", s.breathHeld && s.breath < 0.3);
      // Seconds of air left while you hold it; the bar alone while you get it back.
      this.el.brTxt.textContent = s.breathHeld ? `${Math.ceil(s.breath * HOLD_TIME)}s` : "";
    }
    if (L.battery !== s.battery || L.torchOn !== s.torchOn) {
      this.el.bat.style.width = `${s.battery * 100}%`;
      this.el.batNum.textContent = `${Math.round(s.battery * 100)}%`;
      this.el.batRow.classList.toggle("low", s.battery < 0.2);
      this.el.batRow.classList.toggle("off", !s.torchOn);
    }
    if (
      L.mag !== s.mag ||
      L.reserve !== s.reserve ||
      L.reloading !== s.reloading ||
      L.healing !== s.healing ||
      L.weapon !== s.weapon ||
      L.reloadKey !== s.reloadKey
    ) {
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
              ? `[${s.reloadKey}] RELOAD`
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
    if (L.canFire !== s.canFire) this.el.xhair.style.opacity = s.canFire ? "1" : "0.15";
    if (L.weapon !== s.weapon) this.el.wname.textContent = s.weapon.toUpperCase();
    if (L.slot !== s.slot)
      this.el.slots.querySelectorAll<HTMLElement>("i").forEach((i) => i.classList.toggle("on", Number(i.dataset.slot) === s.slot));
    if (L.mic !== s.mic) {
      this.el.mic.classList.toggle("open", s.mic !== "off");
      this.el.mic.classList.toggle("talking", s.mic === "talking");
    }
    if (L.throwables !== s.throwables) {
      this.el.thrNum.textContent = `×${s.throwables}`;
      this.el.thr.classList.toggle("none", s.throwables === 0);
    }
    if (L.medkits !== s.medkits) {
      this.el.medNum.textContent = `×${s.medkits}`;
      this.el.med.classList.toggle("none", s.medkits === 0);
    }
    this.last = { ...s };
  }

  /** `armoured`: the hit was mostly soaked (the Remnant's hide) — a small, dull marker. */
  hitMarker(headshot: boolean, kill: boolean, armoured = false): void {
    const h = this.el.hit;
    h.className = `hitmark${headshot ? " head" : ""}${kill ? " kill" : ""}${armoured ? " armoured" : ""}`;
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
    this.el.subWho.textContent = speakerName(line.speaker);
    this.el.subLine.textContent = line.text;
  }

  /** Inside a locker: the world through its slats. */
  hiding(on: boolean): void {
    this.el.slats.classList.toggle("show", on);
    this.el.xhair.style.visibility = on ? "hidden" : "";
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
