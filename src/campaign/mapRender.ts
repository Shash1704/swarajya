import { CELL, MH, MW, WH, WW } from '../geo';
import { makeNoise } from '../noise';
import { FOREIGN, SEA, type MapData } from './mapgen';
import { IND, type GameState } from './state';

type RGB = [number, number, number];

const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

const DESERT: RGB = [205, 182, 128];
const GRASS: RGB = [150, 166, 96];
const JUNGLE: RGB = [78, 124, 64];
const ROCK: RGB = [136, 120, 100];
const SNOW: RGB = [242, 242, 246];
const DEEP: RGB = [26, 58, 98];
const SHALLOW: RGB = [66, 120, 160];

function terrainColor(e: number, m: number): RGB {
  let c = m < 0.5 ? lerp(DESERT, GRASS, m / 0.5) : lerp(GRASS, JUNGLE, (m - 0.5) / 0.5);
  c = lerp(c, ROCK, clamp01((e - 0.3) / 0.45) * 0.75);
  if (e > 0.78) c = lerp(c, SNOW, clamp01((e - 0.78) / 0.12));
  return c;
}

/**
 * Paints the campaign map: terrain and rivers once, then faction colours,
 * borders and highlights whenever ownership or selection changes.
 */
export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private base: Uint8ClampedArray;
  /** Province id under each world pixel (SEA / FOREIGN otherwise). */
  readonly pixProv: Int16Array;
  /** What lies across a border at this pixel: -9 nothing, else a pixProv value. */
  private pixNb: Int16Array;

  constructor(map: MapData, seed: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WW;
    this.canvas.height = WH;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

    // Terrain at cell resolution, smoothed up to world resolution by the browser.
    const small = document.createElement('canvas');
    small.width = MW;
    small.height = MH;
    const sctx = small.getContext('2d')!;
    const simg = sctx.createImageData(MW, MH);
    const grain = makeNoise(seed + 99);
    const { elev, moist, prov } = map;
    const E = (x: number, y: number) => elev[Math.max(0, Math.min(MH - 1, y)) * MW + Math.max(0, Math.min(MW - 1, x))];
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        const i = y * MW + x;
        const g = grain(x / 2.5, y / 2.5) - 0.5;
        let c: RGB;
        if (prov[i] === SEA) {
          const t = clamp01(1 + elev[i] * 1.6);
          c = lerp(DEEP, SHALLOW, t * t);
          c = [c[0] + g * 4, c[1] + g * 4, c[2] + g * 5];
        } else {
          c = terrainColor(elev[i] + g * 0.05, moist[i]);
          const shade = (E(x - 1, y - 1) - E(x + 1, y + 1)) * 3;
          const k = 1 + Math.max(-0.22, Math.min(0.22, shade)) + g * 0.06;
          c = [c[0] * k, c[1] * k, c[2] * k];
          if (prov[i] === FOREIGN) {
            const grey = (c[0] + c[1] + c[2]) / 3;
            c = [(c[0] * 0.4 + grey * 0.6) * 0.72, (c[1] * 0.4 + grey * 0.6) * 0.72, (c[2] * 0.4 + grey * 0.6) * 0.75];
          }
        }
        simg.data[i * 4] = c[0];
        simg.data[i * 4 + 1] = c[1];
        simg.data[i * 4 + 2] = c[2];
        simg.data[i * 4 + 3] = 255;
      }
    }
    sctx.putImageData(simg, 0, 0);
    const c = this.ctx;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(small, 0, 0, WW, WH);

    // Rivers.
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const r of map.rivers) {
      c.strokeStyle = 'rgba(58,108,150,0.95)';
      c.lineWidth = r.major ? 2.4 : 1.5;
      c.beginPath();
      r.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.stroke();
    }
    this.base = c.getImageData(0, 0, WW, WH).data;
    this.img = c.createImageData(WW, WH);

    // Province lookup and border detection at world resolution.
    const n = WW * WH;
    this.pixProv = new Int16Array(n);
    for (let py = 0; py < WH; py++) {
      const row = Math.min(MH - 1, (py / CELL) | 0) * MW;
      for (let px = 0; px < WW; px++) this.pixProv[py * WW + px] = prov[row + Math.min(MW - 1, (px / CELL) | 0)];
    }
    this.pixNb = new Int16Array(n).fill(-9);
    const pp = this.pixProv;
    for (let py = 0; py < WH; py++) {
      for (let px = 0; px < WW; px++) {
        const p = py * WW + px;
        const a = pp[p];
        if (px < WW - 1 && pp[p + 1] !== a) this.pixNb[p] = pp[p + 1];
        else if (py < WH - 1 && pp[p + WW] !== a) this.pixNb[p] = pp[p + WW];
        else if (px > 0 && pp[p - 1] !== a) this.pixNb[p] = pp[p - 1];
        else if (py > 0 && pp[p - WW] !== a) this.pixNb[p] = pp[p - WW];
      }
    }
  }

  provAt(wx: number, wy: number): number {
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    if (x < 0 || y < 0 || x >= WW || y >= WH) return SEA;
    return this.pixProv[y * WW + x];
  }

  composite(state: GameState, selected: number, targets: Set<number>) {
    const { provinces, factions } = state;
    const owner = provinces.map((p) => p.owner);
    const tint = factions.map((f) => f.rgb);
    const alpha = factions.map((f) => (f.id === IND ? 0.12 : 0.42));
    const besieged = provinces.map((p) => !!p.siege);
    const { base, pixProv, pixNb } = this;
    const d = this.img.data;
    for (let py = 0; py < WH; py++) {
      for (let px = 0; px < WW; px++) {
        const p = py * WW + px;
        const i = p * 4;
        let r = base[i];
        let g = base[i + 1];
        let b = base[i + 2];
        const pr = pixProv[p];
        const nb = pixNb[p];
        if (pr >= 0) {
          const o = owner[pr];
          const fc = tint[o];
          const a = alpha[o];
          r = r * (1 - a) + fc[0] * a;
          g = g * (1 - a) + fc[1] * a;
          b = b * (1 - a) + fc[2] * a;
          if (pr === selected) {
            r += 40; g += 40; b += 36;
          } else if (targets.has(pr) && (px + py) & 8) {
            r += 26; g += 26; b += 20;
          } else if (besieged[pr] && (px - py) & 4 && ((px - py) & 31) < 6) {
            r = r * 0.7 + 60; g *= 0.7; b *= 0.7;
          }
          if (nb === SEA || nb === FOREIGN) {
            r *= 0.45; g *= 0.45; b *= 0.45;
          } else if (nb >= 0) {
            if (owner[nb] !== o) {
              const k = o === IND ? 0.35 : 0.5;
              r = o === IND ? 70 : fc[0] * k;
              g = o === IND ? 66 : fc[1] * k;
              b = o === IND ? 58 : fc[2] * k;
            } else {
              r *= 0.78; g *= 0.78; b *= 0.78;
            }
          }
        } else if (pr === SEA && nb !== -9 && nb !== SEA) {
          r = r * 0.55 + 105; g = g * 0.55 + 110; b = b * 0.55 + 110;
        } else if (pr === FOREIGN && nb >= 0) {
          r *= 0.6; g *= 0.6; b *= 0.6;
        }
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}
