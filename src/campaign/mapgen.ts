import { fbm, makeNoise } from '../noise';
import { CELL, cellToLonLat, KX, LAT0, LON0, MH, MW, PX_PER_DEG, type LL } from '../geo';
import { CEYLON, GHATS, INLAND_SEAS, LANDS, MOISTURE, PLATEAUS, PLAYABLES, PROVINCES, RANGES, RIVERS } from '../india';

/** Cell value in MapData.prov for open sea. */
export const SEA = -1;
/** Cell value for land outside the playable subcontinent (Tibet, Burma...). */
export const FOREIGN = -2;

export interface MapData {
  /** Province id per cell, SEA or FOREIGN otherwise. */
  prov: Int16Array;
  /** Land: 0..1 height. Sea: -1..0 depth. */
  elev: Float32Array;
  /** 0 (desert) .. 1 (jungle). */
  moist: Float32Array;
  /** 1 where a river runs through the cell. */
  river: Uint8Array;
  /** River courses in world pixels, already given a natural wiggle. */
  rivers: { major: boolean; pts: [number, number][] }[];
}

export interface ProvinceShape {
  /** Settlement position in world pixels. */
  x: number;
  y: number;
  cells: number;
  neighbors: number[];
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
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

const toCellXY = ([lon, lat]: LL): [number, number] => [((lon - LON0) * KX) / CELL, ((LAT0 - lat) * PX_PER_DEG) / CELL];

/** Scanline polygon fill on the cell grid. */
function fillPolygon(mask: Uint8Array, poly: LL[], value: number) {
  const pts = poly.map(toCellXY);
  const xs: number[] = [];
  for (let y = 0; y < MH; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > cy !== yj > cy) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(MW - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) mask[y * MW + x] = value;
    }
  }
}

const COS = Math.cos((21 * Math.PI) / 180);
/** Isotropic distance in degrees between two lon/lat points. */
const degDist = (a: number, b: number, c: number, d: number) => Math.hypot((a - c) * COS, b - d);

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = (bx - ax) * COS;
  const vy = by - ay;
  const wx = (px - ax) * COS;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  return Math.hypot(wx - vx * t, wy - vy * t);
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Longitude of the Western Ghats crest at a latitude (for the wet Konkan strip). */
function ghatsLon(lat: number): number {
  for (let i = 1; i < GHATS.length; i++) {
    const [lo0, la0] = GHATS[i - 1];
    const [lo1, la1] = GHATS[i];
    if (lat <= la0 && lat >= la1) return lo0 + ((lat - la0) / (la1 - la0)) * (lo1 - lo0);
  }
  return -Infinity;
}

/** Wiggles a river polyline and converts it to world pixels. */
function riverCourse(pts: LL[], noise: (x: number, y: number) => number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = degDist(ax, ay, bx, by);
    const steps = Math.max(2, Math.ceil(len / 0.05));
    const nx = -(by - ay) / (len || 1);
    const ny = ((bx - ax) * COS) / (len || 1);
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      const lon = ax + (bx - ax) * t;
      const lat = ay + (by - ay) * t;
      // Keep the endpoints pinned so tributaries still meet their rivers.
      const pin = Math.min(1, Math.min(i - 1 + t, pts.length - 1 - (i - 1 + t)) * 2);
      const off = (fbm(noise, lon * 3, lat * 3, 3) - 0.5) * 0.35 * pin;
      out.push([(lon + (nx * off) / COS - LON0) * KX, (LAT0 - (lat + ny * off)) * PX_PER_DEG]);
    }
  }
  return out;
}

/**
 * Rasterises the hand-made geography into a cell grid, then grows the
 * provinces outward from their real settlement positions with a noisy
 * Dijkstra flood so borders follow ridges and rivers.
 */
export function generateMap(seed: number): { map: MapData; shapes: ProvinceShape[] } {
  const N = MW * MH;
  const nWarpX = makeNoise(seed * 3 + 11);
  const nWarpY = makeNoise(seed * 5 + 17);
  const nElev = makeNoise(seed * 7 + 1);
  const nMoist = makeNoise(seed * 11 + 3);
  const nCost = makeNoise(seed * 13 + 5);
  const nRiver = makeNoise(seed * 17 + 9);

  // --- Land and playable masks, with a noise warp so coasts aren't straight lines.
  const landRaw = new Uint8Array(N);
  for (const poly of LANDS) fillPolygon(landRaw, poly, 1);
  fillPolygon(landRaw, CEYLON, 1);
  for (const poly of INLAND_SEAS) fillPolygon(landRaw, poly, 0);
  const playRaw = new Uint8Array(N);
  for (const poly of PLAYABLES) fillPolygon(playRaw, poly, 1);
  const prov = new Int16Array(N);
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const wx = (fbm(nWarpX, x / 16, y / 16, 3) - 0.5) * 9;
      const wy = (fbm(nWarpY, x / 16, y / 16, 3) - 0.5) * 9;
      const sx = Math.max(0, Math.min(MW - 1, Math.round(x + wx)));
      const sy = Math.max(0, Math.min(MH - 1, Math.round(y + wy)));
      const j = sy * MW + sx;
      const i = y * MW + x;
      prov[i] = !landRaw[j] ? SEA : playRaw[j] ? 0 : FOREIGN;
    }
  }

  // --- Elevation and moisture from ranges, plateaus and rainfall blobs.
  const elev = new Float32Array(N);
  const moist = new Float32Array(N);
  // Every ridge segment with its box (grown by the range's width), so each row checks only those that cross it.
  const segs = RANGES.flatMap((r) => r.pts.slice(1).map((b, k) => {
    const a = r.pts[k];
    return { ax: a[0], ay: a[1], bx: b[0], by: b[1], w: r.w, h: r.h,
      x0: Math.min(a[0], b[0]) - r.w * 1.2, x1: Math.max(a[0], b[0]) + r.w * 1.2, y0: Math.min(a[1], b[1]) - r.w, y1: Math.max(a[1], b[1]) + r.w };
  }));
  for (let y = 0; y < MH; y++) {
    const rowLat = cellToLonLat(0.5, y + 0.5)[1];
    const rowSegs = segs.filter((s) => rowLat >= s.y0 && rowLat <= s.y1);
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      const [lon, lat] = cellToLonLat(x + 0.5, y + 0.5);
      let ridge = 0;
      for (const s of rowSegs) {
        if (lon < s.x0 || lon > s.x1) continue;
        const d = segDist(lon, lat, s.ax, s.ay, s.bx, s.by);
        if (d < s.w) ridge = Math.max(ridge, s.h * smooth(1 - d / s.w));
      }
      let plateau = 0;
      for (const b of PLATEAUS) {
        if (Math.abs(lat - b.c[1]) > b.r || Math.abs(lon - b.c[0]) * COS > b.r) continue;
        const d = degDist(lon, lat, b.c[0], b.c[1]);
        if (d < b.r) plateau += b.v * smooth(1 - (d / b.r) ** 2);
      }
      const n = fbm(nElev, x / 22, y / 22, 4);
      elev[i] = Math.max(0, Math.min(1, 0.04 + ridge * (0.75 + 0.5 * n) + plateau + (n - 0.5) * 0.08));

      let m = 0.5;
      for (const b of MOISTURE) {
        if (Math.abs(lat - b.c[1]) > b.r || Math.abs(lon - b.c[0]) * COS > b.r) continue;
        const d = degDist(lon, lat, b.c[0], b.c[1]);
        if (d < b.r) m += b.v * smooth(1 - (d / b.r) ** 2);
      }
      if (lat < 21.2 && lat > 8 && lon < ghatsLon(lat)) m += 0.35;
      m += (fbm(nMoist, x / 30, y / 30, 3) - 0.5) * 0.2;
      moist[i] = Math.max(0, Math.min(1, m));
    }
  }

  // Sea depth from distance to the coast.
  const dist = new Int32Array(N).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < N; i++) if (prov[i] !== SEA) { dist[i] = 0; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % MW;
    const nb = [x > 0 ? i - 1 : -1, x < MW - 1 ? i + 1 : -1, i - MW, i + MW];
    for (const j of nb) {
      if (j < 0 || j >= N || dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  for (let i = 0; i < N; i++) if (prov[i] === SEA) elev[i] = -Math.min(1, dist[i] / 28);

  // --- Rivers.
  const river = new Uint8Array(N);
  const rivers = RIVERS.map((r) => ({ major: r.major, pts: riverCourse(r.pts, nRiver) }));
  for (const r of rivers) {
    for (let k = 1; k < r.pts.length; k++) {
      const [ax, ay] = r.pts[k - 1];
      const [bx, by] = r.pts[k];
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL * 0.5));
      for (let s = 0; s <= steps; s++) {
        const cx = Math.floor((ax + ((bx - ax) * s) / steps) / CELL);
        const cy = Math.floor((ay + ((by - ay) * s) / steps) / CELL);
        if (cx >= 0 && cy >= 0 && cx < MW && cy < MH) river[cy * MW + cx] = 1;
      }
    }
  }

  // --- Settlements: snap each to the nearest playable land cell.
  const isPlay = (i: number) => prov[i] === 0;
  const seeds = PROVINCES.map((p) => {
    const [fx, fy] = toCellXY(p.at);
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    for (let r = 0; r < 25; r++) {
      let best = -1;
      let bd = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
          const d = dx * dx + dy * dy;
          if (isPlay(y * MW + x) && d < bd) {
            bd = d;
            best = y * MW + x;
          }
        }
      }
      if (best >= 0) return best;
    }
    return cy * MW + cx;
  });

  // --- Grow provinces.
  for (let i = 0; i < N; i++) if (prov[i] === 0) prov[i] = -3; // unclaimed playable land
  const cost = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % MW;
    const y = (i / MW) | 0;
    cost[i] = 1 + elev[i] * 2.5 + river[i] * 7 + 2.5 * Math.max(0, fbm(nCost, x / 12, y / 12, 3) - 0.4);
  }
  const dcost = new Float64Array(N).fill(Infinity);
  const heap = new MinHeap();
  seeds.forEach((s, id) => {
    dcost[s] = 0;
    prov[s] = id;
    heap.push(0, s);
  });
  while (heap.size) {
    const i = heap.pop();
    const d = heap.key;
    if (d > dcost[i]) continue;
    const x = i % MW;
    const nb = [x > 0 ? i - 1 : -1, x < MW - 1 ? i + 1 : -1, i - MW, i + MW];
    for (const j of nb) {
      if (j < 0 || j >= N) continue;
      if (prov[j] !== -3 && dcost[j] === Infinity) continue; // sea or foreign
      const nd = d + cost[j];
      if (nd < dcost[j]) {
        dcost[j] = nd;
        prov[j] = prov[i];
        heap.push(nd, j);
      }
    }
  }
  for (let i = 0; i < N; i++) if (prov[i] === -3) prov[i] = FOREIGN; // unreachable scraps

  // --- Adjacency.
  const P = PROVINCES.length;
  const cells = new Array<number>(P).fill(0);
  const nbs = Array.from({ length: P }, () => new Set<number>());
  for (let i = 0; i < N; i++) {
    const p = prov[i];
    if (p < 0) continue;
    cells[p]++;
    const x = i % MW;
    if (x < MW - 1) {
      const q = prov[i + 1];
      if (q >= 0 && q !== p) { nbs[p].add(q); nbs[q].add(p); }
    }
    if (i + MW < N) {
      const q = prov[i + MW];
      if (q >= 0 && q !== p) { nbs[p].add(q); nbs[q].add(p); }
    }
  }

  const shapes: ProvinceShape[] = seeds.map((s, id) => ({
    x: (s % MW) * CELL + CELL / 2,
    y: ((s / MW) | 0) * CELL + CELL / 2,
    cells: cells[id],
    neighbors: [...nbs[id]],
  }));
  return { map: { prov, elev, moist, river, rivers }, shapes };
}
