export class Hud {
  private root: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private staminaFill: HTMLDivElement;
  private batteryFill: HTMLDivElement;
  private ammoText: HTMLDivElement;
  private objectiveText: HTMLDivElement;
  private vignette: HTMLDivElement;
  private noteBox: HTMLDivElement;
  private noteTimeout: number | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: absolute; inset: 0; pointer-events: none;
      color: #d9d9d9; text-shadow: 0 1px 2px rgba(0,0,0,0.9);
      font-size: 14px; user-select: none;
    `;
    container.appendChild(this.root);

    this.vignette = div(this.root, `
      position: absolute; inset: 0; pointer-events: none;
      box-shadow: inset 0 0 0px 0px rgba(180,0,0,0);
      transition: box-shadow 0.3s ease;
    `);

    const crosshair = div(this.root, `
      position: absolute; left: 50%; top: 50%; width: 6px; height: 6px;
      margin: -3px 0 0 -3px; border-radius: 50%;
      background: rgba(255,255,255,0.85);
    `);
    void crosshair;

    const bottomLeft = div(this.root, `
      position: absolute; left: 24px; bottom: 22px; width: 200px;
    `);
    label(bottomLeft, "HEALTH");
    const healthBar = bar(bottomLeft);
    this.healthFill = fill(healthBar, "#c23c3c");
    label(bottomLeft, "STAMINA");
    const staminaBar = bar(bottomLeft);
    this.staminaFill = fill(staminaBar, "#5aa25a");
    label(bottomLeft, "FLASHLIGHT");
    const batteryBar = bar(bottomLeft);
    this.batteryFill = fill(batteryBar, "#dfd070");

    this.ammoText = div(this.root, `
      position: absolute; right: 24px; bottom: 22px;
      font-size: 26px; font-weight: bold; letter-spacing: 1px;
    `);

    this.objectiveText = div(this.root, `
      position: absolute; left: 24px; top: 20px; font-size: 13px;
      max-width: 320px; opacity: 0.85;
    `);

    this.noteBox = div(this.root, `
      position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%);
      max-width: 460px; text-align: center; font-style: italic;
      background: rgba(0,0,0,0.55); padding: 10px 16px; border-radius: 4px;
      opacity: 0; transition: opacity 0.4s ease;
    `);
  }

  setHealth(pct: number): void {
    this.healthFill.style.width = `${Math.max(0, pct) * 100}%`;
    this.vignette.style.boxShadow =
      pct < 0.3 ? "inset 0 0 140px 40px rgba(180,0,0,0.5)" : "inset 0 0 0px 0px rgba(180,0,0,0)";
  }

  setStamina(pct: number): void {
    this.staminaFill.style.width = `${Math.max(0, pct) * 100}%`;
  }

  setBattery(pct: number): void {
    this.batteryFill.style.width = `${Math.max(0, pct) * 100}%`;
  }

  setAmmo(inMag: number, reserve: number, reloading: boolean): void {
    this.ammoText.textContent = reloading ? "RELOADING…" : `${inMag} / ${reserve}`;
  }

  setObjective(text: string): void {
    this.objectiveText.textContent = text;
  }

  flashDamage(): void {
    this.vignette.style.boxShadow = "inset 0 0 200px 60px rgba(200,0,0,0.65)";
    window.setTimeout(() => this.vignette.style.boxShadow = "inset 0 0 0px 0px rgba(180,0,0,0)", 200);
  }

  showNote(text: string): void {
    if (this.noteTimeout) window.clearTimeout(this.noteTimeout);
    this.noteBox.textContent = text;
    this.noteBox.style.opacity = "1";
    this.noteTimeout = window.setTimeout(() => (this.noteBox.style.opacity = "0"), 5500);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? "block" : "none";
  }
}

function div(parent: HTMLElement, css: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = css;
  parent.appendChild(el);
  return el;
}

function label(parent: HTMLElement, text: string): void {
  const el = div(parent, "font-size: 10px; letter-spacing: 2px; opacity: 0.7; margin-top: 6px;");
  el.textContent = text;
}

function bar(parent: HTMLElement): HTMLDivElement {
  return div(parent, `
    width: 100%; height: 8px; background: rgba(255,255,255,0.12);
    border-radius: 4px; overflow: hidden; margin-top: 2px;
  `);
}

function fill(parent: HTMLElement, color: string): HTMLDivElement {
  return div(parent, `width: 100%; height: 100%; background: ${color}; transition: width 0.15s ease;`);
}
