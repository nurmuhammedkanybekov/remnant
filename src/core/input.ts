/**
 * Raw device state: which keys and mouse buttons are held, what was pressed
 * this frame, and accumulated mouse movement. Mouse buttons are reported as
 * the codes `Mouse0`–`Mouse4` so they can be bound like keys, and the scroll
 * wheel as `WheelUp`/`WheelDown` presses (never "held").
 *
 * Gameplay code should not read this directly — see `buildCommand`.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  mouseDeltaX = 0;
  mouseDeltaY = 0;
  locked = false;
  /** True when the last thing the player touched was a gamepad. */
  usingPad = false;
  private padButtons: boolean[] = [];
  private padPrev: boolean[] = [];
  private padAxes: number[] = [0, 0, 0, 0];
  private simulatedPad: boolean[] | null = null;

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
    domElement.addEventListener(
      "wheel",
      (e) => {
        if (e.deltaY !== 0) this.pressed.add(e.deltaY < 0 ? "WheelUp" : "WheelDown");
        if (this.locked) e.preventDefault();
      },
      { passive: false }
    );

    // Losing focus (alt-tab) would otherwise leave keys "stuck" down.
    window.addEventListener("blur", () => this.down.clear());

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.usingPad = false;
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === domElement;
    });
  }

  private press(code: string): void {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
    this.usingPad = false;
  }

  /** Reads the first connected gamepad. Call once per frame, before anything reads input. */
  pollGamepad(): void {
    this.padPrev = this.padButtons;
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p): p is Gamepad => !!p && p.connected);
    if (!pad && !this.simulatedPad) {
      this.padButtons = [];
      this.padAxes = [0, 0, 0, 0];
      return;
    }
    this.padButtons = this.simulatedPad ?? pad!.buttons.map((b) => b.pressed || b.value > 0.5);
    this.padAxes = pad ? [0, 1, 2, 3].map((i) => pad.axes[i] ?? 0) : [0, 0, 0, 0];
    const active = this.padButtons.some(Boolean) || this.padAxes.some((a) => Math.abs(a) > 0.35);
    if (active) this.usingPad = true;
  }

  padDown(button: number): boolean {
    return this.padButtons[button] === true;
  }

  padPressed(button: number): boolean {
    return this.padButtons[button] === true && this.padPrev[button] !== true;
  }

  /** 0 left X, 1 left Y, 2 right X, 3 right Y — raw, -1..1. */
  padAxis(i: number): number {
    return this.padAxes[i] ?? 0;
  }

  /** Simulate gamepad buttons (debug/test harness only). Pass null to release the fake pad. */
  simulatePad(buttons: number[] | null): void {
    if (buttons === null) {
      this.simulatedPad = null;
      return;
    }
    const b: boolean[] = [];
    for (const i of buttons) b[i] = true;
    this.simulatedPad = b;
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
