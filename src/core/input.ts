export class Input {
  private keys = new Set<string>();
  private justPressedKeys = new Set<string>();
  mouseDeltaX = 0;
  mouseDeltaY = 0;
  mouseDown = false;
  private mouseJustPressed = false;
  locked = false;

  constructor(private readonly domElement: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (!this.keys.has(e.code)) this.justPressedKeys.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    domElement.addEventListener("mousedown", () => {
      this.mouseDown = true;
      this.mouseJustPressed = true;
    });
    window.addEventListener("mouseup", () => (this.mouseDown = false));

    document.addEventListener("mousemove", (e) => {
      if (this.locked) {
        this.mouseDeltaX += e.movementX;
        this.mouseDeltaY += e.movementY;
      }
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === domElement;
    });
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

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  wasJustPressed(code: string): boolean {
    return this.justPressedKeys.has(code);
  }

  wasMouseJustPressed(): boolean {
    return this.mouseJustPressed;
  }

  /** Call once per frame after all systems have read input. */
  endFrame(): void {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.justPressedKeys.clear();
    this.mouseJustPressed = false;
  }
}
