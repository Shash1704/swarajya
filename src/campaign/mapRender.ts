import { CELL, MH, MW, WH, WW } from '../geo';
import { makeNoise } from '../noise';
import { FOREIGN, SEA, type MapData } from './mapgen';
import { IND, type GameState } from './state';

type RGB = [number, number, number];

const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

const DESERT: RGB = [226, 208, 164];
const GRASS: RGB = [190, 192, 140];
const JUNGLE: RGB = [132, 156, 104];
const ROCK: RGB = [168, 152, 126];
const SNOW: RGB = [244, 244, 247];
const DEEP: RGB = [104, 152, 190];
const SHALLOW: RGB = [156, 198, 218];

function terrainColor(e: number, m: number): RGB {
  let c = m < 0.5 ? lerp(DESERT, GRASS, m / 0.5) : lerp(GRASS, JUNGLE, (m - 0.5) / 0.5);
  c = lerp(c, ROCK, clamp01((e - 0.3) / 0.45) * 0.7);
  if (e > 0.78) c = lerp(c, SNOW, clamp01((e - 0.78) / 0.12));
  return c;
}

interface Chain {
  a: number;
  b: number;
  v0: number;
  v1: number;
  closed: boolean;
  /** Smoothed polyline in world pixels, flat [x0, y0, x1, y1, ...]. */
  pts: number[];
  path: Path2D;
}

export interface View {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------- curve helpers

type Pt = [number, number];

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bd = eps;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / len;
      if (d > bd) {
        bd = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function chaikin(pts: Pt[], closed: boolean): Pt[] {
  const n = pts.length;
  if (n < 3) return pts;
  const out: Pt[] = closed ? [] : [pts[0]];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Grid staircase -> soft curve: edge midpoints, simplify, then two rounds of corner cutting. */
function smoothLine(raw: Pt[], closed: boolean): Pt[] {
  const n = raw.length;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m: Pt[];
  if (closed) {
    m = raw.map((p, i) => mid(p, raw[(i + 1) % n]));
    if (m.length > 6) {
      // Split the loop in two so the simplifier has fixed ends.
      const half = Math.floor(m.length / 2);
      const a = rdp(m.slice(0, half + 1), 0.45);
      const b = rdp([...m.slice(half), m[0]], 0.45);
      m = [...a.slice(0, -1), ...b.slice(0, -1)];
    }
  } else {
    m = [raw[0]];
    for (let i = 0; i < n - 1; i++) m.push(mid(raw[i], raw[i + 1]));
    m.push(raw[n - 1]);
    m = rdp(m, 0.45);
  }
  return chaikin(chaikin(m, closed), closed);
}

// ---------------------------------------------------------------- renderer

/**
 * Paints the campaign map as vector art: soft painted terrain clipped to
 * smooth coastlines, translucent faction fills, and curved borders and rivers
 * that stay crisp at any zoom.
 */
export class MapRenderer {
  private prov: Int16Array;
  private seaImg: HTMLCanvasElement;
  private landImg: HTMLCanvasElement;
  /** Mountain and forest symbols, drawn in vector so they stay crisp at any zoom. */
  private peaks: Path2D;
  private peakShadow: Path2D;
  private trees: Path2D;
  private chains: Chain[] = [];
  private provPaths: Path2D[] = [];
  private landClip = new Path2D();
  private coastPath = new Path2D();
  private frontierPath = new Path2D();
  private innerPath = new Path2D();
  private realmPath = new Path2D();
  private rivers: { major: boolean; path: Path2D }[];
  private stripes: HTMLCanvasElement;

  constructor(map: MapData, seed: number, provinceCount: number) {
    this.prov = map.prov;
    [this.seaImg, this.landImg] = paintTerrain(map, seed);
    [this.peaks, this.peakShadow, this.trees] = reliefSymbols(map, seed);
    this.buildShapes(provinceCount);
    this.rivers = map.rivers.map((r) => {
      const path = new Path2D();
      r.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
      return { major: r.major, path };
    });
    this.stripes = document.createElement('canvas');
    this.stripes.width = this.stripes.height = 10;
    const g = this.stripes.getContext('2d')!;
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-2, 12);
    g.lineTo(12, -2);
    g.stroke();
  }

  provAt(wx: number, wy: number): number {
    const x = Math.floor(wx / CELL);
    const y = Math.floor(wy / CELL);
    if (x < 0 || y < 0 || x >= MW || y >= MH) return SEA;
    return this.prov[y * MW + x];
  }

  private buildShapes(provinceCount: number) {
    const prov = this.prov;
    const VW = MW + 1;
    const NV = VW * (MH + 1);
    // Outside the grid counts as whatever is at the edge, so the map frame never becomes a coastline.
    const R = (x: number, y: number) => prov[Math.max(0, Math.min(MH - 1, y)) * MW + Math.max(0, Math.min(MW - 1, x))];
    const ev0: number[] = [];
    const ev1: number[] = [];
    const ea: number[] = [];
    const eb: number[] = [];
    const inc = new Int32Array(NV * 4).fill(-1);
    const cnt = new Uint8Array(NV);
    const add = (v0: number, v1: number, r1: number, r2: number) => {
      const e = ev0.length;
      ev0.push(v0);
      ev1.push(v1);
      ea.push(Math.min(r1, r2));
      eb.push(Math.max(r1, r2));
      inc[v0 * 4 + cnt[v0]++] = e;
      inc[v1 * 4 + cnt[v1]++] = e;
    };
    for (let y = 0; y <= MH; y++) {
      for (let x = 0; x < MW; x++) {
        const r1 = R(x, y - 1);
        const r2 = R(x, y);
        if (r1 !== r2 && y > 0 && y < MH) add(y * VW + x, y * VW + x + 1, r1, r2);
      }
    }
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x <= MW; x++) {
        const r1 = R(x - 1, y);
        const r2 = R(x, y);
        if (r1 !== r2 && x > 0 && x < MW) add(y * VW + x, (y + 1) * VW + x, r1, r2);
      }
    }
    const E = ev0.length;
    const key = (e: number) => (ea[e] + 3) * 4096 + (eb[e] + 3);
    const isNode = (v: number) => cnt[v] !== 2 || key(inc[v * 4]) !== key(inc[v * 4 + 1]);
    const used = new Uint8Array(E);
    const walk = (start: number, first: number): number[] => {
      const verts = [start];
      let cur = start;
      let edge = first;
      for (;;) {
        used[edge] = 1;
        const nxt = ev0[edge] === cur ? ev1[edge] : ev0[edge];
        verts.push(nxt);
        if (nxt === start || isNode(nxt)) break;
        let ne = -1;
        for (let k = 0; k < cnt[nxt]; k++) {
          const c = inc[nxt * 4 + k];
          if (!used[c] && key(c) === key(edge)) {
            ne = c;
            break;
          }
        }
        if (ne < 0) break;
        cur = nxt;
        edge = ne;
      }
      return verts;
    };
    const raw: { a: number; b: number; verts: number[]; closed: boolean }[] = [];
    for (let v = 0; v < NV; v++) {
      if (!cnt[v] || !isNode(v)) continue;
      for (let k = 0; k < cnt[v]; k++) {
        const e = inc[v * 4 + k];
        if (!used[e]) raw.push({ a: ea[e], b: eb[e], verts: walk(v, e), closed: false });
      }
    }
    for (let e = 0; e < E; e++) {
      if (!used[e]) raw.push({ a: ea[e], b: eb[e], verts: walk(ev0[e], e), closed: true });
    }

    for (const r of raw) {
      let pts: Pt[] = r.verts.map((v) => [v % VW, Math.floor(v / VW)]);
      if (r.closed && pts.length > 1) pts.pop();
      pts = smoothLine(pts, r.closed);
      const flat: number[] = [];
      for (const [x, y] of pts) flat.push(x * CELL, y * CELL);
      const path = new Path2D();
      for (let i = 0; i < flat.length; i += 2) (i ? path.lineTo(flat[i], flat[i + 1]) : path.moveTo(flat[i], flat[i + 1]));
      if (r.closed) path.closePath();
      this.chains.push({ a: r.a, b: r.b, v0: r.verts[0], v1: r.verts[r.verts.length - 1], closed: r.closed, pts: flat, path });
    }

    // Region outlines (provinces and foreign land) stitched from their border chains.
    const byRegion = new Map<number, number[]>();
    this.chains.forEach((c, i) => {
      for (const r of [c.a, c.b]) {
        if (r === SEA) continue;
        if (!byRegion.has(r)) byRegion.set(r, []);
        byRegion.get(r)!.push(i);
      }
      if (c.a === SEA || c.b === SEA) this.coastPath.addPath(c.path);
      else if (c.a === FOREIGN && c.b >= 0) this.frontierPath.addPath(c.path);
    });
    for (let p = 0; p < provinceCount; p++) this.provPaths.push(new Path2D());
    for (const [region, list] of byRegion) {
      const path = new Path2D();
      const ends = new Map<number, number[]>();
      const done = new Set<number>();
      for (const i of list) {
        const c = this.chains[i];
        if (c.closed) continue;
        for (const v of [c.v0, c.v1]) {
          if (!ends.has(v)) ends.set(v, []);
          ends.get(v)!.push(i);
        }
      }
      for (const i of list) {
        if (done.has(i)) continue;
        done.add(i);
        const c = this.chains[i];
        const ring = [...c.pts];
        if (!c.closed) {
          const start = c.v0;
          let end = c.v1;
          for (let guard = 0; end !== start && guard < 10000; guard++) {
            const next = (ends.get(end) ?? []).find((j) => !done.has(j));
            if (next === undefined) break;
            done.add(next);
            const d = this.chains[next];
            if (d.v0 === end) {
              for (let k = 2; k < d.pts.length; k++) ring.push(d.pts[k]);
              end = d.v1;
            } else {
              for (let k = d.pts.length - 4; k >= 0; k -= 2) ring.push(d.pts[k], d.pts[k + 1]);
              end = d.v0;
            }
          }
        }
        for (let k = 0; k < ring.length; k += 2) (k ? path.lineTo(ring[k], ring[k + 1]) : path.moveTo(ring[k], ring[k + 1]));
        path.closePath();
      }
      this.landClip.addPath(path);
      if (region >= 0) this.provPaths[region] = path;
    }
  }

  /** Rebuilds the border classes after provinces change hands. */
  updateOwnership(state: GameState) {
    this.innerPath = new Path2D();
    this.realmPath = new Path2D();
    const owner = state.provinces.map((p) => p.owner);
    for (const c of this.chains) {
      if (c.a < 0 || c.b < 0) continue;
      (owner[c.a] === owner[c.b] ? this.innerPath : this.realmPath).addPath(c.path);
    }
  }

  draw(ctx: CanvasRenderingContext2D, state: GameState, v: View, selected: number, targets: Set<number>) {
    const z = v.z;
    const px = (n: number) => n / z; // screen pixels -> world units
    ctx.save();
    ctx.transform(z, 0, 0, z, -v.x * z, -v.y * z);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.seaImg, 0, 0, WW, WH);

    // Pale glow along every shore, as on a painted atlas.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(214,236,244,0.35)';
    ctx.lineWidth = px(22);
    ctx.stroke(this.coastPath);
    ctx.strokeStyle = 'rgba(228,244,250,0.55)';
    ctx.lineWidth = px(9);
    ctx.stroke(this.coastPath);

    ctx.save();
    ctx.clip(this.landClip);
    ctx.drawImage(this.landImg, 0, 0, WW, WH);

    // Rivers.
    const rz = Math.max(0.7, Math.min(1.6, z));
    // Realm colours, multiplied over the relief so hills and valleys show through the paint.
    const { provinces, factions } = state;
    ctx.globalCompositeOperation = 'multiply';
    for (const p of provinces) {
      const f = factions[p.owner];
      const a = f.id === IND ? 0.2 : 0.66;
      ctx.fillStyle = `rgba(${f.rgb[0]},${f.rgb[1]},${f.rgb[2]},${a})`;
      ctx.fill(this.provPaths[p.id], 'evenodd');
    }
    // A wash of light keeps the colours soft rather than muddy.
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(255,248,230,0.16)';
    ctx.fill(this.landClip);
    ctx.globalCompositeOperation = 'source-over';

    // Mountains and forests as map symbols over the paint.
    if (z >= 0.55) {
      ctx.fillStyle = 'rgba(70,50,30,0.32)';
      ctx.fill(this.peakShadow);
      ctx.strokeStyle = 'rgba(62,42,24,0.7)';
      ctx.lineWidth = px(1.1);
      ctx.stroke(this.peaks);
      ctx.fillStyle = 'rgba(36,62,30,0.4)';
      ctx.fill(this.trees);
    }
    for (const r of this.rivers) {
      ctx.strokeStyle = 'rgba(96,146,184,0.85)';
      ctx.lineWidth = px((r.major ? 1.9 : 1.1) * rz);
      ctx.stroke(r.path);
    }
    const pattern = ctx.createPattern(this.stripes, 'repeat')!;
    pattern.setTransform(new DOMMatrix().scale(1 / z));
    for (const p of provinces) {
      if (p.id === selected) {
        ctx.fillStyle = 'rgba(255,250,230,0.32)';
        ctx.fill(this.provPaths[p.id], 'evenodd');
      } else if (targets.has(p.id)) {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = pattern;
        ctx.fill(this.provPaths[p.id], 'evenodd');
        ctx.globalAlpha = 1;
      } else if (p.siege) {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#c0392b';
        ctx.fill(this.provPaths[p.id], 'evenodd');
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // Borders: faint between provinces, crisp between realms.
    ctx.strokeStyle = 'rgba(40,24,12,0.13)';
    ctx.lineWidth = px(0.7);
    ctx.stroke(this.innerPath);
    ctx.strokeStyle = 'rgba(255,246,226,0.28)';
    ctx.lineWidth = px(3);
    ctx.stroke(this.realmPath);
    ctx.strokeStyle = 'rgba(64,30,18,0.6)';
    ctx.lineWidth = px(1.2);
    ctx.stroke(this.realmPath);
    ctx.strokeStyle = 'rgba(60,45,30,0.6)';
    ctx.lineWidth = px(1.4);
    ctx.setLineDash([px(6), px(4)]);
    ctx.stroke(this.frontierPath);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(58,92,122,0.55)';
    ctx.lineWidth = px(1);
    ctx.stroke(this.coastPath);
    if (selected >= 0) {
      ctx.strokeStyle = 'rgba(255,224,140,0.95)';
      ctx.lineWidth = px(2.5);
      ctx.stroke(this.provPaths[selected]);
    }
    ctx.restore();
  }
}

/** Sea and land colour fields at cell resolution; the browser smooths them when scaled up. */
function paintTerrain(map: MapData, seed: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = MW;
    c.height = MH;
    return c;
  };
  const sea = make();
  const land = make();
  const sctx = sea.getContext('2d')!;
  const lctx = land.getContext('2d')!;
  const simg = sctx.createImageData(MW, MH);
  const limg = lctx.createImageData(MW, MH);
  const grain = makeNoise(seed + 99);
  const { elev, moist, prov } = map;
  const E = (x: number, y: number) => Math.max(0, elev[Math.max(0, Math.min(MH - 1, y)) * MW + Math.max(0, Math.min(MW - 1, x))]);
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      const g = grain(x / 2.5, y / 2.5) - 0.5;
      const t = prov[i] === SEA ? clamp01(1 + elev[i] * 1.6) : 1;
      const s = lerp(DEEP, SHALLOW, t * t);
      simg.data.set([s[0] + g * 4, s[1] + g * 4, s[2] + g * 5, 255], i * 4);
      let c = terrainColor(Math.max(0, elev[i]) + g * 0.04, moist[i]);
      const shade = (E(x - 1, y - 1) - E(x + 1, y + 1)) * 9 + (E(x - 2, y) - E(x + 2, y)) * 2.5;
      // Highlands darken a little overall so ranges stand out as masses, not just shaded edges.
      const k = 1 + Math.max(-0.5, Math.min(0.42, shade)) + g * 0.07 - clamp01((Math.max(0, elev[i]) - 0.25) * 0.6) * 0.18;
      c = [c[0] * k, c[1] * k, c[2] * k];
      if (prov[i] === FOREIGN) {
        const grey = (c[0] + c[1] + c[2]) / 3;
        c = [(c[0] * 0.45 + grey * 0.55) * 0.8, (c[1] * 0.45 + grey * 0.55) * 0.8, (c[2] * 0.45 + grey * 0.55) * 0.82];
      }
      limg.data.set([c[0], c[1], c[2], 255], i * 4);
    }
  }
  sctx.putImageData(simg, 0, 0);
  lctx.putImageData(limg, 0, 0);
  return [sea, land];
}

/**
 * Hill and mountain symbols (little peaks, shaded on their eastern face) on high
 * ground, and clumps of tree crowns in the jungles, on a jittered grid.
 */
function reliefSymbols(map: MapData, seed: number): [Path2D, Path2D, Path2D] {
  const peaks = new Path2D();
  const shadow = new Path2D();
  const trees = new Path2D();
  const { elev, moist, prov } = map;
  const jitter = makeNoise(seed + 7);
  const step = 3; // cells between symbols
  for (let cy = 1, row = 0; cy < MH - 1; cy += step, row++) {
    for (let cx = 1 + (row % 2) * 1.5; cx < MW - 1; cx += step) {
      const x0 = Math.round(cx);
      const i = cy * MW + x0;
      if (prov[i] === SEA) continue;
      const e = elev[i];
      const jx = (jitter(cx * 0.9, cy * 0.9) - 0.5) * CELL * 2;
      const jy = (jitter(cy * 0.9 + 50, cx * 0.9) - 0.5) * CELL * 2;
      const x = x0 * CELL + CELL / 2 + jx;
      const y = cy * CELL + CELL / 2 + jy;
      if (e > 0.3) {
        // Taller, wider peaks on higher ground.
        const h = 3 + Math.min(1, (e - 0.3) / 0.45) * 6;
        const w = h * 0.95;
        peaks.moveTo(x - w, y);
        peaks.lineTo(x, y - h);
        peaks.lineTo(x + w, y);
        shadow.moveTo(x, y - h);
        shadow.lineTo(x + w, y);
        shadow.lineTo(x + w * 0.15, y);
        shadow.closePath();
      } else if (moist[i] > 0.7 && e < 0.3 && jitter(cx * 2.3, cy * 2.3) > 0.45) {
        const r = 1.6;
        for (const [dx, dy] of [[-1.8, 0.6], [1.8, 0.6], [0, -1.2]]) {
          trees.moveTo(x + dx + r, y + dy);
          trees.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        }
      }
    }
  }
  return [peaks, shadow, trees];
}
