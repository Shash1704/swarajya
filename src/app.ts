/** Internal canvas resolution; the canvas is scaled with CSS to fit the window. */
export const VIEW_W = 1080;
export const VIEW_H = 720;

export interface Scene {
  enter?(): void;
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
  pointerDown?(x: number, y: number, button: number, e: PointerEvent): void;
  pointerMove?(x: number, y: number, e: PointerEvent): void;
  pointerUp?(x: number, y: number, button: number, e: PointerEvent): void;
  keyDown?(e: KeyboardEvent): void;
  keyUp?(e: KeyboardEvent): void;
  wheel?(x: number, y: number, deltaY: number, e: WheelEvent): void;
}

class App {
  scene: Scene | null = null;

  setScene(s: Scene) {
    this.scene = s;
    s.enter?.();
  }
}

export const app = new App();
