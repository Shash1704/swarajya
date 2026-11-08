import type { Scene } from '@babylonjs/core/scene';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { makeNoise, fbm } from '../noise';

/**
 * Procedural textures, painted on canvases at load time (no image files to fetch):
 * tiling normal maps for ground grain and water ripples, and colour textures for
 * stone, brick and plaster.
 */

function tex(scene: Scene, name: string, size: number, paint: (g: CanvasRenderingContext2D, img: ImageData) => void, raw = false): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const g = t.getContext() as unknown as CanvasRenderingContext2D;
  if (raw) {
    const img = g.createImageData(size, size);
    paint(g, img);
    g.putImageData(img, 0, 0);
  } else paint(g, g.createImageData(1, 1));
  t.update(false);
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

/** A tiling normal map from a seamless height field h(u, v) on [0,1)². */
function normalMap(scene: Scene, name: string, size: number, h: (u: number, v: number) => number, strength: number): DynamicTexture {
  return tex(scene, name, size, (_g, img) => {
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = h(x / size, y / size);
    const at = (x: number, y: number) => H[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const l = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
  }, true);
}

/** Seamless noise: sample 4D-ish by blending the four wrapped corners. */
function seamless(seed: number, freq: number, oct: number) {
  const n = makeNoise(seed);
  return (u: number, v: number) => {
    const f = (a: number, b: number) => fbm(n, a * freq, b * freq, oct);
    return f(u, v) * (1 - u) * (1 - v) + f(u + 1, v) * u * (1 - v) + f(u, v + 1) * (1 - u) * v + f(u + 1, v + 1) * u * v;
  };
}

/** Grain of earth and grass for close-up ground. */
export function groundGrain(scene: Scene): DynamicTexture {
  const a = seamless(11, 9, 4);
  const b = seamless(12, 31, 2);
  return normalMap(scene, 'grain', 256, (u, v) => a(u, v) * 0.7 + b(u, v) * 0.3, 7);
}

/** Ripples for the sea. */
export function waterRipples(scene: Scene): DynamicTexture {
  const a = seamless(21, 6, 3);
  const b = seamless(22, 17, 2);
  return normalMap(scene, 'ripples', 256, (u, v) => a(u, v) + b(u, v) * 0.5, 5);
}

/** Dressed stone in courses, for fort walls and towers. */
export function stoneTexture(scene: Scene): DynamicTexture {
  return tex(scene, 'stone', 256, (g) => {
    const n = makeNoise(31);
    g.fillStyle = '#b8ab92';
    g.fillRect(0, 0, 256, 256);
    const rows = 8;
    const h = 256 / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? h : 0;
      for (let x = -off; x < 256; x += h * 2) {
        const v = n(x * 0.05, r * 0.7);
        const c = 160 + v * 50;
        g.fillStyle = `rgb(${c},${c * 0.93},${c * 0.8})`;
        g.fillRect(x + 1, r * h + 1, h * 2 - 2, h - 2);
      }
      g.fillStyle = 'rgba(70,60,45,0.55)';
      g.fillRect(0, r * h, 256, 2);
    }
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,50,40' : '240,230,210'},0.12)`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  });
}

/** Lime plaster for houses. */
export function plasterTexture(scene: Scene): DynamicTexture {
  return tex(scene, 'plaster', 128, (g) => {
    g.fillStyle = '#e8dcc0';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '120,100,70' : '255,250,235'},0.1)`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
    }
  });
}
