/**
 * Raw device state: which keys and mouse buttons are held, what was pressed
 * this frame, and accumulated mouse movement. Mouse buttons are reported as
 * the codes `Mouse0`–`Mouse4` so they can be bound like keys.
 *
 * Gameplay code should not read this directly — see `buildCommand`.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  mouseDeltaX = 0;
  mouseDeltaY = 0;
  locked = false;

  constructor(private readonly domElement: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (!e.repeat) this.press(e.code);
      // Stop Space/Tab from scrolling or moving focus while playing.
      if (this.locked && (e.code === "Space" || e.code === "Tab")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));

    domElement.addEventListener("mousedown", (e) => this.press(`Mouse${e.button}`));
    window.addEventListener("mouseup", (e) => this.down.delete(`Mouse${e.button}`));
    domElement.addEventListener("contextmenu", (e) => e.preventDefault());

    // Losing focus (alt-tab) would otherwise leave keys "stuck" down.
    window.addEventListener("blur", () => this.down.clear());

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === domElement;
    });
  }

  private press(code: string): void {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  }

  requestLock(): void {
    // requestPointerLock() returns a Promise in modern Chromium; it can
    // reject (e.g. document not focused) and would otherwise surface as
    // an unhandled rejection in the console.
    const result = this.domElement.requestPointerLock() as unknown;
    if (result instanceof Promise) {
      result.catch(() => {
        /* pointer lock denied (focus lost, rapid re-request, etc.) — the
           pointerlockchange listener already keeps state in sync */
      });
    }
  }

  exitLock(): void {
    document.exitPointerLock();
  }

  isDown(code: string | null): boolean {
    return code !== null && this.down.has(code);
  }

  wasPressed(code: string | null): boolean {
    return code !== null && this.pressed.has(code);
  }

  /** Simulate a held key or button (debug/test harness only). */
  simulateDown(code: string, held: boolean): void {
    if (held) this.press(code);
    else this.down.delete(code);
  }

  /** Call once per frame after all systems have read input. */
  endFrame(): void {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.pressed.clear();
  }
}
