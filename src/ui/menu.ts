import { ACTIONS, ACTION_LABELS, RESERVED_CODES, keyLabel, rebind, type Action, type Bindings } from "../core/actions";
import type { Settings } from "../core/settings";
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId } from "../content/difficulty";
import type { Ending } from "../content/story";
import { accuracy, type RunStats } from "../game/stats";
import { injectStyles } from "./styles";

export interface MenuItem {
  label: string;
  action: () => void;
  primary?: boolean;
  /** Small second line under the label. */
  detail?: string;
  disabled?: boolean;
}

export interface ChapterEntry {
  name: string;
  subtitle: string;
  unlocked: boolean;
  bestTime?: number;
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Full-screen menus. Each method replaces whatever screen is showing. */
export class Screens {
  private readonly root: HTMLDivElement;
  /** Cleanup for listeners a screen installs outside its own DOM (key capture). */
  private teardown: (() => void) | null = null;
  onUiSound: (() => void) | null = null;

  constructor(container: HTMLElement) {
    injectStyles();
    this.root = document.createElement("div");
    this.root.className = "screen";
    container.appendChild(this.root);
    this.root.addEventListener("mouseover", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (b && !b.disabled) this.onUiSound?.();
    });
  }

  get visible(): boolean {
    return this.root.classList.contains("show");
  }

  hide(): void {
    this.teardown?.();
    this.teardown = null;
    this.root.classList.remove("show");
  }

  private render(html: string, items: MenuItem[], opaque = false, row = false): void {
    this.teardown?.();
    this.teardown = null;
    this.root.innerHTML = `${html}<div class="menu${row ? " row" : ""}">${items
      .map(
        (it, i) =>
          `<button data-i="${i}" class="${it.primary ? "primary" : ""}" ${it.disabled ? "disabled" : ""}>${esc(it.label)}${
            it.detail ? `<small>${esc(it.detail)}</small>` : ""
          }</button>`
      )
      .join("")}</div>`;
    this.root.querySelectorAll<HTMLButtonElement>("button[data-i]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        items[Number(b.dataset.i)].action();
      });
    });
    this.root.classList.toggle("opaque", opaque);
    this.root.classList.add("show");
    this.root.querySelector<HTMLButtonElement>("button.primary:not(:disabled)")?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ main flow

  main(items: MenuItem[], version: string): void {
    this.render(`<h1>REMNANT</h1><div class="tag">OBJECT 9 · TIAN SHAN · SUBLEVEL 10</div>`, items);
    this.root.insertAdjacentHTML(
      "beforeend",
      `<div class="hint">HEADPHONES RECOMMENDED · THEY HUNT BY SOUND</div><div class="version">v${esc(version)}</div>`
    );
  }

  difficulty(onPick: (id: DifficultyId) => void, back: () => void, completed: readonly DifficultyId[]): void {
    this.render(
      `<h2>NEW GAME</h2><div class="tag">CHOOSE HOW MUCH THE DARK WANTS YOU</div>`,
      [
        ...DIFFICULTY_ORDER.map((id) => ({
          label: DIFFICULTIES[id].name + (completed.includes(id) ? " ✓" : ""),
          detail: DIFFICULTIES[id].description,
          primary: id === "normal",
          action: () => onPick(id),
        })),
        { label: "Back", action: back },
      ],
      true
    );
  }

  chapters(entries: ChapterEntry[], onPick: (index: number) => void, back: () => void): void {
    this.render(
      `<h2>CHAPTERS</h2><div class="tag">REPLAY ANY SUBLEVEL YOU HAVE REACHED</div>`,
      [
        ...entries.map((c, i) => ({
          label: c.unlocked ? `${i + 1}. ${c.name}` : `${i + 1}. ???`,
          detail: c.unlocked ? `${c.subtitle}${c.bestTime ? ` · best ${formatTime(c.bestTime)}` : ""}` : "Locked",
          disabled: !c.unlocked,
          primary: i === 0,
          action: () => onPick(i),
        })),
        { label: "Back", action: back },
      ],
      true
    );
  }

  confirm(title: string, text: string, confirmLabel: string, onConfirm: () => void, onCancel: () => void): void {
    this.render(
      `<h2>${esc(title)}</h2><div class="sub">${esc(text)}</div>`,
      [
        { label: "Cancel", primary: true, action: onCancel },
        { label: confirmLabel, action: onConfirm },
      ],
      true
    );
  }

  pause(items: MenuItem[], difficultyName: string): void {
    this.render(`<h2>PAUSED</h2><div class="tag">THE DARK IS PATIENT · ${esc(difficultyName.toUpperCase())}</div>`, items);
  }

  death(stats: RunStats, items: MenuItem[], runOver: boolean): void {
    const tag = runOver ? "IRONMAN · THE RUN IS OVER" : "THE DARK GOT THERE FIRST";
    this.render(`<h2 class="red">YOU DIED</h2><div class="tag">${tag}</div>${this.statsHtml(stats)}`, items, true);
  }

  levelComplete(name: string, subtitle: string, stats: RunStats, newBest: boolean, items: MenuItem[]): void {
    this.render(
      `<h2>${esc(name.toUpperCase())}</h2><div class="tag">${esc(subtitle.toUpperCase())} · CLEARED${
        newBest ? ` · <span class="best">NEW BEST</span>` : ""
      }</div>${this.statsHtml(stats)}`,
      items,
      true
    );
  }

  /** Narrative text screen (prologue). */
  story(title: string, lines: string[], items: MenuItem[]): void {
    this.render(
      `<h2>${esc(title)}</h2><div class="story">${lines.map((l, i) => `<p style="animation-delay:${0.3 + i * 0.9}s">${esc(l)}</p>`).join("")}</div>`,
      items,
      true
    );
  }

  ending(ending: Ending, stats: RunStats, difficultyName: string, items: MenuItem[]): void {
    this.render(
      `<h2>${esc(ending.title)}</h2><div class="tag">${esc(ending.tag)} · ${esc(difficultyName.toUpperCase())}</div>
       <div class="story">${ending.lines.map((l, i) => `<p style="animation-delay:${0.4 + i * 1.1}s">${esc(l)}</p>`).join("")}</div>
       ${this.statsHtml(stats)}`,
      items,
      true
    );
  }

  private statsHtml(s: RunStats): string {
    return `<div class="stats">
      <span>TIME</span><span>${formatTime(s.time)}</span>
      <span>KILLS</span><span>${s.kills}</span>
      <span>ACCURACY</span><span>${Math.round(accuracy(s) * 100)}%</span>
      <span>HEADSHOTS</span><span>${s.headshots}</span>
      <span>TAKEDOWNS</span><span>${s.takedowns}</span>
      <span>DAMAGE TAKEN</span><span>${Math.round(s.damageTaken)}</span>
    </div>`;
  }

  // ------------------------------------------------------------------ options

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
    type NumericKey = "sensitivity" | "fov" | "volume";
    const fmt = (k: NumericKey, v: number) => (k === "volume" ? `${Math.round(v * 100)}%` : k === "fov" ? `${v}°` : `${v.toFixed(2)}×`);
    this.root.querySelectorAll<HTMLInputElement>("input[data-s]").forEach((input) => {
      const key = input.dataset.s as NumericKey | "invertY";
      const out = input.nextElementSibling as HTMLOutputElement | null;
      if (key === "invertY") input.checked = settings.invertY;
      else {
        input.value = String(settings[key]);
        if (out) out.textContent = fmt(key, settings[key]);
      }
      input.addEventListener("input", () => {
        if (key === "invertY") settings.invertY = input.checked;
        else {
          settings[key] = Number(input.value);
          if (out) out.textContent = fmt(key, settings[key]);
        }
        onChange(settings);
      });
    });
  }

  /**
   * Controls with rebinding. Click a slot, then press a key or mouse button.
   * Escape cancels, Backspace/Delete clears the slot.
   */
  controls(bindings: Bindings, onChange: (b: Bindings) => void, onReset: () => void, back: () => void): void {
    let current = bindings;
    const slotHtml = (a: Action, s: 0 | 1) => `<button class="slot" data-a="${a}" data-s="${s}">${esc(keyLabel(current[a][s]))}</button>`;
    this.render(
      `<h2>CONTROLS</h2><div class="tag">CLICK A KEY TO CHANGE IT · BACKSPACE CLEARS</div>
       <div class="panel">
         <div class="binds">${ACTIONS.map((a) => `<span>${ACTION_LABELS[a]}</span>${slotHtml(a, 0)}${slotHtml(a, 1)}`).join(
           ""
         )}<span>Look</span><kbd>Mouse</kbd><kbd>—</kbd><span>Pause</span><kbd>Esc</kbd><kbd>—</kbd></div>
         <div class="tips">
           Everything makes noise, and gunshots carry through walls. Your flashlight lets them see you from much
           further. Break line of sight and stay quiet — they give up eventually. Headshots do extra damage.
           Sneak up behind an unaware creature and melee for a silent takedown. Medkits are carried: heal when you choose.
         </div>
       </div>`,
      [
        { label: "Back", action: back, primary: true },
        { label: "Reset to Defaults", action: onReset },
      ],
      false,
      true
    );

    const refresh = () =>
      this.root.querySelectorAll<HTMLButtonElement>("button.slot").forEach((b) => {
        b.textContent = keyLabel(current[b.dataset.a as Action][Number(b.dataset.s) as 0 | 1]);
        b.classList.remove("listening");
      });

    let stopListening: (() => void) | null = null;
    const listen = (btn: HTMLButtonElement) => {
      stopListening?.();
      refresh();
      const action = btn.dataset.a as Action;
      const slot = Number(btn.dataset.s) as 0 | 1;
      btn.textContent = "PRESS A KEY";
      btn.classList.add("listening");
      const finish = (code: string | null | undefined) => {
        stopListening?.();
        if (code !== undefined) {
          current = rebind(current, action, slot, code);
          onChange(current);
        }
        refresh();
      };
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === "Escape") finish(undefined);
        else if (e.code === "Backspace" || e.code === "Delete") finish(null);
        else if (!RESERVED_CODES.has(e.code)) finish(e.code);
      };
      const onMouse = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        finish(`Mouse${e.button}`);
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY !== 0) finish(e.deltaY < 0 ? "WheelUp" : "WheelDown");
      };
      const noMenu = (e: Event) => e.preventDefault();
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("wheel", onWheel, { capture: true, passive: false });
      window.addEventListener("contextmenu", noMenu, true);
      // Attach on the next tick so the click that started listening isn't captured as the binding.
      const t = window.setTimeout(() => window.addEventListener("mousedown", onMouse, true));
      stopListening = () => {
        window.clearTimeout(t);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("mousedown", onMouse, true);
        window.removeEventListener("wheel", onWheel, true);
        window.removeEventListener("contextmenu", noMenu, true);
        stopListening = null;
      };
      this.teardown = () => stopListening?.();
    };

    this.root.querySelectorAll<HTMLButtonElement>("button.slot").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        listen(b);
      })
    );
  }
}
