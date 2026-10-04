import { RNG } from '../rng';
import { fbm, makeNoise } from '../noise';

/** Map grid size in cells; each cell is CELL x CELL screen pixels. */
export const MW = 360;
export const MH = 240;
export const CELL = 3;

export interface MapData {
  /** Province id per cell, -1 for water. */
  prov: Int16Array;
  /** Land: 0..1 height. Water: -1..0 depth (0 = coast). */
  elev: Float32Array;
}

export interface ProvinceShape {
  /** Label anchor (cell coords), placed deep inside the province. */
  lx: number;
  ly: number;
  cells: number;
  neighbors: number[];
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  /** Key of the most recently popped item. */
  key = 0;

  get size() {
    return this.k.length;
  }

  push(key: number, val: number) {
    const { k, v } = this;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }

  pop(): number {
    const { k, v } = this;
    const topK = k[0];
    const topV = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    this.key = topK;
    return topV;
  }
}

/**
 * Builds a continent from fractal noise, scatters province seeds over it, and
 * grows provinces outward with a noisy Dijkstra flood so borders look organic
 * and tend to follow high ground.
 */
export function generateMap(seed: number, target = 30): { map: MapData; shapes: ProvinceShape[] } {
  const rng = new RNG(seed);
  const nLand = makeNoise(seed * 7 + 1);
  const nCost = makeNoise(seed * 13 + 5);
  const N = MW * MH;

  // --- Continent shape: noise minus a radial falloff, cut at a percentile.
  const raw = new Float32Array(N);
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const dx = (x / MW - 0.5) * 2;
      const dy = (y / MH - 0.5) * 2;
      const d = Math.sqrt(dx * dx * 0.85 + dy * dy);
      const edge = Math.min(x, MW - 1 - x, y, MH - 1 - y);
      let v = fbm(nLand, x / 60, y / 60, 5) - d * d * 0.5;
      if (edge < 14) v -= (14 - edge) * 0.04;
      raw[y * MW + x] = v;
    }
  }
  const sorted = Float32Array.from(raw).sort();
  const T = sorted[Math.floor(N * 0.46)];
  const land = new Uint8Array(N);
  for (let i = 0; i < N; i++) land[i] = raw[i] > T ? 1 : 0;

  const forEachNb = (i: number, fn: (j: number) => void) => {
    const x = i % MW;
    const y = (i / MW) | 0;
    if (x > 0) fn(i - 1);
    if (x < MW - 1) fn(i + 1);
    if (y > 0) fn(i - MW);
    if (y < MH - 1) fn(i + MW);
  };

  // Keep only the largest landmass so every province is reachable on foot.
  const comp = new Int32Array(N).fill(-1);
  let bestC = -1;
  let bestSize = 0;
  const stack: number[] = [];
  for (let s = 0, c = 0; s < N; s++) {
    if (!land[s] || comp[s] >= 0) continue;
    let size = 0;
    comp[s] = c;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      forEachNb(i, (j) => {
        if (land[j] && comp[j] < 0) {
          comp[j] = c;
          stack.push(j);
        }
      });
    }
    if (size > bestSize) {
      bestSize = size;
      bestC = c;
    }
    c++;
  }
  for (let i = 0; i < N; i++) if (land[i] && comp[i] !== bestC) land[i] = 0;

  let max = -Infinity;
  let min = Infinity;
  for (let i = 0; i < N; i++) {
    max = Math.max(max, raw[i]);
    min = Math.min(min, raw[i]);
  }
  const elev = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    elev[i] = land[i] ? Math.max(0, (raw[i] - T) / (max - T)) : -Math.max(0.001, (T - raw[i]) / (T - min));
  }

  // --- Province seeds, spaced apart.
  const landCells: number[] = [];
  for (let i = 0; i < N; i++) if (land[i]) landCells.push(i);
  const minD = Math.sqrt(landCells.length / target) * 0.8;
  const seeds: number[] = [];
  for (let tries = 0; tries < 30000 && seeds.length < target; tries++) {
    const c = landCells[rng.int(0, landCells.length - 1)];
    const cx = c % MW;
    const cy = (c / MW) | 0;
    const ok = seeds.every((s) => (s % MW - cx) ** 2 + (((s / MW) | 0) - cy) ** 2 >= minD * minD);
    if (ok) seeds.push(c);
  }

  // --- Grow provinces with a noisy multi-source Dijkstra.
  const cost = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % MW;
    const y = (i / MW) | 0;
    cost[i] = 1 + 4 * Math.max(0, fbm(nCost, x / 14, y / 14, 3) - 0.35) + elev[i] * 2.5;
  }
  const prov = new Int16Array(N).fill(-1);
  const dist = new Float64Array(N).fill(Infinity);
  const heap = new MinHeap();
  seeds.forEach((s, i) => {
    dist[s] = 0;
    prov[s] = i;
    heap.push(0, s);
  });
  while (heap.size) {
    const i = heap.pop();
    const d = heap.key;
    if (d > dist[i]) continue;
    forEachNb(i, (j) => {
      if (!land[j]) return;
      const nd = d + cost[j];
      if (nd < dist[j]) {
        dist[j] = nd;
        prov[j] = prov[i];
        heap.push(nd, j);
      }
    });
  }

  // --- Areas, centroids and adjacency.
  const P = seeds.length;
  const cells = new Array<number>(P).fill(0);
  const sx = new Array<number>(P).fill(0);
  const sy = new Array<number>(P).fill(0);
  const nbs = Array.from({ length: P }, () => new Set<number>());
  for (let i = 0; i < N; i++) {
    const p = prov[i];
    if (p < 0) continue;
    const x = i % MW;
    const y = (i / MW) | 0;
    cells[p]++;
    sx[p] += x;
    sy[p] += y;
    if (x < MW - 1) {
      const q = prov[i + 1];
      if (q >= 0 && q !== p) { nbs[p].add(q); nbs[q].add(p); }
    }
    if (y < MH - 1) {
      const q = prov[i + MW];
      if (q >= 0 && q !== p) { nbs[p].add(q); nbs[q].add(p); }
    }
  }

  // --- Distance-to-border transform (chamfer) to place labels in the "fat" middle.
  const dt = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = prov[i];
    if (p < 0) continue;
    let boundary = false;
    const x = i % MW;
    const y = (i / MW) | 0;
    if (x === 0 || y === 0 || x === MW - 1 || y === MH - 1) boundary = true;
    else forEachNb(i, (j) => { if (prov[j] !== p) boundary = true; });
    dt[i] = boundary ? 0 : 1e6;
  }
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      if (dt[i] === 0) continue;
      let v = dt[i];
      if (x > 0) v = Math.min(v, dt[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, dt[i - MW] + 1);
        if (x > 0) v = Math.min(v, dt[i - MW - 1] + 1.414);
        if (x < MW - 1) v = Math.min(v, dt[i - MW + 1] + 1.414);
      }
      dt[i] = v;
    }
  }
  for (let y = MH - 1; y >= 0; y--) {
    for (let x = MW - 1; x >= 0; x--) {
      const i = y * MW + x;
      if (dt[i] === 0) continue;
      let v = dt[i];
      if (x < MW - 1) v = Math.min(v, dt[i + 1] + 1);
      if (y < MH - 1) {
        v = Math.min(v, dt[i + MW] + 1);
        if (x < MW - 1) v = Math.min(v, dt[i + MW + 1] + 1.414);
        if (x > 0) v = Math.min(v, dt[i + MW - 1] + 1.414);
      }
      dt[i] = v;
    }
  }
  const bestScore = new Array<number>(P).fill(-Infinity);
  const lx = new Array<number>(P).fill(0);
  const ly = new Array<number>(P).fill(0);
  for (let i = 0; i < N; i++) {
    const p = prov[i];
    if (p < 0) continue;
    const x = i % MW;
    const y = (i / MW) | 0;
    const cx = sx[p] / cells[p];
    const cy = sy[p] / cells[p];
    const score = dt[i] - 0.08 * Math.hypot(x - cx, y - cy);
    if (score > bestScore[p]) {
      bestScore[p] = score;
      lx[p] = x;
      ly[p] = y;
    }
  }

  const shapes: ProvinceShape[] = [];
  for (let p = 0; p < P; p++) {
    shapes.push({ lx: lx[p], ly: ly[p], cells: cells[p], neighbors: [...nbs[p]] });
  }
  return { map: { prov, elev }, shapes };
}
