import { CELL, MH, MW } from '../geo';
import type { MapData } from './mapgen';

/**
 * Free movement over land: armies march straight across country to wherever
 * they're sent, going round the sea and preferring valleys to mountain ridges.
 * A* over a coarse grid of map cells, then the path is pulled straight so it
 * runs in long direct legs.
 */

export interface Pt { x: number; y: number }

/** Grid cells per pathfinding node (2 cells = 6 world px). */
const K = 2;
const GW = Math.ceil(MW / K);
const GH = Math.ceil(MH / K);

interface Grid {
  /** Movement cost of each node: 0 = impassable (sea, foreign land). */
  cost: Float32Array;
  map: MapData;
}

let cached: Grid | null = null;

function grid(map: MapData): Grid {
  if (cached?.map === map) return cached;
  const cost = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const cx = Math.min(MW - 1, gx * K + 1);
      const cy = Math.min(MH - 1, gy * K + 1);
      const i = cy * MW + cx;
      if (map.prov[i] < 0) continue;
      // Hills and mountains are slow, hard going: armies go round by the passes where they can.
      const e = map.elev[i];
      cost[gy * GW + gx] = 1 + Math.max(0, e - 0.3) * 4;
    }
  }
  cached = { cost, map };
  return cached;
}

/** Is this world point on playable land? */
export function onLand(map: MapData, p: Pt): boolean {
  const cx = Math.floor(p.x / CELL);
  const cy = Math.floor(p.y / CELL);
  if (cx < 0 || cy < 0 || cx >= MW || cy >= MH) return false;
  return map.prov[cy * MW + cx] >= 0;
}

/** Can an army walk straight from a to b without wetting its feet? */
function clear(map: MapData, a: Pt, b: Pt): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.ceil(d / 2);
  for (let k = 1; k < n; k++) {
    if (!onLand(map, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })) return false;
  }
  return true;
}

const toNode = (p: Pt) => {
  const gx = Math.max(0, Math.min(GW - 1, Math.floor(p.x / (CELL * K))));
  const gy = Math.max(0, Math.min(GH - 1, Math.floor(p.y / (CELL * K))));
  return gy * GW + gx;
};
const nodePt = (n: number): Pt => ({ x: ((n % GW) + 0.5) * CELL * K, y: (Math.floor(n / GW) + 0.5) * CELL * K });

/** The nearest walkable node to n (searching outward), for points on a coast or a river mouth. */
function nearestLand(g: Grid, n: number): number {
  if (g.cost[n] > 0) return n;
  const x0 = n % GW;
  const y0 = Math.floor(n / GW);
  for (let r = 1; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x >= 0 && y >= 0 && x < GW && y < GH && g.cost[y * GW + x] > 0) return y * GW + x;
      }
    }
  }
  return -1;
}

/** Binary min-heap of node ids keyed by f-score. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        let mk = lastKey;
        if (l < ids.length && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < ids.length && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m];
        keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

// Double precision: on a large map, single-precision costs round so a path can seem to improve on itself forever.
const gScore = new Float64Array(GW * GH);
const prev = new Int32Array(GW * GH);
const stamp = new Uint32Array(GW * GH);
let epoch = 0;

/**
 * Waypoints (not including the start) for a march from `from` to `to` over land,
 * or null if there is no way there. A clear straight line is taken as is.
 */
export function findPath(map: MapData, from: Pt, to: Pt): Pt[] | null {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1) return [];
  if (onLand(map, to) && clear(map, from, to) && !crossesHighland(map, from, to)) return [to];
  const g = grid(map);
  const s = nearestLand(g, toNode(from));
  const t = nearestLand(g, toNode(to));
  if (s < 0 || t < 0) return null;
  epoch++;
  const tx = t % GW;
  const ty = Math.floor(t / GW);
  const h = (n: number) => {
    const dx = Math.abs((n % GW) - tx);
    const dy = Math.abs(Math.floor(n / GW) - ty);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  const open = new Heap();
  stamp[s] = epoch;
  gScore[s] = 0;
  prev[s] = -1;
  open.push(s, h(s));
  let found = false;
  while (open.size) {
    const n = open.pop();
    if (n === t) {
      found = true;
      break;
    }
    const x = n % GW;
    const y = Math.floor(n / GW);
    const gn = gScore[n];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const m = ny * GW + nx;
        const c = g.cost[m];
        if (c <= 0) continue;
        const step = (dx && dy ? 1.414 : 1) * (c + g.cost[n]) * 0.5;
        const ng = gn + step;
        if (stamp[m] === epoch && ng >= gScore[m] - 1e-9) continue;
        stamp[m] = epoch;
        gScore[m] = ng;
        prev[m] = n;
        open.push(m, ng + h(m));
      }
    }
  }
  if (!found) return null;
  const nodes: Pt[] = [];
  for (let n = t; n >= 0 && n !== s; n = prev[n]) nodes.unshift(nodePt(n));
  // Always finish exactly on the target (a coastal town may sit on a sea-edge cell).
  nodes.push(to);
  return straighten(map, from, nodes);
}

/** Does a straight line run over high mountains a road would go round? */
function crossesHighland(map: MapData, a: Pt, b: Pt): boolean {
  const at = (p: Pt) => map.elev[Math.max(0, Math.min(MH - 1, Math.floor(p.y / CELL))) * MW + Math.max(0, Math.min(MW - 1, Math.floor(p.x / CELL)))];
  // Ridges higher than both ends (and genuinely high) are worth going round.
  const limit = Math.max(0.5, at(a) + 0.12, at(b) + 0.12);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.ceil(d / 6);
  for (let k = 1; k < n; k++) {
    if (at({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }) > limit) return true;
  }
  return false;
}

/** String-pulling: skip waypoints whenever the next-but-one can be reached in a straight, dry line. */
function straighten(map: MapData, from: Pt, pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  let at = from;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !(clear(map, at, pts[j]) && !crossesHighland(map, at, pts[j]))) j--;
    out.push(pts[j]);
    at = pts[j];
    i = j + 1;
  }
  return out;
}
