export type Noise2 = (x: number, y: number) => number;

/** 2D value noise in [0, 1], deterministic for a given seed. */
export function makeNoise(seed: number): Noise2 {
  const s = seed | 0;
  const hash = (ix: number, iy: number) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sy;
  };
}

/** Fractal (multi-octave) noise, normalised to roughly [0, 1]. */
export function fbm(n: Noise2, x: number, y: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(x * freq + o * 17.3, y * freq + o * 9.1);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
