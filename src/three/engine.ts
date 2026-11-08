import { Engine } from '@babylonjs/core/Engines/engine';

/** One WebGL engine on the #view3d canvas, shared by the campaign map and the battlefield. */
let engine: Engine | null = null;

export function engineFor(canvas: HTMLCanvasElement): Engine {
  if (!engine || engine.getRenderingCanvas() !== canvas) {
    engine?.dispose();
    engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, antialias: true }, true);
  }
  return engine;
}
