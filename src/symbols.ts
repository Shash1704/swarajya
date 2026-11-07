import { UNIT_STATS, type SymbolPart, type Tier, type UnitType } from './data';

/**
 * NATO-style unit symbols (APP-6 flavoured): a rectangular frame filled with
 * the faction colour, holding the branch marks. Infantry is a cross, cavalry
 * a single diagonal, artillery a dot, armour (elephants, armoured horse) an
 * oval. Modifiers: mountain triangle (hill infantry), spearhead (pikes and
 * lances), bow arc (archers), bar (levies/volunteers), top bar (drilled or
 * guard troops), arrow (rockets). Tier S units get a double frame.
 */

type Op =
  | { k: 'line'; pts: [number, number][] }
  | { k: 'fill'; pts: [number, number][] }
  | { k: 'oval'; cx: number; cy: number; rx: number; ry: number }
  | { k: 'dot'; cx: number; cy: number; r: number }
  | { k: 'quad'; a: [number, number]; c: [number, number]; b: [number, number] };

const PARTS: Record<SymbolPart, Op[]> = {
  cross: [{ k: 'line', pts: [[0, 0], [1, 1]] }, { k: 'line', pts: [[0, 1], [1, 0]] }],
  diag: [{ k: 'line', pts: [[0, 1], [1, 0]] }],
  oval: [{ k: 'oval', cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.27 }],
  dot: [{ k: 'dot', cx: 0.5, cy: 0.5, r: 0.14 }],
  mountain: [{ k: 'fill', pts: [[0.5, 0.7], [0.36, 1], [0.64, 1]] }],
  spearhead: [{ k: 'fill', pts: [[0.5, 0.02], [0.41, 0.26], [0.59, 0.26]] }],
  bow: [{ k: 'quad', a: [0.28, 0.3], c: [0.5, -0.06], b: [0.72, 0.3] }],
  bar: [{ k: 'line', pts: [[0.3, 0.84], [0.7, 0.84]] }],
  topbar: [{ k: 'line', pts: [[0.3, 0.14], [0.7, 0.14]] }],
  arrow: [
    { k: 'line', pts: [[0.5, 0.36], [0.5, 0.08]] },
    { k: 'line', pts: [[0.41, 0.2], [0.5, 0.08], [0.59, 0.2]] },
  ],
};

export const SYMBOL_ASPECT = 0.66;
let clipId = 0;

/** Light or dark ink, whichever reads better on the fill. */
export function inkFor(rgb: [number, number, number]): string {
  return rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11 > 165 ? '#1d160e' : '#fffaf0';
}

/** Draws a unit symbol centred on (cx, cy), `w` pixels wide. */
export function drawSymbol(
  ctx: CanvasRenderingContext2D, type: UnitType, cx: number, cy: number, w: number,
  fill: string, ink: string, frame = '#1d160e',
) {
  const st = UNIT_STATS[type];
  const h = w * SYMBOL_ASPECT;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const lw = Math.max(1, w / 15);
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(x0, y0, w, h);
  ctx.lineWidth = lw;
  ctx.strokeStyle = frame;
  ctx.strokeRect(x0, y0, w, h);
  if (st.tier === 'S') ctx.strokeRect(x0 + lw * 1.6, y0 + lw * 1.6, w - lw * 3.2, h - lw * 3.2);
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  const X = (u: number) => x0 + u * w;
  const Y = (v: number) => y0 + v * h;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const part of st.symbol) {
    for (const op of PARTS[part]) {
      ctx.beginPath();
      if (op.k === 'line' || op.k === 'fill') {
        op.pts.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))));
        if (op.k === 'fill') {
          ctx.closePath();
          ctx.fill();
        } else ctx.stroke();
      } else if (op.k === 'oval') {
        ctx.ellipse(X(op.cx), Y(op.cy), op.rx * w, op.ry * h, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (op.k === 'dot') {
        ctx.arc(X(op.cx), Y(op.cy), op.r * h * 1.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(X(op.a[0]), Y(op.a[1]));
        ctx.quadraticCurveTo(X(op.c[0]), Y(op.c[1]), X(op.b[0]), Y(op.b[1]));
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** The same symbol as an inline SVG element, for the side panels. */
export function symbolEl(type: UnitType, fill = '#d8b25a', size = 26): HTMLElement {
  const st = UNIT_STATS[type];
  const W = 30;
  const H = W * SYMBOL_ASPECT;
  const p = 1.2;
  const iw = W - p * 2;
  const ih = H - p * 2;
  const X = (u: number) => (p + u * iw).toFixed(2);
  const Y = (v: number) => (p + v * ih).toFixed(2);
  const rgbFill = fill.startsWith('#') ? [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16)) as [number, number, number] : [216, 178, 90] as [number, number, number];
  const ink = inkFor(rgbFill);
  const out: string[] = [];
  out.push(`<rect x="${p}" y="${p}" width="${iw}" height="${ih}" fill="${fill}" stroke="#1d160e" stroke-width="1.6"/>`);
  if (st.tier === 'S') out.push(`<rect x="${p + 2.2}" y="${p + 2.2}" width="${iw - 4.4}" height="${ih - 4.4}" fill="none" stroke="#1d160e" stroke-width="1.2"/>`);
  const attrs = `stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
  for (const part of st.symbol) {
    for (const op of PARTS[part]) {
      if (op.k === 'line') out.push(`<polyline points="${op.pts.map(([u, v]) => `${X(u)},${Y(v)}`).join(' ')}" fill="none" ${attrs}/>`);
      else if (op.k === 'fill') out.push(`<polygon points="${op.pts.map(([u, v]) => `${X(u)},${Y(v)}`).join(' ')}" fill="${ink}"/>`);
      else if (op.k === 'oval') out.push(`<ellipse cx="${X(op.cx)}" cy="${Y(op.cy)}" rx="${(op.rx * iw).toFixed(2)}" ry="${(op.ry * ih).toFixed(2)}" fill="none" ${attrs}/>`);
      else if (op.k === 'dot') out.push(`<circle cx="${X(op.cx)}" cy="${Y(op.cy)}" r="${(op.r * ih * 1.4).toFixed(2)}" fill="${ink}"/>`);
      else out.push(`<path d="M${X(op.a[0])} ${Y(op.a[1])} Q${X(op.c[0])} ${Y(op.c[1])} ${X(op.b[0])} ${Y(op.b[1])}" fill="none" ${attrs}/>`);
    }
  }
  const id = `symclip${clipId++}`;
  const span = document.createElement('span');
  span.className = 'sym';
  span.innerHTML = `<svg viewBox="0 0 ${W} ${H.toFixed(2)}" width="${size}" height="${(size * SYMBOL_ASPECT).toFixed(1)}" aria-hidden="true"><clipPath id="${id}"><rect x="${p}" y="${p}" width="${iw}" height="${ih}"/></clipPath>${out[0]}${out.length > 1 && st.tier === 'S' ? out[1] : ''}<g clip-path="url(#${id})">${out.slice(st.tier === 'S' ? 2 : 1).join('')}</g></svg>`;
  span.title = st.name;
  return span;
}

export function tierBadge(t: Tier): HTMLElement {
  const s = document.createElement('span');
  s.className = `tier tier-${t}`;
  s.textContent = t;
  s.title = `Tier ${t}`;
  return s;
}
