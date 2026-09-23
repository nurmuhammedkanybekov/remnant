export class Overlay {
  private root: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subtitleEl: HTMLDivElement;
  private button: HTMLButtonElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center;
      background: radial-gradient(ellipse at center, rgba(10,10,12,0.75) 0%, rgba(0,0,0,0.94) 100%);
      color: #e6e6e6; font-family: 'Courier New', monospace; z-index: 10;
    `;

    this.titleEl = document.createElement("div");
    this.titleEl.style.cssText = "font-size: 40px; letter-spacing: 6px; margin-bottom: 14px;";
    this.root.appendChild(this.titleEl);

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.style.cssText = "font-size: 15px; max-width: 480px; line-height: 1.6; opacity: 0.8; margin-bottom: 28px; white-space: pre-line;";
    this.root.appendChild(this.subtitleEl);

    this.button = document.createElement("button");
    this.button.style.cssText = `
      font-family: inherit; font-size: 16px; letter-spacing: 2px; padding: 12px 30px;
      background: transparent; border: 1px solid #999; color: #e6e6e6; cursor: pointer;
    `;
    this.button.addEventListener("mouseenter", () => (this.button.style.background = "rgba(255,255,255,0.1)"));
    this.button.addEventListener("mouseleave", () => (this.button.style.background = "transparent"));
    this.root.appendChild(this.button);

    container.appendChild(this.root);
  }

  show(title: string, subtitle: string, buttonText: string, onClick: () => void): void {
    this.titleEl.textContent = title;
    this.subtitleEl.textContent = subtitle;
    this.button.textContent = buttonText;
    this.button.onclick = onClick;
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
