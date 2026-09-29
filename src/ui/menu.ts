import { ACTIONS, ACTION_LABELS, RESERVED_CODES, keyLabel, rebind, type Action, type Bindings } from "../core/actions";
import { PAD_LAYOUT } from "../core/gamepad";
import { QUALITY, QUALITY_ORDER } from "../core/quality";
import { SUBTITLE_SIZES, type Settings } from "../core/settings";
import { fullName, LOOK_ORDER, LOOKS, type CharacterLook } from "../content/characters";
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId } from "../content/difficulty";
import type { Ending } from "../content/story";
import { accuracy, type RunStats } from "../game/stats";
import { gearHtml, journalHtml, radioHtml, type InventoryTab, type InventoryView } from "./inventory";
import { injectStyles } from "./styles";

export interface MenuItem {
  label: string;
  action: () => void;
  primary?: boolean;
  /** Small second line under the label. */
  detail?: string;
  disabled?: boolean;
}

/** One sublevel on the main menu's depth gauge and the level cards. */
export interface DepthEntry {
  name: string;
  subtitle: string;
  reached: boolean;
}

export interface LevelCard {
  /** 0-based position in the campaign. */
  index: number;
  name: string;
  subtitle: string;
  tagline: string;
  objective: string;
  /** The whole campaign, bottom to top, for the depth gauge. */
  depth: DepthEntry[];
  /** "Click or press any key" / "Press A". */
  prompt: string;
}

/** Labels that make a button the screen's "back" action (the gamepad's B). */
const BACK_LABELS = new Set(["Back", "Cancel", "Resume", "Main Menu"]);

export interface ChapterEntry {
  name: string;
  subtitle: string;
  unlocked: boolean;
  bestTime?: number;
}

/** One level's line on the leaderboard. */
export interface BoardRow {
  level: string;
  top: { name: string; time: number; me: boolean }[];
  mine: { time: number; rank: number } | null;
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

type NumericKey = "sensitivity" | "padSensitivity" | "fov" | "volume" | "musicVolume" | "hudScale";
type ToggleKey = "invertY" | "reducedShake" | "colorBlind";
type CycleKey = "quality" | "subtitleSize" | "look";

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

  /** Screens that take "any button" (the title) set this for the gamepad. */
  private onAnyButton: (() => void) | null = null;

  // ------------------------------------------------------------------ gamepad navigation

  private focusables(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>("button:not(:disabled), input")].filter((el) => el.offsetParent !== null);
  }

  /** Move focus up (-1) or down (1) through the screen's buttons and controls. */
  navigate(dir: 1 | -1): void {
    const list = this.focusables();
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = list[i < 0 ? 0 : (i + dir + list.length) % list.length];
    next.focus();
    next.scrollIntoView({ block: "nearest" });
    this.onUiSound?.();
  }

  /** Left/right on a slider or a cycling option. */
  adjust(dir: 1 | -1): void {
    const el = document.activeElement as HTMLElement | null;
    if (el instanceof HTMLInputElement && el.type === "range") {
      if (dir > 0) el.stepUp();
      else el.stepDown();
      el.dispatchEvent(new Event("input"));
    } else if (el instanceof HTMLButtonElement && el.classList.contains("cycle")) {
      el.click();
    }
  }

  /** The gamepad's A: press whatever is focused (or the primary button). */
  activate(): void {
    if (this.onAnyButton) {
      const f = this.onAnyButton;
      this.onAnyButton = null;
      f();
      return;
    }
    const el = document.activeElement as HTMLElement | null;
    if (el && this.root.contains(el)) el.click();
    else this.root.querySelector<HTMLButtonElement>("button.primary:not(:disabled)")?.click();
  }

  /** The gamepad's B: the screen's Back / Cancel / Resume, if it has one. */
  back(): void {
    this.root.querySelector<HTMLButtonElement>("button[data-back]")?.click();
  }

  get visible(): boolean {
    return this.root.classList.contains("show");
  }

  hide(): void {
    this.teardown?.();
    this.teardown = null;
    this.onAnyButton = null;
    this.root.classList.remove("show");
  }

  private render(html: string, items: MenuItem[], opaque = false, row = false, variant = ""): void {
    this.teardown?.();
    this.teardown = null;
    this.onAnyButton = null;
    // Switching tabs within the same screen shouldn't replay the fade-in.
    const same = variant !== "" && this.visible && this.root.classList.contains(variant);
    this.root.style.animation = same ? "none" : "";
    this.root.className = `screen${variant ? ` ${variant}` : ""}`;
    this.root.innerHTML = `${html}<div class="menu${row ? " row" : ""}">${items
      .map(
        (it, i) =>
          `<button data-i="${i}" class="${it.primary ? "primary" : ""}" ${it.disabled ? "disabled" : ""} ${
            BACK_LABELS.has(it.label) ? "data-back" : ""
          }>${esc(it.label)}${it.detail ? `<small>${esc(it.detail)}</small>` : ""}</button>`
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

  /** The first screen: loading is done, waiting for a key (browsers only allow audio after one). */
  title(prompt: string, onStart: () => void): void {
    this.render(
      `<h1>REMNANT</h1><div class="tag">OBJECT 9 · TIAN SHAN</div><div class="press">${esc(prompt)}</div>`,
      [],
      true,
      false,
      "title"
    );
    const go = (e: Event) => {
      e.preventDefault();
      onStart();
    };
    const opts = { capture: true, once: true } as const;
    window.addEventListener("keydown", go, opts);
    window.addEventListener("mousedown", go, opts);
    this.teardown = () => {
      window.removeEventListener("keydown", go, opts);
      window.removeEventListener("mousedown", go, opts);
    };
    this.onAnyButton = onStart;
  }

  /**
   * The main menu: title and options on the left, the shaft on the right —
   * every sublevel from the bottom to the surface, lit up as far as you've
   * climbed — and radio fragments ticking along the bottom.
   */
  main(items: MenuItem[], version: string, depth: DepthEntry[], transmission: string): void {
    this.render(
      `<div class="brand"><h1>REMNANT</h1><div class="tag">OBJECT 9 · TIAN SHAN · 2.4 KM DOWN</div></div>`,
      items,
      false,
      false,
      "main-menu"
    );
    this.root.insertAdjacentHTML(
      "beforeend",
      `${this.gaugeHtml(depth, -1)}
       <div class="transmission"><span class="dot"></span><span class="who">INTERCEPTED</span><span class="txt">${esc(transmission)}</span></div>
       <div class="version">v${esc(version)}</div>`
    );
  }

  /** The card between the menu and a level: where you are in the shaft, and what you're doing there. */
  levelCard(card: LevelCard, onBegin: () => void): void {
    this.render(
      `<div class="card-body">
         <div class="depth-no">${(card.name.match(/\d+/)?.[0] ?? "0").padStart(2, "0")}</div>
         <div class="card-text">
           <div class="card-name">${esc(card.name.toUpperCase())}</div>
           <div class="card-sub">${esc(card.subtitle.toUpperCase())}</div>
           <div class="card-tagline">“${esc(card.tagline)}”</div>
           <div class="card-obj"><span>OBJECTIVE</span>${esc(card.objective)}</div>
         </div>
       </div>
       <div class="press">${esc(card.prompt)}</div>`,
      [{ label: "Begin", primary: true, action: onBegin }],
      true,
      false,
      "level-card"
    );
    this.root.insertAdjacentHTML("beforeend", this.gaugeHtml(card.depth, card.index));
    // Any key starts the level (the click on "Begin" is the mouse's way in).
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") return;
      e.preventDefault();
      onBegin();
    };
    window.addEventListener("keydown", onKey, true);
    this.teardown = () => window.removeEventListener("keydown", onKey, true);
  }

  /** Vertical shaft: surface at the top, Sublevel 10 at the bottom. */
  private gaugeHtml(depth: DepthEntry[], current: number): string {
    const rows = depth
      .map((d, i) => {
        const cls = i === current ? "cur" : d.reached ? "reached" : "";
        return `<li class="${cls}"><i></i><b>${esc(d.name.toUpperCase())}</b><span>${d.reached || i === current ? esc(d.subtitle) : "—"}</span></li>`;
      })
      .reverse()
      .join("");
    return `<ol class="gauge">${rows}</ol>`;
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

  /**
   * The inventory. `view` is read again after every change (a medkit used
   * from here, a tab switched), so it always shows the current state.
   * Esc, the inventory key (`closeCodes`) or Back closes it.
   */
  inventory(
    view: () => InventoryView,
    /** `onHeal` closes the inventory and starts using a medkit. */
    opts: { onClose: () => void; onHeal: () => void; closeCodes: readonly string[] },
    tab: InventoryTab = "gear",
    note = 0
  ): void {
    const v = view();
    const tabs: [InventoryTab, string][] = [
      ["gear", "Equipment"],
      ["journal", `Journal (${v.notes.length})`],
      ["radio", "Radio log"],
    ];
    const body = tab === "gear" ? gearHtml(v) : tab === "journal" ? journalHtml(v, note) : radioHtml(v);
    const canHeal = v.medkits > 0 && v.health < v.maxHealth;
    this.render(
      `<h2>INVENTORY</h2><div class="tag">${esc(v.place.toUpperCase())} · ${esc(v.difficulty.toUpperCase())}${
        v.live ? " · THE GAME KEEPS RUNNING" : ""
      }</div>
       <div class="inv-tabs">${tabs
         .map(([id, label]) => `<button data-tab="${id}" class="${id === tab ? "on" : ""}">${esc(label)}</button>`)
         .join("")}</div>
       <div class="inv-body">${body}</div>`,
      [
        { label: "Back", primary: true, detail: `or ${v.closeKey}`, action: opts.onClose },
        ...(tab === "gear" ? [{ label: "Use Medkit", disabled: !canHeal, action: opts.onHeal }] : []),
      ],
      false,
      true,
      "inventory"
    );
    this.root.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onUiSound?.();
        this.inventory(view, opts, b.dataset.tab as InventoryTab);
      })
    );
    this.root.querySelectorAll<HTMLButtonElement>("button[data-note]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.inventory(view, opts, "journal", Number(b.dataset.note));
      })
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape" && !opts.closeCodes.includes(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      opts.onClose();
    };
    // Next tick: the key press that opened the inventory mustn't also close it.
    const t = window.setTimeout(() => window.addEventListener("keydown", onKey, true));
    this.teardown = () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
    };
  }

  /** `runOver` names the one-life mode that just ended, if it did. */
  death(stats: RunStats, items: MenuItem[], runOver: string | null): void {
    const tag = runOver ? `${esc(runOver.toUpperCase())} · THE RUN IS OVER` : "THE DARK GOT THERE FIRST";
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

  // ------------------------------------------------------------------ co-op

  /** A co-op screen: title, a line of status, optionally the room code in big letters. */
  lobby(title: string, tag: string, text: string, items: MenuItem[], code?: string): void {
    this.render(
      `<h2>${esc(title)}</h2><div class="tag">${esc(tag)}</div>${
        code ? `<div class="room-code" aria-label="Room code">${[...code].map((c) => `<b>${esc(c)}</b>`).join("")}</div>` : ""
      }<div class="sub">${esc(text)}</div>`,
      items,
      true
    );
  }

  /** Who you play: the three survivors, the current one first in focus. */
  character(current: CharacterLook, onPick: (look: CharacterLook) => void, back: () => void): void {
    this.render(
      `<h2>WHO ARE YOU?</h2><div class="tag">THREE OF THE FORTY-ONE ARE STILL BREATHING</div>`,
      [
        ...LOOK_ORDER.map((id) => ({
          label: fullName(id),
          detail: LOOKS[id].bio,
          primary: id === current,
          action: () => onPick(id),
        })),
        { label: "Back", action: back },
      ],
      true
    );
  }

  /** Cloud sync, and moving progress with a save file. */
  saves(tag: string, text: string, items: MenuItem[]): void {
    this.render(`<h2>SAVES</h2><div class="tag">${esc(tag)}</div><div class="sub">${esc(text)}</div>`, items, true, false, "saves");
  }

  /** The online leaderboard: one row per level, the top three and where you stand. */
  leaderboard(tag: string, rows: BoardRow[] | null, note: string, items: MenuItem[]): void {
    const body = rows
      ? `<table class="board"><thead><tr><th>LEVEL</th><th>1ST</th><th>2ND</th><th>3RD</th><th>YOU</th></tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr><td>${esc(r.level)}</td>${[0, 1, 2]
                .map((i) => {
                  const t = r.top[i];
                  return t
                    ? `<td class="${t.me ? "me" : ""}">${esc(t.name)}<small>${formatTime(t.time)}</small></td>`
                    : `<td class="dim">—</td>`;
                })
                .join(
                  ""
                )}<td class="${r.mine ? "me" : "dim"}">${r.mine ? `#${r.mine.rank}<small>${formatTime(r.mine.time)}</small>` : "—"}</td></tr>`
          )
          .join("")}</tbody></table>`
      : "";
    this.render(
      `<h2>LEADERBOARD</h2><div class="tag">${esc(tag)}</div>${body}${note ? `<div class="sub">${esc(note)}</div>` : ""}`,
      items,
      true,
      true,
      "leaderboard"
    );
  }

  /** Whether the screen showing is the given one (for screens that refresh themselves). */
  showing(variant: string): boolean {
    return this.visible && this.root.classList.contains(variant);
  }

  /** Type in a partner's room code. */
  joinForm(onJoin: (code: string) => void, back: () => void, error = "", value = ""): void {
    this.render(
      `<h2>JOIN A GAME</h2><div class="tag">ENTER THE CODE YOUR PARTNER SEES</div>
       <input class="code-input" maxlength="7" autocomplete="off" spellcheck="false" placeholder="•••••" value="${esc(value)}">
       <div class="sub err">${esc(error)}</div>`,
      [
        { label: "Join", primary: true, action: () => onJoin(input.value) },
        { label: "Back", action: back },
      ],
      true
    );
    const input = this.root.querySelector<HTMLInputElement>(".code-input")!;
    input.addEventListener("input", () => (input.value = input.value.toUpperCase()));
    // Keys typed here are for the code, not the game.
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") onJoin(input.value);
      if (e.key === "Escape") back();
    });
    input.focus();
  }

  private statsHtml(s: RunStats): string {
    return `<div class="stats">
      <span>TIME</span><span>${formatTime(s.time)}</span>
      <span>KILLS</span><span>${s.kills}</span>
      <span>ACCURACY</span><span>${Math.round(accuracy(s) * 100)}%</span>
      <span>HEADSHOTS</span><span>${s.headshots}</span>
      <span>TAKEDOWNS</span><span>${s.takedowns}</span>
      <span>DAMAGE TAKEN</span><span>${Math.round(s.damageTaken)}</span>
      ${s.secrets > 0 ? `<span>SECRETS FOUND</span><span>${s.secrets}</span>` : ""}
    </div>`;
  }

  // ------------------------------------------------------------------ options

  settings(settings: Settings, onChange: (s: Settings) => void, back: () => void): void {
    const slider = (label: string, key: NumericKey, min: number, max: number, step: number) =>
      `<label>${label} <input type="range" min="${min}" max="${max}" step="${step}" data-s="${key}"><output></output></label>`;
    const toggle = (label: string, key: ToggleKey) => `<label>${label} <input type="checkbox" data-s="${key}"></label>`;
    const cycle = (label: string, key: CycleKey) => `<label>${label} <button class="cycle" data-c="${key}"></button></label>`;
    this.render(
      `<h2>SETTINGS</h2>
       <div class="panel">
         <section>
           <div class="group">CONTROLS</div>
           ${slider("MOUSE SENSITIVITY", "sensitivity", 0.2, 3, 0.05)}
           ${slider("GAMEPAD LOOK SPEED", "padSensitivity", 0.2, 3, 0.05)}
           ${toggle("INVERT LOOK Y", "invertY")}
           <div class="group">CHARACTER</div>
           ${cycle("PLAYING AS", "look")}
           <div class="group">AUDIO</div>
           ${slider("VOLUME", "volume", 0, 1, 0.05)}
           ${slider("MUSIC", "musicVolume", 0, 1, 0.05)}
         </section>
         <section>
           <div class="group">DISPLAY</div>
           ${cycle("GRAPHICS QUALITY", "quality")}
           ${slider("FIELD OF VIEW", "fov", 60, 100, 1)}
           ${slider("HUD SIZE", "hudScale", 0.8, 1.4, 0.05)}
           <div class="group">ACCESSIBILITY</div>
           ${cycle("SUBTITLE SIZE", "subtitleSize")}
           ${toggle("REDUCED CAMERA SHAKE", "reducedShake")}
           ${toggle("COLOUR-BLIND FRIENDLY HUD", "colorBlind")}
         </section>
       </div>
       <div class="note-line">Graphics quality fully applies from the next level you load. The radio calls you by your character's name, and your co-op partner sees them.</div>`,
      [{ label: "Back", action: back, primary: true }],
      false,
      false,
      "settings"
    );
    const fmt = (k: NumericKey, v: number) =>
      k === "volume" || k === "musicVolume" || k === "hudScale" ? `${Math.round(v * 100)}%` : k === "fov" ? `${v}°` : `${v.toFixed(2)}×`;
    this.root.querySelectorAll<HTMLInputElement>("input[data-s]").forEach((input) => {
      const key = input.dataset.s as NumericKey | ToggleKey;
      const out = input.nextElementSibling as HTMLOutputElement | null;
      if (input.type === "checkbox") input.checked = settings[key as ToggleKey];
      else {
        input.value = String(settings[key as NumericKey]);
        if (out) out.textContent = fmt(key as NumericKey, settings[key as NumericKey]);
      }
      input.addEventListener("input", () => {
        if (input.type === "checkbox") settings[key as ToggleKey] = input.checked;
        else {
          settings[key as NumericKey] = Number(input.value);
          if (out) out.textContent = fmt(key as NumericKey, settings[key as NumericKey]);
        }
        onChange(settings);
      });
    });
    const cycles: Record<CycleKey, { values: string[]; label: (v: string) => string }> = {
      quality: { values: QUALITY_ORDER, label: (v) => QUALITY[v as keyof typeof QUALITY].name },
      subtitleSize: { values: SUBTITLE_SIZES, label: (v) => v[0].toUpperCase() + v.slice(1) },
      look: { values: LOOK_ORDER, label: (v) => fullName(v as CharacterLook) },
    };
    this.root.querySelectorAll<HTMLButtonElement>("button.cycle").forEach((btn) => {
      const key = btn.dataset.c as CycleKey;
      const c = cycles[key];
      const show = () => (btn.textContent = `‹ ${c.label(settings[key])} ›`);
      show();
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = c.values.indexOf(settings[key]);
        (settings as unknown as Record<CycleKey, string>)[key] = c.values[(i + 1) % c.values.length];
        show();
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
         <div class="group">GAMEPAD</div>
         <div class="keys">${PAD_LAYOUT.map(([what, keys]) => `<span>${esc(what)}</span><kbd>${esc(keys)}</kbd>`).join("")}</div>
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
