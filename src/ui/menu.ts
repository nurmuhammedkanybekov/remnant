import type { Settings } from "../core/settings";
import { injectStyles } from "./styles";

export interface MenuItem {
  label: string;
  action: () => void;
  primary?: boolean;
}

export interface RunStats {
  time: number; // seconds
  kills: number;
  shots: number;
  hits: number;
  headshots: number;
  damageTaken: number;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Full-screen menus: main, pause, settings, controls, death, level complete, victory. */
export class Screens {
  private readonly root: HTMLDivElement;
  onUiSound: (() => void) | null = null;

  constructor(container: HTMLElement) {
    injectStyles();
    this.root = document.createElement("div");
    this.root.className = "screen";
    container.appendChild(this.root);
    // Hover ticks
    this.root.addEventListener("mouseover", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") this.onUiSound?.();
    });
  }

  get visible(): boolean {
    return this.root.classList.contains("show");
  }

  hide(): void {
    this.root.classList.remove("show");
  }

  private render(html: string, items: MenuItem[], opaque = false): void {
    this.root.innerHTML = `${html}<div class="menu">${items
      .map((it, i) => `<button data-i="${i}" class="${it.primary ? "primary" : ""}">${esc(it.label)}</button>`)
      .join("")}</div>`;
    this.root.querySelectorAll("button[data-i]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        items[Number((b as HTMLElement).dataset.i)].action();
      });
    });
    this.root.classList.toggle("opaque", opaque);
    this.root.classList.add("show");
    (this.root.querySelector("button.primary") as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  main(items: MenuItem[]): void {
    this.render(
      `<h1>REMNANT</h1>
       <div class="tag">SURVIVE THE SUBLEVELS</div>`,
      items
    );
    this.root.insertAdjacentHTML("beforeend", `<div class="hint">HEADPHONES RECOMMENDED · THEY HUNT BY SOUND</div>`);
  }

  pause(items: MenuItem[]): void {
    this.render(`<h2>PAUSED</h2><div class="tag">THE DARK IS PATIENT</div>`, items);
  }

  death(stats: RunStats, items: MenuItem[]): void {
    this.render(`<h2 class="red">YOU DIED</h2><div class="tag">THE DARK GOT THERE FIRST</div>${this.statsHtml(stats)}`, items, true);
  }

  levelComplete(name: string, subtitle: string, stats: RunStats, items: MenuItem[]): void {
    this.render(
      `<h2>${esc(name.toUpperCase())}</h2><div class="tag">${esc(subtitle.toUpperCase())} · CLEARED</div>${this.statsHtml(stats)}`,
      items,
      true
    );
  }

  victory(stats: RunStats, items: MenuItem[]): void {
    this.render(
      `<h2>DAYLIGHT</h2><div class="tag">YOU MADE IT OUT. NOT EVERYONE DOES.</div>${this.statsHtml(stats)}`,
      items,
      true
    );
  }

  private statsHtml(s: RunStats): string {
    const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0;
    return `<div class="stats">
      <span>TIME</span><span>${fmtTime(s.time)}</span>
      <span>KILLS</span><span>${s.kills}</span>
      <span>ACCURACY</span><span>${acc}%</span>
      <span>HEADSHOTS</span><span>${s.headshots}</span>
      <span>DAMAGE TAKEN</span><span>${Math.round(s.damageTaken)}</span>
    </div>`;
  }

  settings(settings: Settings, onChange: (s: Settings) => void, back: () => void): void {
    this.render(
      `<h2>SETTINGS</h2><div class="tag">&nbsp;</div>
       <div class="panel">
         <label>MOUSE SENSITIVITY <input type="range" min="0.2" max="3" step="0.05" data-s="sensitivity"><output></output></label>
         <label>FIELD OF VIEW <input type="range" min="60" max="100" step="1" data-s="fov"><output></output></label>
         <label>VOLUME <input type="range" min="0" max="1" step="0.05" data-s="volume"><output></output></label>
         <label>INVERT MOUSE Y <input type="checkbox" data-s="invertY"></label>
       </div>`,
      [{ label: "Back", action: back, primary: true }]
    );
    const fmt = (k: string, v: number) => (k === "volume" ? `${Math.round(v * 100)}%` : k === "fov" ? `${v}°` : `${v.toFixed(2)}×`);
    this.root.querySelectorAll<HTMLInputElement>("input[data-s]").forEach((input) => {
      const key = input.dataset.s as keyof Settings;
      const out = input.nextElementSibling as HTMLOutputElement | null;
      if (input.type === "checkbox") input.checked = Boolean(settings[key]);
      else {
        input.value = String(settings[key]);
        if (out) out.textContent = fmt(key, Number(input.value));
      }
      input.addEventListener("input", () => {
        const next = { ...settings };
        if (input.type === "checkbox") (next[key] as boolean) = input.checked;
        else {
          (next[key] as number) = Number(input.value);
          if (out) out.textContent = fmt(key, Number(input.value));
        }
        Object.assign(settings, next);
        onChange(settings);
      });
    });
  }

  controls(back: () => void): void {
    const rows: [string, string][] = [
      ["W A S D", "Move"],
      ["Mouse", "Look"],
      ["Left click", "Fire"],
      ["R", "Reload"],
      ["Shift", "Sprint (loud)"],
      ["C / Ctrl", "Crouch (quiet)"],
      ["F", "Flashlight"],
      ["Esc", "Pause"],
    ];
    this.render(
      `<h2>CONTROLS</h2><div class="tag">&nbsp;</div>
       <div class="panel"><div class="keys">${rows.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join("")}</div>
       <div class="tips">
         · Everything you do makes noise. Gunshots carry through walls.<br>
         · Your flashlight lets you see — and lets them see you from much further.<br>
         · Break line of sight and stay quiet: they give up eventually.<br>
         · Headshots do 2.5× damage. Their wind-up can be dodged.
       </div></div>`,
      [{ label: "Back", action: back, primary: true }]
    );
  }
}
