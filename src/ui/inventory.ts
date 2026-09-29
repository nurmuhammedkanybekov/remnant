/**
 * The inventory: what Nur is carrying, the notes found so far, and what's
 * been said on the radio this level. Plain data in, HTML out — `Screens`
 * shows it and `Game` fills it from the session and the save.
 */
export interface InventoryWeapon {
  name: string;
  slot: number;
  owned: boolean;
  inHand: boolean;
  mag: number;
  magSize: number;
  reserve: number;
  reserveMax: number;
}

export interface InventoryNote {
  /** Where it was found: "Sublevel 10 · Infirmary". */
  place: string;
  text: string;
  /** Picked up on this level. */
  fresh: boolean;
}

export interface InventoryView {
  /** "Sublevel 10 · Infirmary" */
  place: string;
  objective: string;
  difficulty: string;
  health: number;
  maxHealth: number;
  battery: number;
  maxBattery: number;
  medkits: number;
  maxMedkits: number;
  throwables: number;
  maxThrowables: number;
  keycard: boolean;
  weapons: InventoryWeapon[];
  notes: InventoryNote[];
  radio: { who: string; speaker: string; text: string }[];
  /** Key labels for hints. */
  healKey: string;
  throwKey: string;
  closeKey: string;
  /** Online: the world keeps going while the inventory is open. */
  live: boolean;
}

export type InventoryTab = "gear" | "journal" | "radio";

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** A note's headline: its first sentence, shortened. */
export function noteTitle(text: string): string {
  const first = text.split(/(?<=[.!?])\s/)[0].trim();
  return first.length > 46 ? `${first.slice(0, 44).trimEnd()}…` : first;
}

function bar(value: number, max: number, cls: string): string {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return `<span class="inv-bar ${cls}"><b style="width:${pct.toFixed(1)}%"></b></span>`;
}

export function gearHtml(v: InventoryView): string {
  const healthLow = v.health / v.maxHealth < 0.35;
  const medkits = Array.from({ length: v.maxMedkits }, (_, i) => `<i class="${i < v.medkits ? "on" : ""}"></i>`).join("");
  const weapons = v.weapons
    .map((w) =>
      w.owned
        ? `<div class="inv-weapon${w.inHand ? " hand" : ""}">
             <span class="slot">${w.slot}</span>
             <span class="wname">${esc(w.name)}${w.inHand ? `<em>IN HAND</em>` : ""}</span>
             <span class="wammo"><b class="${w.mag + w.reserve === 0 ? "empty" : ""}">${w.mag}</b>/${w.magSize}
               <small>+ ${w.reserve} reserve</small></span>
           </div>`
        : `<div class="inv-weapon missing"><span class="slot">${w.slot}</span><span class="wname">Not found yet</span><span class="wammo">—</span></div>`
    )
    .join("");
  return `
    <div class="inv-grid">
      <section>
        <h3>CONDITION</h3>
        <div class="inv-row"><span>Health</span>${bar(v.health, v.maxHealth, healthLow ? "hp low" : "hp")}<b>${Math.ceil(v.health)}</b></div>
        <div class="inv-row"><span>Flashlight</span>${bar(v.battery, v.maxBattery, "bat")}<b>${Math.round((v.battery / v.maxBattery) * 100)}%</b></div>
        <div class="inv-row"><span>Medkits</span><span class="inv-kits">${medkits}</span><b>${v.medkits}/${v.maxMedkits}</b></div>
        <div class="inv-hint">${
          v.medkits > 0
            ? v.health >= v.maxHealth
              ? "At full health — save the medkits."
              : `Press ${esc(v.healKey)} in the field, or use one now.`
            : "No medkits. Look for the red crosses."
        }</div>
        <div class="inv-row"><span>Bottles</span><span class="inv-kits bottles">${Array.from(
          { length: v.maxThrowables },
          (_, i) => `<i class="${i < v.throwables ? "on" : ""}"></i>`
        ).join("")}</span><b>${v.throwables}/${v.maxThrowables}</b></div>
        <div class="inv-hint">${
          v.throwables > 0
            ? `Press ${esc(v.throwKey)} to throw one. Where it breaks, they go to look.`
            : "Nothing to throw. Bottles lie about the levels."
        }</div>
        <h3>KEY ITEMS</h3>
        <div class="inv-row"><span>Keycard</span><b class="${v.keycard ? "ok" : "dim"}">${v.keycard ? "CARRIED" : "—"}</b></div>
        <div class="inv-row"><span>Notes found</span><b>${v.notes.length}</b></div>
      </section>
      <section>
        <h3>WEAPONS</h3>
        ${weapons}
        <h3>OBJECTIVE</h3>
        <div class="inv-obj">${esc(v.objective)}</div>
      </section>
    </div>`;
}

export function journalHtml(v: InventoryView, open: number): string {
  if (v.notes.length === 0)
    return `<div class="inv-empty">Nothing yet. Notes glow faintly where they lie — walk over one to pick it up.</div>`;
  const i = Math.max(0, Math.min(open, v.notes.length - 1));
  const list = v.notes
    .map(
      (n, k) =>
        `<button class="inv-note${k === i ? " open" : ""}" data-note="${k}">${esc(noteTitle(n.text))}<small>${esc(n.place)}${
          n.fresh ? " · new" : ""
        }</small></button>`
    )
    .join("");
  const n = v.notes[i];
  return `<div class="inv-journal"><div class="inv-notes">${list}</div>
    <article class="inv-paper"><div class="where">${esc(n.place.toUpperCase())}</div><p>${esc(n.text)}</p></article></div>`;
}

export function radioHtml(v: InventoryView): string {
  if (v.radio.length === 0) return `<div class="inv-empty">The radio has been quiet on this level.</div>`;
  return `<div class="inv-radio">${v.radio
    .map((l) => `<div class="line ${esc(l.speaker)}"><span class="who">${esc(l.who)}</span><span>${esc(l.text)}</span></div>`)
    .join("")}</div>`;
}
