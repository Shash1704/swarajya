import { app, type Scene, VIEW_H, VIEW_W } from '../app';
import { bar, clear, h, hideModal, modalOpen, showModal, swatch, ui } from '../ui';
import { CELL, MW, toWorld, WH, WW } from '../geo';
import { FOREIGN_LABELS } from '../india';
import { TIER_NAMES, TIERS, UNIT_STATS, UNIT_TYPES, VET_NAMES, vetRank, wallName, type UnitType } from '../data';
import { drawSymbol, inkFor, symbolEl, tierBadge } from '../symbols';
import { MapRenderer } from './mapRender';
import { type BattleInfo, type BattleResult, type Hooks, World } from './world';
import {
  acceptsPeace, type Army, armyAtTown, armyById, armySpeed, autoResolve, autoResolveSiege, buildMarket, buildWalls,
  canBuild, type CUnit, dateLabel, declareWar, dist, eliteBlock, factionStrength, type GameState, grossIncome,
  hostile, IND, isMonsoon, log, makePeace, marketCost, MAX_UNITS, maxSupplies, maxWalls, maxWealth, netIncome,
  newGame, PLAYER, type Province, provinceIncome, provincesOf, provinceUnder, RAID_DAYS, recruit, regionOwners,
  seasonOf, setGoal, siegeEquipment, townAt, unitsMen, unitsStrength, upkeep, VICTORY_PROVINCES, wallFactor,
  wallsCost, manpowerLabel, manpowerRatio, manpowerRegen, maxManpower, levyFraction,
  generalK, generalRank, TRAITS, isCoastal, seaOf, keyFort, maxFood, recruitCost, tributeShare, type General,
} from './state';
import {
  bribe, bribeCost, build, BUILDINGS, type Building, buildShip, demandChauth, type GameEvent, generalFate, generalLine,
  giftGeneral, incite, intelOn, leaderMods, MAX_SHIPS, orderFleet, payRansom, peaceTerms, playerGenerals, propose,
  ransomPrice, roughMen, sabotage, scout, sellCaptive, SHIP_COST, sortie, SPY_COST, subsidise, SUBSIDY, supplied,
  unrestCauses, fleetTargets, cessionFor,
} from './realm';
import { BattleScene } from '../battle/scene';
import type { Terrain } from '../battle/battle';

const MAX_ZOOM = 3;
/** Game days that pass per real second at 1x speed. */
const DAYS_PER_SEC = 1;
const SPEEDS = [1, 2, 4];
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const EQUIPMENT = ['none yet', 'ladders', 'ladders and a ram'];

export class CampaignScene implements Scene {
  state: GameState;
  private world: World;
  private map: MapRenderer;
  private dirty = true;
  private cam = { x: 0, y: 0, z: 2.2 };
  private selProv = -1;
  private selArmy: Army | null = null;
  private paused = true;
  private speed = 1;
  private ptr: { x: number; y: number; button: number; dragged: boolean } | null = null;
  private mouse = { x: -1, y: -1 };
  private hoverProv = -1;
  private keys = new Set<string>();
  private peaceTried = new Map<number, number>();
  /** Where to write each realm's name: centre, slant along its lands, and length. */
  private centroids: { f: number; x: number; y: number; cells: number; angle: number; span: number }[] = [];
  /** Cached rendering of the map layer; redrawn only when the view or the realm changes. */
  private layer = document.createElement('canvas');
  private layerKey = '';
  private version = 0;
  private lastOwnerSig = '';
  /** Side panel is rebuilt only when this changes; fast-moving numbers update in place. */
  private uiSig = '';
  private live: (() => void)[] = [];
  private dateEl: HTMLElement | null = null;
  private overShown = false;
  private t = 0;

  constructor(state: GameState) {
    this.state = state;
    this.map = new MapRenderer(state.map, state.seed, state.provinces.length);
    this.world = new World(state, this.hooks());
    const cap = state.provinces.find((p) => p.capitalOf === PLAYER)!;
    this.cam.x = cap.x - VIEW_W / 2 / this.cam.z + 140;
    this.cam.y = cap.y - VIEW_H / 2 / this.cam.z - 30;
    this.clampCam();
  }

  enter() {
    this.dirty = true;
    this.renderUI(true);
  }

  // ---------------------------------------------------------------- clock

  update(dt: number) {
    this.t += dt;
    const k = this.keys;
    const pan = (600 / this.cam.z) * dt;
    if (k.has('arrowleft') || k.has('a')) this.cam.x -= pan;
    if (k.has('arrowright') || k.has('d')) this.cam.x += pan;
    if (k.has('arrowup') || k.has('w')) this.cam.y -= pan;
    if (k.has('arrowdown') || k.has('s')) this.cam.y += pan;
    if (k.size) this.clampCam();

    const s = this.state;
    if (!this.paused && !this.world.waiting && !modalOpen() && app.scene === this && !s.over) {
      this.world.tick(dt * this.speed * DAYS_PER_SEC);
    }
    if (this.selArmy && !s.armies.includes(this.selArmy)) this.selArmy = null;
    if (this.dateEl) this.dateEl.textContent = `${isMonsoon(s.day) ? '🌧 ' : ''}${dateLabel(s.day)} · Day ${Math.floor(s.day) + 1}`;
    for (const f of this.live) f();
    this.renderUI();
    if (s.over && !this.overShown && !modalOpen()) this.showOver();
  }

  private setPaused(p: boolean) {
    this.paused = p;
    this.renderUI(true);
  }

  // ---------------------------------------------------------------- camera

  private minZoom() {
    return Math.min(VIEW_W / WW, VIEW_H / WH);
  }

  private clampCam() {
    const c = this.cam;
    c.z = Math.max(this.minZoom(), Math.min(MAX_ZOOM, c.z));
    const vw = VIEW_W / c.z;
    const vh = VIEW_H / c.z;
    c.x = vw >= WW ? (WW - vw) / 2 : Math.max(0, Math.min(WW - vw, c.x));
    c.y = vh >= WH ? (WH - vh) / 2 : Math.max(0, Math.min(WH - vh, c.y));
  }

  private toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.cam.x) * this.cam.z, (wy - this.cam.y) * this.cam.z];
  }

  private toWorldPt(sx: number, sy: number): [number, number] {
    return [this.cam.x + sx / this.cam.z, this.cam.y + sy / this.cam.z];
  }

  private zoomAt(sx: number, sy: number, factor: number) {
    const [wx, wy] = this.toWorldPt(sx, sy);
    this.cam.z = Math.max(this.minZoom(), Math.min(MAX_ZOOM, this.cam.z * factor));
    this.cam.x = wx - sx / this.cam.z;
    this.cam.y = wy - sy / this.cam.z;
    this.clampCam();
  }

  private centerOn(p: { x: number; y: number }) {
    this.cam.x = p.x - VIEW_W / 2 / this.cam.z;
    this.cam.y = p.y - VIEW_H / 2 / this.cam.z;
    this.clampCam();
  }

  // ---------------------------------------------------------------- drawing

  private recompute() {
    this.map.updateOwnership(this.state);
    this.version++;
    const acc = new Map<number, { x: number; y: number; cells: number }>();
    for (const p of this.state.provinces) {
      if (p.owner === IND) continue;
      const c = acc.get(p.owner) ?? { x: 0, y: 0, cells: 0 };
      c.x += p.x * p.cells;
      c.y += p.y * p.cells;
      c.cells += p.cells;
      acc.set(p.owner, c);
    }
    // Principal axis of each realm's provinces, so its name runs along the lie of its land.
    this.centroids = [...acc].map(([f, c]) => {
      const mx = c.x / c.cells;
      const my = c.y / c.cells;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const p of this.state.provinces) {
        if (p.owner !== f) continue;
        const dx = p.x - mx;
        const dy = p.y - my;
        sxx += dx * dx * p.cells;
        syy += dy * dy * p.cells;
        sxy += dx * dy * p.cells;
      }
      sxx /= c.cells;
      syy /= c.cells;
      sxy /= c.cells;
      const angle = Math.max(-0.6, Math.min(0.6, 0.5 * Math.atan2(2 * sxy, sxx - syy)));
      const l1 = (sxx + syy) / 2 + Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
      return { f, x: mx, y: my, cells: c.cells, angle, span: Math.sqrt(l1) * 2.6 + 40 };
    });
  }

  private drawMapLayer(ctx: CanvasRenderingContext2D) {
    const os = this.state.provinces.map((p) => `${p.owner}${p.siege ? 's' : ''}`).join(',');
    if (this.dirty || os !== this.lastOwnerSig) {
      this.lastOwnerSig = os;
      this.recompute();
      this.dirty = false;
    }
    const m = ctx.getTransform();
    const w = Math.round(VIEW_W * m.a);
    const hgt = Math.round(VIEW_H * m.d);
    const c = this.cam;
    const key = `${w}x${hgt}|${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(4)}|${this.version}|${this.selProv}`;
    if (key !== this.layerKey) {
      this.layerKey = key;
      if (this.layer.width !== w || this.layer.height !== hgt) {
        this.layer.width = w;
        this.layer.height = hgt;
      }
      const g = this.layer.getContext('2d')!;
      g.setTransform(m.a, 0, 0, m.d, 0, 0);
      g.fillStyle = '#26476e';
      g.fillRect(0, 0, VIEW_W, VIEW_H);
      this.map.draw(g, this.state, c, this.selProv, new Set());
    }
    ctx.drawImage(this.layer, 0, 0, VIEW_W, VIEW_H);
  }

  draw(ctx: CanvasRenderingContext2D) {
    this.drawMapLayer(ctx);
    const { z } = this.cam;
    const s = this.state;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    ctx.font = `italic 600 ${Math.round(Math.max(11, 15 * Math.min(1.3, z)))}px "EB Garamond", Georgia, serif`;
    for (const l of FOREIGN_LABELS) {
      const [sx, sy] = this.toScreen(...toWorld(...l.at));
      ctx.fillStyle = l.sea ? 'rgba(70,110,140,0.55)' : 'rgba(90,72,50,0.5)';
      ctx.fillText(l.name.split('').join(' '), sx, sy);
    }

    // Realm names in great spaced capitals, slanted along the realm, as on a painted history map.
    if (z < 2.2) {
      ctx.save();
      ctx.globalAlpha = z < 1.6 ? 1 : (2.2 - z) / 0.6;
      for (const c of this.centroids) {
        const f = s.factions[c.f];
        const label = f.short.toUpperCase();
        const size = Math.min(64, (c.span * z) / (label.length * 0.95));
        if (size < 10) continue;
        const [sx, sy] = this.toScreen(c.x, c.y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(c.angle);
        ctx.font = `600 ${size}px Cinzel, "Trajan Pro", Georgia, serif`;
        (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(size * 0.14).toFixed(1)}px`;
        ctx.shadowColor = 'rgba(40,20,10,0.35)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = 'rgba(255,250,238,0.62)';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    for (const a of s.armies) if (a.owner === PLAYER) this.drawRoute(ctx, a, a === this.selArmy);

    const icon = Math.max(6, Math.min(14, 5 + 4 * z));
    for (const p of s.provinces) {
      const [sx, sy] = this.toScreen(p.x, p.y);
      if (sx < -40 || sy < -40 || sx > VIEW_W + 40 || sy > VIEW_H + 40) continue;
      this.drawSettlement(ctx, p, sx, sy, icon);
      const showName = z >= 1.0 || (p.capitalOf >= 0 && z >= 0.6) || p.id === this.selProv;
      if (showName) {
        const big = p.capitalOf >= 0;
        ctx.font = `${big ? 700 : 600} ${big ? 11 : 9.5}px Cinzel, Georgia, serif`;
        ctx.textAlign = 'left';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(250,244,228,0.75)';
        ctx.strokeText(p.town, sx + 5, sy + 1);
        ctx.fillStyle = 'rgba(42,29,18,0.9)';
        ctx.fillText(p.town, sx + 5, sy + 1);
        ctx.textAlign = 'center';
      }
    }

    for (const c of this.world.clashes) this.drawClash(ctx, c.x, c.y);
    for (const fl of s.fleets) this.drawFleet(ctx, fl);
    const order = [...s.armies].sort((a, b) => (a === this.selArmy ? 1 : 0) - (b === this.selArmy ? 1 : 0));
    for (const a of order) this.drawArmy(ctx, a, icon);
    this.drawTooltip(ctx);

    if (this.paused && !modalOpen()) {
      ctx.save();
      ctx.font = '700 13px Georgia, serif';
      const text = 'PAUSED · SPACE TO RESUME · RIGHT-CLICK TO ORDER THE SELECTED ARMY';
      const w = ctx.measureText(text).width + 32;
      ctx.fillStyle = 'rgba(30,22,12,0.85)';
      ctx.beginPath();
      ctx.roundRect(VIEW_W / 2 - w / 2, VIEW_H - 40, w, 28, 14);
      ctx.fill();
      ctx.fillStyle = '#f4e3b5';
      ctx.fillText(text, VIEW_W / 2, VIEW_H - 25.5);
      ctx.restore();
    }
  }

  private drawRoute(ctx: CanvasRenderingContext2D, a: Army, selected: boolean) {
    const s = this.state;
    const pts: [number, number][] = [this.toScreen(a.x, a.y)];
    for (const p of a.route) pts.push(this.toScreen(p.x, p.y));
    if (a.goal && (a.goal.kind === 'chase' || a.goal.kind === 'join')) {
      const t = armyById(s, a.goal.army);
      if (t) pts.push(this.toScreen(t.x, t.y));
    }
    if (pts.length < 2) return;
    const g = a.goal;
    const enemyEnd = g?.kind === 'chase' || g?.kind === 'siege' || g?.kind === 'raid'
      || (g?.kind === 'go' && hostile(s, PLAYER, s.provinces[g.prov].owner));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20,15,10,0.5)';
    ctx.lineWidth = selected ? 5 : 3;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    const color = enemyEnd ? 'rgba(255,120,95,0.95)' : 'rgba(255,240,200,0.95)';
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -this.t * 20;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.setLineDash([]);
    const [ex, ey] = pts[pts.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ex, ey, selected ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** A squadron: a small hull and sail in its realm's colours, offshore of its port or under way. */
  private drawFleet(ctx: CanvasRenderingContext2D, fl: GameState['fleets'][number]) {
    const s = this.state;
    const f = s.factions[fl.owner];
    const atHome = !fl.returning && (fl.mission === 'port' || fl.mission === 'patrol') && dist(fl, s.provinces[fl.home]) < 1;
    // Ships at anchor ride a little offshore (west coast to the west, east coast to the east).
    const off = atHome ? (seaOf(s.provinces[fl.home]) === 0 ? -14 : 14) : 0;
    const [x, y] = this.toScreen(fl.x + off, fl.y + 4);
    if (x < -30 || y < -30 || x > VIEW_W + 30 || y > VIEW_H + 30) return;
    const k = Math.max(0.7, Math.min(1.3, 0.5 + this.cam.z * 0.3));
    ctx.save();
    if (!atHome && fl.mission !== 'patrol' && fl.target >= 0) {
      const t = fl.returning ? s.provinces[fl.home] : s.provinces[fl.target];
      const [tx, ty] = this.toScreen(t.x, t.y);
      ctx.strokeStyle = `rgba(40,70,100,0.55)`;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.translate(x, y + Math.sin(this.t * 2 + fl.id) * 1.2);
    ctx.scale(k, k);
    ctx.fillStyle = '#4a3420';
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(9, 0);
    ctx.lineTo(6, 4);
    ctx.lineTo(-6, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4a3420';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -13);
    ctx.stroke();
    ctx.fillStyle = f.color;
    ctx.strokeStyle = 'rgba(30,18,10,0.9)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0.5, -12);
    ctx.lineTo(8, -2);
    ctx.lineTo(0.5, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1d160e';
    ctx.font = '700 9px Cinzel, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(fl.ships), -4, -6);
    ctx.restore();
  }

  private drawClash(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const [sx, sy] = this.toScreen(x, y);
    const r = 9 + Math.sin(this.t * 8) * 1.5;
    const cy = sy - 16;
    ctx.save();
    ctx.fillStyle = 'rgba(120,20,10,0.75)';
    ctx.beginPath();
    ctx.arc(sx, cy, r + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffe9b0';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx - r * 0.7, cy - r * 0.7);
    ctx.lineTo(sx + r * 0.7, cy + r * 0.7);
    ctx.moveTo(sx + r * 0.7, cy - r * 0.7);
    ctx.lineTo(sx - r * 0.7, cy + r * 0.7);
    ctx.stroke();
    ctx.restore();
  }

  /** Settlements are small ink dots, as on a historical atlas; capitals get a ring. */
  private drawSettlement(ctx: CanvasRenderingContext2D, p: Province, x: number, y: number, s: number) {
    const r = Math.max(2, Math.min(4, s * 0.28));
    ctx.save();
    ctx.fillStyle = 'rgba(42,29,18,0.92)';
    if (p.kind === 'fort') {
      ctx.fillRect(x - r, y - r, r * 2, r * 2); // forts as small squares
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (p.capitalOf >= 0) {
      ctx.strokeStyle = 'rgba(42,29,18,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p.siege) {
      ctx.strokeStyle = '#b3261e';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -this.t * 6;
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.devastated > 0) {
      ctx.font = `${Math.round(Math.max(9, s))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🔥', x - r - 6, y - r - 2);
    }
    // Chauth: a gold ring in the colour of the realm it pays.
    if (p.tribute && p.tribute.until >= this.state.day) {
      ctx.strokeStyle = '#d9b44a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = this.state.factions[p.tribute.to].color;
      ctx.beginPath();
      ctx.arc(x + r + 5, y - r - 1, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Unrest: a red mark over restless towns of yours (any at all past the point of revolt).
    if ((p.owner === PLAYER && p.unrest > 50) || p.unrest >= 80) {
      ctx.fillStyle = p.unrest >= 80 ? '#b3261e' : '#c9862e';
      ctx.font = `700 ${Math.round(Math.max(9, s))}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillText('!', x + r + 6, y + r + 3);
    }
    ctx.restore();
  }

  /** Geometry of an army's commander standard on screen: pole, banner cloth and nameplate. */
  private armyRect(a: Army, _icon: number) {
    const s = this.state;
    const [gx, gy] = this.toScreen(a.x, a.y);
    const k = Math.max(0.6, Math.min(1.1, 0.5 + this.cam.z * 0.28));
    const plate = this.cam.z >= 0.75;
    const bw = 30 * k;
    const bh = 40 * k;
    const pole = 62 * k;
    // Several armies on one spot stand side by side.
    const stack = s.armies.filter((o) => Math.abs(o.x - a.x) < 1 && Math.abs(o.y - a.y) < 1);
    const i = stack.indexOf(a);
    const sx = gx + i * (bw + 10 * k);
    const top = gy - pole;
    const plateH = plate ? 26 * k : 0;
    return { x: sx - 34 * k, y: top - plateH - 4, w: 68 * k, h: pole + plateH + 4, sx, sy: gy, gx, gy, k, bw, bh, top, plate, field: false };
  }

  private drawArmy(ctx: CanvasRenderingContext2D, a: Army, icon: number) {
    const r = this.armyRect(a, icon);
    if (r.x < -80 || r.y < -80 || r.x > VIEW_W + 80 || r.y > VIEW_H + 80) return;
    const s = this.state;
    const f = s.factions[a.owner];
    const sel = a === this.selArmy;
    const { k, bw, bh, top } = r;
    const px = r.sx;
    ctx.save();
    // Shadow on the ground and the pole.
    ctx.fillStyle = 'rgba(30,20,10,0.25)';
    ctx.beginPath();
    ctx.ellipse(px + 6 * k, r.sy, 12 * k, 4 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a3420';
    ctx.lineWidth = 3 * k;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, r.sy);
    ctx.lineTo(px, top - 6 * k);
    ctx.stroke();
    // Crossbar with finials.
    const cw = bw * 0.62 + 4 * k;
    ctx.lineWidth = 2.5 * k;
    ctx.beginPath();
    ctx.moveTo(px - cw, top);
    ctx.lineTo(px + cw, top);
    ctx.stroke();
    ctx.fillStyle = '#c9a24a';
    for (const dx of [-cw, cw]) {
      ctx.beginPath();
      ctx.arc(px + dx, top, 2.4 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    // The banner cloth: swallow-tailed, in the realm's colours.
    const bx = px - bw / 2;
    const by = top + 2 * k;
    const grad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    grad.addColorStop(0, `rgb(${Math.min(255, f.rgb[0] + 40)},${Math.min(255, f.rgb[1] + 40)},${Math.min(255, f.rgb[2] + 40)})`);
    grad.addColorStop(1, `rgb(${f.rgb[0] * 0.72},${f.rgb[1] * 0.72},${f.rgb[2] * 0.72})`);
    ctx.fillStyle = grad;
    ctx.strokeStyle = sel ? '#ffd86b' : 'rgba(30,18,10,0.9)';
    ctx.lineWidth = sel ? 2.6 : 1.2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + bw, by);
    ctx.lineTo(bx + bw, by + bh);
    ctx.lineTo(bx + bw * 0.5, by + bh * 0.78);
    ctx.lineTo(bx, by + bh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (sel) {
      ctx.shadowColor = 'rgba(255,216,107,0.8)';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // Emblem: the army's main arm, and its strength.
    const ink = inkFor(f.rgb);
    if (a.units.length) drawSymbol(ctx, mainUnit(a.units), px, by + bh * 0.3, bw * 0.62, f.color, ink, ink);
    ctx.fillStyle = ink;
    ctx.font = `700 ${Math.round(10 * k + 1)}px Cinzel, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(intelOn(s, a) ? fmt(unitsMen(a.units)) : roughMen(a), px, by + bh * 0.6);
    // Nameplate: the commander and his house.
    if (r.plate) {
      const nameFont = `700 ${(11 * k).toFixed(1)}px Cinzel, Georgia, serif`;
      const houseFont = `600 ${(8.5 * k).toFixed(1)}px Cinzel, Georgia, serif`;
      ctx.font = nameFont;
      const nw = ctx.measureText(a.general.name.toUpperCase()).width;
      ctx.font = houseFont;
      const hw = ctx.measureText(a.general.house.toUpperCase()).width;
      const w = Math.max(nw, hw) + 14 * k;
      const ph = 25 * k;
      const py = top - 6 * k - ph;
      ctx.fillStyle = '#f1e6c8';
      ctx.strokeStyle = sel ? '#c9962b' : '#3a2a18';
      ctx.lineWidth = sel ? 2 : 1.2;
      ctx.beginPath();
      ctx.rect(px - w / 2, py, w, ph);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(58,42,24,0.6)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(px - w / 2 + 4 * k, py + ph * 0.58);
      ctx.lineTo(px + w / 2 - 4 * k, py + ph * 0.58);
      ctx.stroke();
      ctx.fillStyle = '#2a1d12';
      ctx.font = nameFont;
      ctx.fillText(a.general.name.toUpperCase(), px, py + ph * 0.32);
      ctx.font = houseFont;
      ctx.fillText(a.general.house.toUpperCase(), px, py + ph * 0.78);
    }
    if (a.raidUntil > s.day) {
      ctx.font = `${Math.round(14 * k)}px sans-serif`;
      ctx.fillText('🔥', px + bw * 0.8, by + bh * 0.5 + Math.sin(this.t * 6) * 1.5);
    }
    if (s.day < a.busyUntil) {
      ctx.font = `${Math.round(16 * k)}px sans-serif`;
      ctx.fillText('⚔', px - bw * 0.9, by + bh * 0.4);
    }
    ctx.restore();
  }

  private drawTooltip(ctx: CanvasRenderingContext2D) {
    if (this.hoverProv < 0 || this.ptr?.dragged) return;
    const s = this.state;
    const p = s.provinces[this.hoverProv];
    const lines = [
      `${p.name} · ${s.factions[p.owner].short}`,
      `${p.town}: ${wallName(p.walls, p.kind, p.sea).toLowerCase()}`,
      `Garrison ${unitsMen(p.garrison)} · wealth ${p.wealth}${p.devastated ? ` (devastated ${Math.ceil(p.devastated)}d)` : ''}`,
    ];
    lines.push(`Unrest ${Math.round(p.unrest)} · ${p.faith === 'mixed' ? 'mixed faiths' : p.faith}${p.tribute && p.tribute.until >= s.day ? ` · pays chauth to the ${s.factions[p.tribute.to].short}` : ''}`);
    if (p.siege) lines.push(`Under siege · ${Math.max(0, Math.ceil(p.supplies))} days of food left`);
    ctx.save();
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const hgt = lines.length * 15 + 10;
    const x = Math.min(VIEW_W - w - 6, this.mouse.x + 16);
    const y = Math.min(VIEW_H - hgt - 6, this.mouse.y + 16);
    ctx.fillStyle = 'rgba(20,15,10,0.88)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, hgt, 6);
    ctx.fill();
    ctx.fillStyle = '#efe6d2';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.font = i === 0 ? '700 12px ui-sans-serif, system-ui, sans-serif' : '12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(l, x + 8, y + 6 + i * 15);
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- input

  private armyHit(sx: number, sy: number): Army | null {
    const icon = Math.max(6, Math.min(14, 5 + 4 * this.cam.z));
    for (const a of [...this.state.armies].reverse()) {
      const r = this.armyRect(a, icon);
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h + 4) return a;
    }
    return null;
  }

  private provAtScreen(sx: number, sy: number): number {
    const [wx, wy] = this.toWorldPt(sx, sy);
    return this.map.provAt(wx, wy);
  }

  pointerDown(x: number, y: number, button: number) {
    if (modalOpen()) return;
    this.ptr = { x, y, button, dragged: false };
    if (button === 2) void this.command(x, y);
  }

  pointerMove(x: number, y: number) {
    this.mouse = { x, y };
    const p = this.ptr;
    if (p && (p.button === 0 || p.button === 1)) {
      if (!p.dragged && Math.hypot(x - p.x, y - p.y) > 5) p.dragged = true;
      if (p.dragged) {
        this.cam.x -= (x - p.x) / this.cam.z;
        this.cam.y -= (y - p.y) / this.cam.z;
        p.x = x;
        p.y = y;
        this.clampCam();
      }
    }
    this.hoverProv = Math.max(-1, this.provAtScreen(x, y));
  }

  pointerUp(x: number, y: number, button: number) {
    const p = this.ptr;
    this.ptr = null;
    if (!p || p.dragged || button !== 0 || modalOpen()) return;
    const a = this.armyHit(x, y);
    if (a) this.select(a, -1);
    else this.select(null, this.provAtScreen(x, y));
  }

  wheel(x: number, y: number, dy: number) {
    this.zoomAt(x, y, Math.exp(-dy * 0.0015));
  }

  keyDown(e: KeyboardEvent) {
    if (modalOpen()) return;
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault();
      this.keys.add(k);
    } else if (k === ' ') {
      e.preventDefault();
      this.setPaused(!this.paused);
    } else if (k === '1' || k === '2' || k === '3') {
      this.speed = SPEEDS[Number(k) - 1];
      this.setPaused(false);
    } else if (k === 'escape') this.select(null, -1);
    else if (k === '=' || k === '+') this.zoomAt(VIEW_W / 2, VIEW_H / 2, 1.25);
    else if (k === '-') this.zoomAt(VIEW_W / 2, VIEW_H / 2, 0.8);
  }

  keyUp(e: KeyboardEvent) {
    this.keys.delete(e.key.toLowerCase());
  }

  private select(army: Army | null, prov: number) {
    this.selArmy = army;
    this.selProv = army ? -1 : prov;
    this.renderUI(true);
  }

  /** Right-click: give the selected army its orders. */
  private async command(x: number, y: number) {
    const s = this.state;
    const a = this.selArmy;
    if (!a || a.owner !== PLAYER) return;
    const target = this.armyHit(x, y);
    if (target && target !== a) {
      if (target.owner === PLAYER) setGoal(s, a, { kind: 'join', army: target.id });
      else {
        if (!(await this.ensureWar(target.owner, `attack the ${s.factions[target.owner].short} army`))) return;
        setGoal(s, a, { kind: 'chase', army: target.id });
      }
    } else {
      const p = this.provAtScreen(x, y);
      if (p < 0) return;
      const prov = s.provinces[p];
      if (prov.owner !== PLAYER && !(await this.ensureWar(prov.owner, `march into ${prov.name}`))) return;
      // Click on (or right by) a town to march there; anywhere else, the army marches straight to that spot.
      const [tx, ty] = this.toScreen(prov.x, prov.y);
      const [wx, wy] = this.toWorldPt(x, y);
      if (Math.hypot(tx - x, ty - y) < 16) setGoal(s, a, { kind: 'go', prov: p });
      else setGoal(s, a, { kind: 'point', x: wx, y: wy });
      if (!a.goal) log(s, 'There is no way over land to get there.', true);
    }
    this.renderUI(true);
  }

  /** Confirms (and declares) war before an order that would break the peace. */
  private async ensureWar(other: number, what: string): Promise<boolean> {
    const s = this.state;
    if (other === PLAYER || other === IND || s.war[PLAYER][other]) return true;
    const allies = s.factions.filter((f) => f.alive && s.ally[other][f.id] && f.id !== PLAYER).map((f) => f.name);
    const ok = await this.confirm(`War with the ${s.factions[other].name}?`,
      `You are at peace with the ${s.factions[other].name}. To ${what} you must declare war.${allies.length ? ` Their allies (${allies.join(', ')}) will join them.` : ''}${s.truceUntil[PLAYER][other] > s.day ? ' You hold each other\'s hostages: breaking the truce will cost their lives, your good name with every court, and your commanders\' trust.' : ''}${s.marriage[PLAYER][other] ? ' Your houses are joined by marriage.' : ''}`,
      'Declare war');
    if (ok) {
      declareWar(s, PLAYER, other);
      this.renderUI(true);
    }
    return ok;
  }

  private confirm(title: string, body: string, yes: string): Promise<boolean> {
    return new Promise((resolve) => {
      showModal(title, body, [
        { label: 'Cancel', onClick: () => { hideModal(); resolve(false); } },
        { label: yes, primary: true, onClick: () => { hideModal(); resolve(true); } },
      ]);
    });
  }

  private showOver() {
    this.overShown = true;
    const s = this.state;
    const won = s.over === 'won';
    showModal(
      won ? 'Hindavi Swarajya!' : 'Swarajya has fallen',
      won
        ? `By ${dateLabel(s.day)} the Maratha banner flies over ${provincesOf(s, PLAYER).length} provinces. The empire bends; the people are free.`
        : 'The last Maratha fort has fallen. But hill forts have a way of changing hands again...',
      [{ label: 'New campaign', primary: true, onClick: () => { hideModal(); app.setScene(new CampaignScene(newGame(Math.floor(Math.random() * 1e9)))); } }],
    );
  }

  /** Rivers and marshes around a battle site, read off the campaign map. */
  private featuresAt(p: { x: number; y: number }): { river: boolean; marsh: boolean } {
    const { river, moist, elev } = this.state.map;
    const cx = Math.floor(p.x / CELL);
    const cy = Math.floor(p.y / CELL);
    let nearRiver = false;
    for (let dy = -5; dy <= 5 && !nearRiver; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < MW && river[y * MW + x]) {
          nearRiver = true;
          break;
        }
      }
    }
    const i = cy * MW + cx;
    return { river: nearRiver, marsh: moist[i] > 0.72 && elev[i] < 0.18 };
  }

  private terrainAt(p: { x: number; y: number }): Terrain {
    const { elev, moist } = this.state.map;
    const i = Math.floor(p.y / CELL) * MW + Math.floor(p.x / CELL);
    if (elev[i] > 0.32) return 'hills';
    if (moist[i] > 0.68) return 'forest';
    if (moist[i] < 0.3) return 'desert';
    return 'plains';
  }

  // ---------------------------------------------------------------- moments that need the player

  private hooks(): Hooks {
    return {
      battle: (b) => this.battlePrompt(b),
      arrival: (a, p) => this.arrivalPrompt(a, p),
      chooseSack: (p) => this.sackPrompt(p),
      event: (ev) => this.eventPrompt(ev),
      chauthDemand: (a, p) => new Promise((resolve) => {
        const s = this.state;
        const share = Math.round(p.wealth * 0.25 * 10) / 10;
        showModal(`Chauth demanded at ${p.town}`, h('div', {},
          h('p', {}, `${a.general.name} and an army of the ${s.factions[a.owner].short} (${roughMen(a)} men) stand before ${p.town}. They will spare the villages of ${p.name} if it pays them chauth: a quarter of its revenue (about ${share} gold a month) for a year, and ${Math.round(p.wealth * 4)} gold now.`),
          h('p', { class: 'muted' }, 'Refuse, and they will plunder the province.'),
        ), [
          { label: '🔥 Refuse', onClick: () => { hideModal(); resolve(false); } },
          { label: 'Pay chauth', primary: true, onClick: () => { hideModal(); resolve(true); } },
        ]);
      }),
      peaceOffer: (f, tribute, cede) => new Promise((resolve) => {
        const fac = this.state.factions[f];
        showModal(`The ${fac.short} sue for peace`, h('div', {},
          h('p', {}, `Envoys of the ${fac.name} arrive under a white flag. Their realm has run short of fighting men (${manpowerLabel(manpowerRatio(this.state, f)).toLowerCase()}), and they offer ${tribute} gold in tribute for peace${cede >= 0 ? `, and to cede ${this.state.provinces[cede].name}` : ''}.`),
          h('p', { class: 'muted' }, 'Accept, and the war ends: sieges against them are lifted and armies in their land go home. Refuse, and you can keep bleeding them.'),
        ), [
          { label: 'Refuse', onClick: () => { hideModal(); resolve(false); } },
          { label: `Accept (+${tribute} gold${cede >= 0 ? `, ${this.state.provinces[cede].name}` : ''})`, primary: true, onClick: () => { hideModal(); resolve(true); } },
        ]);
      }),
      changed: () => {
        this.dirty = true;
      },
    };
  }

  private battlePrompt(b: BattleInfo): Promise<BattleResult> {
    const s = this.state;
    const { mode, att, p, defOwner } = b;
    const defArmy = b.def;
    if (b.defUnits.length === 0) return Promise.resolve('att');
    const playerAttacks = b.attArmies.some((x) => x.owner === PLAYER);
    const mine = playerAttacks ? b.attUnits : b.defUnits;
    const theirs = playerAttacks ? b.defUnits : b.attUnits;
    const enemy = s.factions[playerAttacks ? defOwner : att.owner];
    const siege = mode === 'siege';
    const garrison = !defArmy;
    const where = defArmy ? s.provinces[provinceUnder(s, defArmy, defArmy.node)] : p;
    const place = siege || garrison ? p.town : where.name;
    const title = siege ? `Siege of ${p.town}` : garrison ? `Storming ${p.town}` : `Battle near ${where.name}`;
    const eq = p.siege ? siegeEquipment(p.siege) : 0;
    const wallK = siege ? wallFactor(p, b.attUnits, eq) : 1;
    const ms = unitsStrength(mine) * (playerAttacks ? 1 : wallK * 1.1);
    const ts = unitsStrength(theirs) * (playerAttacks ? wallK * 1.1 : 1);
    const ratio = ms / Math.max(1, ts);
    const odds = ratio > 1.8 ? 'Overwhelming' : ratio > 1.2 ? 'Favourable' : ratio > 0.85 ? 'Even' : ratio > 0.55 ? 'Unfavourable' : 'Desperate';
    const myArmies = (playerAttacks ? b.attArmies : b.defArmies).length;
    const theirArmies = (playerAttacks ? b.defArmies : b.attArmies).length;
    const forces = (n: number, withGarrison: boolean) =>
      [n ? `${n} ${n === 1 ? 'army' : 'armies'}` : '', withGarrison ? 'the garrison' : ''].filter(Boolean).join(' + ');
    const sideCard = (units: CUnit[], f: number, label: string, detail: string) => h('div', { class: 'card' },
      h('h3', {}, swatch(s.factions[f].color), label),
      detail ? h('div', { class: 'muted', style: 'margin-bottom:4px' }, detail) : null,
      ...summarize(units).map(([t, n, men]) => h('div', { class: 'muted uname' }, symbolEl(t, s.factions[f].color, 22), `${n}× ${UNIT_STATS[t].short} (${men})`)),
      h('div', { style: 'margin-top:4px' }, `${Math.round(unitsMen(units))} men in ${units.length} regiments`),
    );
    let intro: string;
    if (siege) intro = playerAttacks
      ? `Your army storms the ${wallName(p.walls, p.kind, p.sea).toLowerCase()} of ${p.town}. Siege equipment: ${EQUIPMENT[eq]}.`
      : `The ${enemy.short} assault ${p.town}! Its garrison must hold the walls.`;
    else if (garrison) intro = playerAttacks ? `Your army attacks the garrison of ${p.town}.` : `The ${enemy.short} attack ${p.town}!`;
    else intro = playerAttacks ? `Your army catches the ${enemy.short} near ${where.name}.` : `The ${enemy.short} fall upon your army near ${where.name}!`;
    const myArmy = (playerAttacks ? b.attArmies : b.defArmies).find((x) => x.owner === PLAYER) ?? null;
    const enemyArmy = playerAttacks ? defArmy : att;
    const canEscape = !siege && !!myArmy;
    const faster = !!myArmy && (!enemyArmy || armySpeed(s, myArmy) >= armySpeed(s, enemyArmy));
    const body = h('div', {},
      h('p', {}, intro),
      isMonsoon(s.day) ? h('p', { class: 'muted' }, '🌧 Monsoon rain: bows and matchlocks will suffer.') : null,
      h('p', { class: 'muted' }, `Estimated odds: ${odds}.`),
      theirArmies + myArmies > 2 ? h('p', {}, 'Armies nearby have marched to join the fight.') : null,
      h('div', { class: 'versus' },
        sideCard(mine, PLAYER, 'Your forces', forces(myArmies, !playerAttacks && b.garrison && p.owner === PLAYER)),
        sideCard(theirs, enemy.id, enemy.short, forces(theirArmies, playerAttacks && b.garrison))),
    );

    // The weather and the hour the armies meet.
    const season = seasonOf(s.day);
    const fog = !siege && (season === 'Winter' || season === 'Autumn') && s.rng.chance(0.25);
    const dusk = !siege && s.rng.chance(0.2);
    const myLead = myArmy ?? null;
    const theirLead = (playerAttacks ? defArmy : att) ?? null;
    const note = (a: Army | null) => (a ? `${a.general.name}, ${generalLine(a.general).toLowerCase()} (${TRAITS[a.general.trait].help.toLowerCase()})` : 'the qiledar of the fort');
    if (fog) body.append(h('p', { class: 'muted' }, '🌫 Morning mist lies over the field.'));
    if (dusk) body.append(h('p', { class: 'muted' }, '🌇 It is late in the day; night will fall before long.'));
    body.append(h('p', { class: 'muted' }, `Your commander: ${note(myLead)}. Theirs: ${note(theirLead)}.`));
    return new Promise((resolve) => {
      const done = (playerWon: boolean, draw = false) => {
        if (draw) {
          log(s, `Night ends the fighting at ${place}. Neither side gives way.`, true);
          resolve(siege ? 'def' : 'draw');
          return;
        }
        log(s, playerWon ? `Victory at ${place}!` : `Defeat at ${place}.`, true);
        resolve(playerAttacks === playerWon ? 'att' : 'def');
      };
      const buttons: { label: string; onClick: () => void; primary?: boolean }[] = [];
      if (canEscape) {
        buttons.push({
          label: playerAttacks ? 'Leave them be' : faster ? 'Escape' : 'Escape (lose a rearguard)',
          onClick: () => {
            hideModal();
            if (!playerAttacks && !faster) for (const u of mine) u.men = Math.floor(u.men * 0.85);
            log(s, playerAttacks ? 'Your army breaks off.' : 'Your army slips away.', true);
            resolve('escaped');
          },
        });
      }
      buttons.push(
        {
          label: 'Auto-resolve',
          onClick: () => {
            hideModal();
            const won = siege ? autoResolveSiege(s, b.attUnits, p, b.defUnits, generalK(att, true)) : autoResolve(s, b.attUnits, b.defUnits, generalK(att), generalK(defArmy));
            done(playerAttacks ? won : !won);
          },
        },
        {
          label: siege ? '🏰 Command the assault' : '⚔ Command the battle',
          primary: true,
          onClick: () => {
            hideModal();
            app.setScene(new BattleScene({
              mode, playerUnits: mine, enemyUnits: theirs, playerAttacks, title,
              seed: Math.floor(s.seed * 31 + s.day * 7 + p.id), terrain: this.terrainAt(siege || garrison ? p : (defArmy ?? p)),
              rain: isMonsoon(s.day), walls: siege ? p.walls : 0, ladders: eq >= 1, ram: eq >= 2,
              ...(siege ? {} : this.featuresAt(garrison ? p : (defArmy ?? p))),
              place: siege || garrison ? p.town : where.name,
              playerGeneral: myArmy?.general.name ?? `Qiledar of ${p.town}`,
              enemyGeneral: enemyArmy?.general.name ?? `Qiledar of ${p.town}`,
              playerFaction: s.factions[PLAYER], enemyFaction: enemy,
              fog, dusk, leaders: [leaderMods(myLead), leaderMods(theirLead)],
              leaderNotes: [myLead ? `${myLead.general.name}, ${generalLine(myLead.general)}` : 'the qiledar',
                theirLead ? `${theirLead.general.name}, ${generalLine(theirLead.general)}` : 'the qiledar'],
              onDone: (playerWon, draw, lost) => {
                app.setScene(this);
                // A commander whose regiment broke may be dead or in chains.
                if (lost?.[0] && myLead && s.armies.includes(myLead)) generalFate(s, myLead, enemy.id, playerWon ? 0.4 : 0.8);
                if (lost?.[1] && theirLead && s.armies.includes(theirLead)) generalFate(s, theirLead, PLAYER, playerWon ? 0.8 : 0.4);
                done(playerWon, draw);
              },
            }));
          },
        },
      );
      showModal(title, body, buttons);
    });
  }

  private arrivalPrompt(a: Army, p: Province): Promise<'siege' | 'raid' | 'leave'> {
    const s = this.state;
    const walled = p.walls > 0 && p.garrison.length > 0;
    const taken = !!p.siege && p.siege.army !== a.id;
    return new Promise((resolve) => {
      showModal(`Before ${p.town}`, h('div', {},
        h('p', {}, `Your army stands before ${p.town} (${p.name}), held by the ${s.factions[p.owner].name}.`),
        h('p', { class: 'muted' }, `${wallName(p.walls, p.kind, p.sea)} · garrison ${unitsMen(p.garrison)} men · ${Math.ceil(p.supplies)} days of food · wealth ${p.wealth}`),
        taken ? h('p', { class: 'neg' }, 'Another army is already besieging it.') : null,
        h('ul', { class: 'help' },
          walled ? h('li', {}, h('b', {}, 'Besiege: '), 'camp below the walls. Each day the garrison eats its stores while your men build ladders, then a ram. Storm whenever you like.') : null,
          !walled ? h('li', {}, h('b', {}, 'Storm: '), 'the town has no real defences. Take it now.') : null,
          h('li', {}, h('b', {}, 'Raid: '), `plunder the villages for ${RAID_DAYS} days. Gold for you, and the province pays its owner nothing for two months.`),
        ),
      ), [
        { label: 'Leave', onClick: () => { hideModal(); resolve('leave'); } },
        { label: '🔥 Raid villages', onClick: () => { hideModal(); resolve('raid'); } },
        ...(taken ? [] : [{ label: walled ? '🏰 Besiege' : '⚔ Storm the town', primary: true, onClick: () => { hideModal(); resolve('siege' as const); } }]),
      ]);
    });
  }

  private sackPrompt(p: Province): Promise<boolean> {
    const loot = Math.round(p.wealth * 8);
    return new Promise((resolve) => {
      showModal(`${p.town} has fallen`, h('div', {},
        h('p', {}, `${p.name} is yours. What becomes of ${p.town}?`),
        h('ul', { class: 'help' },
          h('li', {}, h('b', {}, 'Occupy: '), `keep the town whole. It pays ${p.wealth} gold a month from now on.`),
          h('li', {}, h('b', {}, 'Sack: '), `seize about ${loot} gold now. The province is devastated for half a year and loses much of its wealth for good.`),
        ),
      ), [
        { label: `Sack (+${loot} gold)`, onClick: () => { hideModal(); resolve(true); } },
        { label: 'Occupy', primary: true, onClick: () => { hideModal(); resolve(false); } },
      ]);
    });
  }

  private eventPrompt(ev: GameEvent): Promise<number> {
    return new Promise((resolve) => {
      showModal(ev.title, h('div', {}, h('p', {}, ev.text)),
        ev.choices.map((c, i) => ({ label: c, primary: i === 0, onClick: () => { hideModal(); this.renderUI(true); resolve(i); } })));
    });
  }

  /** Re-opens a modal after an action inside it, so its numbers are fresh. */
  private act(report: string | null, reopen: () => void) {
    if (report) log(this.state, report, true);
    this.renderUI(true);
    reopen();
  }

  // ---------------------------------------------------------------- court

  private openCourt() {
    const s = this.state;
    const gens = playerGenerals(s);
    const row = (g: General, where: string, extra: HTMLElement | null) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, `${g.name} `, h('span', { class: 'muted' }, g.house)), h('span', { class: 'muted' }, where)),
      h('div', { class: 'muted', title: TRAITS[g.trait].help }, `${generalLine(g)}${g.landed ? ' · holds a jagir' : ''} — ${TRAITS[g.trait].help}`),
      h('div', { class: 'row muted' }, h('span', {}, `Loyalty ${Math.round(g.loyalty)}`), h('span', { class: g.loyalty < 30 ? 'neg' : '' }, g.loyalty < 15 ? 'may defect!' : g.loyalty < 30 ? 'discontented' : '')),
      bar(g.loyalty / 100, g.loyalty < 30 ? 'var(--neg)' : 'var(--gold)'),
      extra,
    );
    const gift = (g: General) => h('div', { class: 'btns' }, h('button', {
      class: 'small', disabled: s.gold[PLAYER] < 50 + generalRank(g) * 25,
      onclick: () => this.act(giftGeneral(s, g), () => this.openCourt()),
    }, `🎁 Gift ${50 + generalRank(g) * 25} gold (+15 loyalty)`));
    const held = s.captives.map((c, i) => ({ c, i }));
    showModal('The court', h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Your commanders win renown in battle and each has a gift. Loyalty falls if the treasury runs dry or they are refused land; a commander below 15 may defect with his army.'),
      ...gens.map(({ g, army }) => row(g, army ? `leads ${fmt(unitsMen(army.units))} men` : 'at court', gift(g))),
      held.length ? h('h3', {}, 'Prisoners') : null,
      ...held.map(({ c, i }) => {
        const ours = c.owner === PLAYER;
        return h('div', { class: 'card' },
          h('div', { class: 'row' }, h('b', {}, c.gen.name), h('span', { class: 'muted' }, ours ? `held by the ${s.factions[c.by].short}` : `${s.factions[c.owner].short} commander, your prisoner`)),
          c.owner === PLAYER || c.by === PLAYER ? h('div', { class: 'btns' }, h('button', {
            class: 'small',
            onclick: () => this.act(ours ? payRansom(s, i) : sellCaptive(s, i), () => this.openCourt()),
          }, ours ? `Pay ransom (${ransomPrice(c.gen)} gold)` : `Release for ransom (${ransomPrice(c.gen)} gold)`)) : null,
        );
      }),
    ), [{ label: 'Close', primary: true, onClick: hideModal }], { wide: true });
  }

  // ---------------------------------------------------------------- navy

  private openNavy() {
    const s = this.state;
    const mineF = s.fleets.filter((f) => f.owner === PLAYER);
    const foreign = s.fleets.filter((f) => f.owner !== PLAYER && hostile(s, PLAYER, f.owner));
    const yards = provincesOf(s, PLAYER).filter((p) => p.buildings.shipyard);
    const mission = (f: typeof mineF[number]) => f.returning ? 'sailing home' : f.mission === 'port' ? 'in port'
      : f.mission === 'patrol' ? 'patrolling the coast' : `${f.mission === 'raid' ? 'raiding' : 'blockading'} ${s.provinces[f.target]?.name}`;
    const rows = mineF.map((f) => {
      const targets = fleetTargets(s, f);
      const sel = h('select', {}, ...targets.map((p) => h('option', { value: String(p.id) }, `${p.name} (${s.factions[p.owner].short})`))) as HTMLSelectElement;
      const go = (m: 'raid' | 'blockade') => {
        const t = Number(sel.value);
        if (!targets.length || Number.isNaN(t)) return;
        orderFleet(s, f, m, t);
        this.act(null, () => this.openNavy());
      };
      return h('div', { class: 'card' },
        h('div', { class: 'row' }, h('b', {}, `⛵ ${f.ships} ships of ${s.provinces[f.home].town}`), h('span', { class: 'muted' }, mission(f))),
        h('div', { class: 'btns' },
          h('button', { class: 'small', onclick: () => { orderFleet(s, f, 'patrol'); this.act(null, () => this.openNavy()); } }, 'Patrol coast (+15% port trade, intercept raids)'),
          h('button', { class: 'small', onclick: () => { orderFleet(s, f, 'port'); this.act(null, () => this.openNavy()); } }, 'Return to port'),
        ),
        targets.length ? h('div', { class: 'btns' }, sel,
          h('button', { class: 'small', onclick: () => go('raid') }, '🔥 Raid'),
          h('button', { class: 'small', onclick: () => go('blockade') }, '⚓ Blockade')) : h('div', { class: 'muted' }, 'No enemy coast within reach.'),
      );
    });
    showModal('The navy', h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Gallivats and grabs of the Konkan coast. Raid enemy ports for plunder, blockade them (no sea trade, and a besieged sea fort can no longer be fed by boat), or patrol your own coast. Squadrons fight whoever they meet; Portuguese and English ships are the best.'),
      ...rows,
      mineF.length ? null : h('p', {}, 'You have no ships. Build a shipyard in a coastal province, then build ships there.'),
      yards.length ? h('div', { class: 'btns' }, ...yards.map((p) => h('button', {
        class: 'small', disabled: s.gold[PLAYER] < SHIP_COST,
        onclick: () => this.act(buildShip(s, p), () => this.openNavy()),
      }, `Build a ship at ${p.town} (${SHIP_COST})`))) : null,
      foreign.length ? h('div', { class: 'muted' }, `Enemy squadrons: ${foreign.map((f) => `${s.factions[f.owner].short} ${f.ships} at ${s.provinces[f.home].town}`).join(', ')}`) : null,
    ), [{ label: 'Close', primary: true, onClick: hideModal }], { wide: true });
  }

  // ---------------------------------------------------------------- diplomacy and troops

  private openDiplomacy() {
    const s = this.state;
    const mine = factionStrength(s, PLAYER) + 1;
    const others = s.factions.filter((f) => f.id !== PLAYER && f.id !== IND && f.alive);
    const rows = others.map((f) => {
      const war = s.war[PLAYER][f.id];
      const allies = s.factions.filter((o) => s.ally[f.id][o.id] && o.alive).map((o) => o.short);
      const str = factionStrength(s, f.id);
      const rel = Math.round(s.relations[f.id][PLAYER]);
      const refused = (this.peaceTried.get(f.id) ?? -99) > s.day - 30;
      const ties = [s.ally[PLAYER][f.id] ? 'allied' : '', s.marriage[PLAYER][f.id] ? 'joined by marriage' : '',
        s.truceUntil[PLAYER][f.id] > s.day ? `hostages held (truce to ${dateLabel(s.truceUntil[PLAYER][f.id])})` : ''].filter(Boolean).join(' · ');
      const say = (t: string) => this.act(t, () => this.openDiplomacy());
      const targets = others.filter((o) => o.id !== f.id && !s.war[f.id][o.id]);
      const sel = h('select', {}, ...targets.map((o) => h('option', { value: String(o.id) }, o.short))) as HTMLSelectElement;
      const cede = war ? cessionFor(s, f.id) : null;
      return h('div', { class: 'card' },
        h('div', { class: 'row' }, h('span', {}, swatch(f.color), h('b', {}, f.name)), h('span', { class: war ? 'neg' : 'pos' }, war ? 'At war' : 'At peace')),
        h('div', { class: 'row muted' },
          h('span', {}, `${provincesOf(s, f.id).length} provinces · armies ${str > mine * 1.5 ? 'far stronger' : str > mine ? 'stronger' : str > mine * 0.6 ? 'comparable' : 'weaker'} · manpower ${manpowerLabel(manpowerRatio(s, f.id)).toLowerCase()}`),
          h('span', { class: rel >= 20 ? 'pos' : rel <= -20 ? 'neg' : '' }, `Relations ${rel > 0 ? '+' : ''}${rel}`)),
        allies.length || ties ? h('div', { class: 'muted' }, [ties, allies.length ? `Allied with: ${allies.join(', ')}` : ''].filter(Boolean).join(' · ')) : null,
        war
          ? h('div', { class: 'btns' },
            h('button', { class: 'small', disabled: refused, onclick: () => this.offerPeace(f.id, 'white') }, refused ? 'Envoys refused (try next month)' : 'Offer peace'),
            h('button', { class: 'small', disabled: refused, onclick: () => this.offerPeace(f.id, 'tribute') }, 'Peace for tribute'),
            cede ? h('button', { class: 'small', disabled: refused, onclick: () => this.offerPeace(f.id, 'province') }, `Peace if they cede ${cede.name}`) : null)
          : h('div', { class: 'btns' },
            h('button', { class: 'small', onclick: () => say(propose(s, f.id, 'alliance')), disabled: s.ally[PLAYER][f.id] }, 'Propose alliance'),
            h('button', { class: 'small', onclick: () => say(propose(s, f.id, 'marriage')), disabled: s.marriage[PLAYER][f.id] }, 'Marriage alliance'),
            h('button', { class: 'small', onclick: () => say(propose(s, f.id, 'hostages')), disabled: s.truceUntil[PLAYER][f.id] > s.day }, 'Exchange hostages'),
            h('button', { class: 'small', onclick: () => { void this.ensureWar(f.id, 'make war').then(() => this.openDiplomacy()); } }, 'Declare war')),
        h('div', { class: 'btns' },
          h('button', { class: 'small', disabled: s.gold[PLAYER] < 80, onclick: () => say(propose(s, f.id, 'gift')) }, 'Send gifts (80)'),
          targets.length ? sel : null,
          targets.length ? h('button', { class: 'small', disabled: s.gold[PLAYER] < SUBSIDY, onclick: () => say(subsidise(s, f.id, Number(sel.value))) }, `Pay them to attack (${SUBSIDY})`) : null),
      );
    });
    showModal('Diplomacy', h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Independent chiefs (grey) may be attacked at any time. Allies join wars against those who attack you. Marriage makes a court slow to fight you; hostages swear two years of peace, and breaking that oath shames you before every court. Gold can buy you a war between others. Beaten enemies may give up land or tribute for peace.'),
      ...rows,
    ), [{ label: 'Close', primary: true, onClick: hideModal }], { wide: true });
  }

  private offerPeace(f: number, demand: 'white' | 'tribute' | 'province') {
    const s = this.state;
    const [made, text] = peaceTerms(s, f, demand, acceptsPeace(s, f, PLAYER));
    if (!made) this.peaceTried.set(f, s.day);
    log(s, text, true);
    this.renderUI(true);
    this.openDiplomacy();
  }

  private openTroops() {
    const s = this.state;
    const who = (t: UnitType) => s.factions.filter((f) => f.roster.includes(t)).map((f) => f.short);
    const statBar = (label: string, v: number, max: number) => h('div', { class: 'stat-line' }, h('span', { class: 'muted' }, label), bar(v / max, 'var(--gold)'));
    const sections = TIERS.map((tier) => {
      const types = UNIT_TYPES.filter((t) => UNIT_STATS[t].tier === tier).sort((a, b) => UNIT_STATS[b].value - UNIT_STATS[a].value);
      return h('div', { class: 'tier-section' },
        h('h3', {}, tierBadge(tier), ` ${TIER_NAMES[tier]}`),
        ...types.map((t) => {
          const st = UNIT_STATS[t];
          const mine = s.factions[PLAYER].roster.includes(t);
          return h('div', { class: `troop ${mine ? 'mine' : ''}` },
            symbolEl(t, mine ? s.factions[PLAYER].color : '#b7ab92', 40),
            h('div', { class: 'troop-body' },
              h('div', { class: 'row' }, h('b', {}, st.name), h('span', { class: 'muted' }, `${st.cost} gold · ${st.maxMen} ${st.cls === 'elephant' ? 'elephants' : 'men'}`)),
              h('div', { class: 'muted', style: 'font-size:12px' }, who(t).join(', ') + (st.elite ? ' · capital only, max 3' : '')),
              h('div', { class: 'stat-grid' },
                statBar('Attack', st.melee * (st.cls === 'elephant' ? 0.35 : 1), 2.3),
                statBar('Defence', st.defense * (st.cls === 'elephant' ? 0.22 : 1), 2.2),
                statBar('Speed', st.speed, 85),
                statBar('Morale', st.morale, 96),
                st.range ? statBar('Range', st.range, 520) : null,
              ),
              h('div', { style: 'font-size:12.5px;margin-top:4px' }, st.blurb),
            ),
          );
        }),
      );
    });
    showModal('Troops of the age', h('div', {},
      h('p', { class: 'muted' }, 'Ranked by tier. Your own troops are shown in saffron. Symbols follow military map convention: a cross is infantry, a diagonal is cavalry, a dot is gunpowder, an oval is armour, and a double frame marks guard troops.'),
      ...sections,
    ), [{ label: 'Close', primary: true, onClick: hideModal }], { wide: true });
  }

  // ---------------------------------------------------------------- side panel

  /** What the side panel shows, minus the numbers that tick every frame. */
  private signature(): string {
    const s = this.state;
    const a = this.selArmy;
    const army = a ? `${a.id}:${a.units.map((u) => Math.round(u.men / 5)).join(',')}:${a.siegeOf}:${a.raidUntil > s.day}:${a.route.length > 0}:${townAt(s, a)}:${a.goal?.kind ?? ''}` : '';
    const p = this.selProv >= 0 ? s.provinces[this.selProv] : null;
    const prov = p ? `${p.id}:${p.owner}:${p.garrison.map((u) => Math.round(u.men / 5)).join(',')}:${!!p.siege}:${p.walls}:${p.wealth}:${p.devastated > 0}:${canBuild(s, p)}:${armyAtTown(s, p, PLAYER)?.units.length ?? -1}` : '';
    const mine = s.armies.filter((x) => x.owner === PLAYER).map((x) => `${x.id}/${Math.round(unitsMen(x.units) / 10)}`).join(',');
    const extra = p ? `${Math.round(p.unrest)}:${p.tribute?.to ?? -1}:${Object.values(p.buildings).join('')}:${p.jagir}` : '';
    const armyX = a ? `${a.general.name}:${Math.round(a.food / 3)}:${intelOn(s, a)}` : '';
    return [army, prov, extra, armyX, s.gold[PLAYER], Math.round(s.manpower[PLAYER] / 25), mine, s.log.length, provincesOf(s, PLAYER).length, this.paused, this.speed, s.policy[PLAYER].tax, s.policy[PLAYER].faith].join('|');
  }

  /** A text node refreshed every frame (ETAs, food left...). */
  private liveText(fn: () => string): HTMLElement {
    const el = h('span', {}, fn());
    this.live.push(() => {
      const t = fn();
      if (el.textContent !== t) el.textContent = t;
    });
    return el;
  }

  renderUI(force = false) {
    const sig = this.signature();
    if (!force && sig === this.uiSig) return;
    this.uiSig = sig;
    this.live = [];
    const s = this.state;
    const me = s.factions[PLAYER];
    const net = netIncome(s, PLAYER);
    this.dateEl = h('span', { title: 'Days since the campaign began' }, `${dateLabel(s.day)} · Day ${Math.floor(s.day) + 1}`);
    clear(ui.top).append(
      h('div', { class: 'brand' }, '🚩 Swarajya'),
      h('div', { class: 'stat' }, swatch(me.color), me.short),
      h('div', { class: 'stat', style: 'min-width:178px' }, this.dateEl),
      h('div', { class: 'stat btns', style: 'margin:0' },
        h('button', { class: `small ${this.paused ? 'primary' : ''}`, title: 'Pause or resume (Space)', onclick: () => this.setPaused(!this.paused) }, this.paused ? '▶ Resume' : '⏸ Pause'),
        ...SPEEDS.map((v, i) => h('button', {
          class: `small ${!this.paused && this.speed === v ? 'primary' : ''}`, title: `Speed ${v}× (key ${i + 1})`,
          onclick: () => { this.speed = v; this.setPaused(false); },
        }, `${v}×`)),
      ),
      h('div', { class: 'stat' }, `💰 ${s.gold[PLAYER]}`, h('span', { class: net >= 0 ? 'pos' : 'neg' }, `(${net >= 0 ? '+' : ''}${net}/mo)`)),
      h('div', { class: 'stat', title: 'Fighting men left to recruit and replace losses (regrows each month from untouched provinces)' },
        `👥 ${fmt(s.manpower[PLAYER])}/${fmt(maxManpower(s, PLAYER))}`),
      h('div', { class: 'stat', title: `Victory: hold ${VICTORY_PROVINCES} provinces, or take Delhi` }, `🏰 ${provincesOf(s, PLAYER).length}/${VICTORY_PROVINCES}`),
      h('button', { class: 'push', onclick: () => this.openTroops() }, 'Troops'),
      h('button', { onclick: () => this.openCourt() }, 'Court'),
      h('button', { onclick: () => this.openNavy() }, 'Navy'),
      h('button', { onclick: () => this.openDiplomacy() }, 'Diplomacy'),
    );
    clear(ui.side).append(this.selectionCard(), this.dispatchCard(), this.realmCard());
  }

  private dispatchCard(): HTMLElement {
    const s = this.state;
    const recent = s.log.filter((l) => l.mine).slice(-7).reverse();
    return h('div', { class: 'card' },
      h('h3', {}, '📜 Dispatches'),
      h('div', { class: 'log' }, ...recent.map((l) => h('div', { style: s.day - l.day < 5 ? 'color:var(--ink)' : '' }, `${dateLabel(l.day)} · ${l.text}`))),
    );
  }

  private selectionCard(): HTMLElement {
    const s = this.state;
    const a = this.selArmy;
    if (a && s.armies.includes(a)) return this.armyCard(a);
    if (this.selProv >= 0) return this.provinceCard(s.provinces[this.selProv]);
    return h('div', { class: 'card' },
      h('h3', {}, 'The Deccan, 1670'),
      h('p', {}, 'At Purandar in 1665 Shivaji surrendered 23 forts to the Mughals. Now he means to take them back.'),
      h('ul', { class: 'help' },
        h('li', {}, 'Time flows: Space pauses, 1/2/3 set the speed. Every realm marches, fights and besieges at once.'),
        h('li', {}, 'Click your saffron banner to select an army, then right-click a town to march there, anywhere else to march straight across country to that spot, or an enemy army to attack it. Armies go round the sea and over the passes; hills slow them.'),
        h('li', {}, 'Beat an army near one of its own forts and the garrison flees with it: the fort stands empty for a while, yours to walk into.'),
        h('li', {}, 'At an enemy town you choose: besiege, storm, or raid its villages. Mavalas bring ladders from day one.'),
        h('li', {}, 'Sack captured towns for a fortune, or occupy them for steady income. In the monsoon, everyone slows down.'),
        h('li', {}, 'Every regiment is drawn from your fighting men (👥). Losses are not replaced for free: guard your manpower, and bleed your enemies of theirs until they sue for peace.'),
        h('li', {}, 'Armies carry a month of food. In enemy country they live off the land, which ravaged provinces cannot do; out of food, they starve. Your hill forts feed and refill armies nearby, and their guns slow enemies on the passes.'),
        h('li', {}, 'At an enemy town, demand chauth: a quarter of its revenue each year, in return for sparing it. Spies can scout armies, burn siege works, bribe garrisons and stir revolt.'),
        h('li', {}, 'Watch unrest (!): foreign rule, another faith, heavy taxes and plunder breed revolt. Temples, garrisons and tolerance calm it. Hold a region\'s key fort for more revenue there.'),
        h('li', {}, 'Court: your commanders gain rank and have gifts; keep them loyal. Navy: raid, blockade and patrol the coast. Diplomacy: alliances, marriages, hostages and bought wars.'),
        h('li', {}, `Win by holding ${VICTORY_PROVINCES} provinces or taking Delhi.`),
      ),
    );
  }

  private unitList(units: CUnit[], color: string): HTMLElement {
    return h('div', { class: 'stack', style: 'margin-top:6px' }, ...units.map((u) => {
      const st = UNIT_STATS[u.type];
      return h('div', { class: 'unit-row', title: st.blurb },
        h('div', { class: 'row' },
          h('span', { class: 'uname' }, symbolEl(u.type, color), st.name, tierBadge(st.tier)),
          h('span', { class: 'muted' }, `${vetRank(u.xp) ? `${'˄'.repeat(vetRank(u.xp))} ${VET_NAMES[vetRank(u.xp)]} · ` : ''}${Math.round(u.men)}/${st.maxMen}`)),
        bar(u.men / st.maxMen),
      );
    }));
  }

  /** Days until the army reaches the end of its route. */
  private eta(a: Army): number {
    const s = this.state;
    let d = 0;
    let prev: { x: number; y: number } = a;
    for (const p of a.route) {
      d += dist(prev, p);
      prev = p;
    }
    return d / armySpeed(s, a);
  }

  private statusOf(a: Army): string {
    const s = this.state;
    if (a.siegeOf >= 0) {
      const p = s.provinces[a.siegeOf];
      return `Besieging ${p.town}, day ${Math.floor(s.day - (p.siege?.start ?? s.day)) + 1}`;
    }
    if (a.raidUntil > s.day) return `Plundering ${s.provinces[a.raidProv]?.name}: ${(a.raidUntil - s.day).toFixed(1)} days left`;
    if (s.day < a.busyUntil) return 'Locked in battle';
    const g = a.goal;
    if (g?.kind === 'chase' || g?.kind === 'join') {
      const t = armyById(s, g.army);
      return t ? `${g.kind === 'chase' ? 'Pursuing' : 'Joining'} the ${s.factions[t.owner].short} army (${fmt(unitsMen(t.units))})` : 'Searching';
    }
    if (a.route.length && g && 'prov' in g) return `Marching to ${s.provinces[g.prov].name}: ${this.eta(a).toFixed(1)} days`;
    if (a.route.length && g?.kind === 'point') return `Marching across country: ${this.eta(a).toFixed(1)} days`;
    const town = townAt(s, a);
    return town >= 0 ? `Encamped at ${s.provinces[town].town}` : `In the field near ${s.provinces[provinceUnder(s, a, a.node)].name}`;
  }

  private armyCard(a: Army): HTMLElement {
    const s = this.state;
    const f = s.factions[a.owner];
    const mine = a.owner === PLAYER;
    const town = townAt(s, a);
    const known = intelOn(s, a);
    const g = a.general;
    const sup = supplied(s, a);
    const parts: (HTMLElement | null)[] = [
      h('h3', {}, swatch(f.color), mine ? 'Your army' : `${f.short} army`),
      h('div', { title: TRAITS[g.trait].help }, h('b', {}, g.name), ` · ${generalLine(g)}`, mine ? h('span', { class: g.loyalty < 30 ? 'neg' : 'muted' }, ` · loyalty ${Math.round(g.loyalty)}`) : null),
      h('div', { class: 'muted', style: 'font-size:12.5px' }, TRAITS[g.trait].help),
      known
        ? h('div', { class: 'muted' }, `${fmt(unitsMen(a.units))} men · ${a.units.length}/${MAX_UNITS} regiments · marches ${Math.round(armySpeed(s, a) * 2)} km a day`)
        : h('div', { class: 'muted' }, `About ${roughMen(a)} men, by your spies' reckoning. Send scouts or come closer to count them.`),
      h('div', { style: 'margin:6px 0' }, this.liveText(() => this.statusOf(a))),
      mine || known ? h('div', { class: 'muted' }, this.liveText(() => `Food: ${Math.ceil(a.food)}/${maxFood(a)} days · ${sup === 'fort' ? 'supplied by a fort' : sup === 'home' ? 'in friendly country' : a.food <= 0 ? 'STARVING' : 'living off the land'}${s.day < a.quarantineUntil ? ` · quarantined ${Math.ceil(a.quarantineUntil - s.day)} days` : ''}`)) : null,
      known ? this.unitList(a.units, f.color) : null,
    ];
    if (!mine && a.owner !== IND) {
      const say = (t: string) => { log(s, t, true); this.renderUI(true); };
      parts.push(h('div', { class: 'btns' },
        h('button', { class: 'small', disabled: s.gold[PLAYER] < SPY_COST.scout, onclick: () => say(scout(s, a)) }, `🕵 Send scouts (${SPY_COST.scout})`),
        a.siegeOf >= 0 ? h('button', { class: 'small', disabled: s.gold[PLAYER] < SPY_COST.sabotage, onclick: () => say(sabotage(s, a)) }, `🔥 Sabotage siege works (${SPY_COST.sabotage})`) : null,
      ));
    }
    if (mine) {
      if (a.siegeOf >= 0) {
        parts.push(this.siegeBox(a));
        const p = s.provinces[a.siegeOf];
        parts.push(h('div', { class: 'btns' },
          h('button', { class: 'small', onclick: () => { const [, t] = demandChauth(s, a, p); log(s, t, true); this.renderUI(true); } }, '💰 Demand chauth instead'),
          h('button', {
            class: 'small', disabled: s.gold[PLAYER] < bribeCost(p),
            title: 'Gold for the qiledar to open the gates. Likelier when the garrison is hungry, the province restless, or their realm exhausted.',
            onclick: () => {
              const r = bribe(s, p);
              if (r === 'taken') void this.world.take(PLAYER, p).then(() => this.renderUI(true));
              else log(s, r, true);
              this.renderUI(true);
            },
          }, `🗝 Bribe the garrison (${bribeCost(p)})`)));
      }
      else {
        const btns: HTMLElement[] = [];
        if (a.route.length || a.goal) btns.push(h('button', { class: 'small', onclick: () => { setGoal(s, a, null); this.renderUI(true); } }, '✋ Halt'));
        const here = town >= 0 ? s.provinces[town] : null;
        if (here && hostile(s, PLAYER, here.owner) && a.raidUntil <= s.day) {
          const walled = here.walls > 0 && here.garrison.length > 0;
          btns.push(h('button', { class: 'small primary', onclick: () => this.orderAttackTown(a, here) }, walled ? '🏰 Besiege' : '⚔ Storm'));
          btns.push(h('button', { class: 'small', onclick: () => { this.world.startRaid(a, here); this.renderUI(true); } }, '🔥 Raid villages'));
          btns.push(h('button', {
            class: 'small', title: 'Demand a quarter of the province\'s revenue for a year, in return for sparing it. More likely if your army is much stronger than its defence, or it has been plundered already.',
            onclick: () => { const [, t] = demandChauth(s, a, here); log(s, t, true); this.renderUI(true); },
          }, '💰 Demand chauth'));
        }
        if (btns.length) parts.push(h('div', { class: 'btns' }, ...btns));
        parts.push(h('p', { class: 'muted', style: 'font-size:12.5px' },
          'Right-click a town to march there, an enemy army to attack it, or one of your own armies to join it.'));
        if (here && here.owner === PLAYER && !here.siege) parts.push(this.recruitButtons(here));
      }
    }
    return h('div', { class: 'card' }, ...parts);
  }

  private orderAttackTown(a: Army, p: Province) {
    void this.world.attackTown(a, p).then(() => this.renderUI(true));
    this.renderUI(true);
  }

  private siegeBox(a: Army): HTMLElement {
    const s = this.state;
    const p = s.provinces[a.siegeOf];
    const sg = p.siege!;
    const breakers = a.units.filter((u) => UNIT_STATS[u.type].wall > 0 || UNIT_STATS[u.type].cls === 'elephant').length;
    const cooldown = () => Math.max(0, 2 - (s.day - sg.lastAssault));
    return h('div', { class: 'card', style: 'margin-top:10px;background:#2f2418' },
      h('h3', {}, `🏰 Siege of ${p.town}`),
      h('div', { class: 'muted' }, `${wallName(p.walls, p.kind, p.sea)} · garrison ${unitsMen(p.garrison)} men`),
      h('div', { class: 'muted' }, this.liveText(() => `Food for ${Math.max(0, Math.ceil(p.supplies))} more days${p.supplies <= 0 ? ' (starving!)' : ''}`)),
      h('div', { class: 'muted' }, this.liveText(() => `Equipment: ${EQUIPMENT[p.siege ? siegeEquipment(p.siege) : 0]}${breakers ? ` · ${breakers} gate-breakers` : ''}`)),
      h('div', { class: 'btns' },
        h('button', { class: 'small primary', onclick: () => { this.world.assault(a); this.renderUI(true); } },
          this.liveText(() => (cooldown() > 0 ? `Regrouping (${cooldown().toFixed(1)}d)` : '⚔ Assault'))),
        h('button', { class: 'small', onclick: () => { setGoal(s, a, null); this.renderUI(true); } }, 'Lift siege'),
      ),
      h('p', { class: 'muted', style: 'font-size:12px' }, 'Every day the garrison eats its stores while your carpenters build ladders (4 days), then a ram (12 days).'),
    );
  }

  private recruitButtons(p: Province): HTMLElement {
    const s = this.state;
    const occ = armyAtTown(s, p, PLAYER);
    const full = !!occ && occ.units.length >= MAX_UNITS;
    return h('div', { style: 'margin-top:10px' },
      h('div', { class: 'muted' }, full ? 'Army is at full strength.' : `Raise regiments at ${p.town}:`),
      h('div', { class: 'btns' },
        ...s.factions[PLAYER].roster.map((t: UnitType) => {
          const st = UNIT_STATS[t];
          const elite = eliteBlock(s, p, t);
          const levy = levyFraction(s, PLAYER, t);
          const levyNote = levy <= 0 ? 'Not enough fighting men left. ' : levy < 1 ? `Only ${Math.round(levy * st.maxMen)} of ${st.maxMen} men can be found. ` : '';
          return h('button', {
            class: 'small recruit', title: `${st.name} (tier ${st.tier}). ${elite ? elite + ' ' : ''}${levyNote}${st.blurb} Upkeep ${st.upkeep}/month.`,
            disabled: full || s.gold[PLAYER] < recruitCost(p, t) || !!elite || levy <= 0,
            onclick: () => {
              const err = recruit(s, p, t);
              if (err) log(s, err, true);
              const a = armyAtTown(s, p, PLAYER);
              if (a) this.selArmy = a;
              this.renderUI(true);
            },
          }, symbolEl(t, s.factions[PLAYER].color, 22), `${st.short}`, tierBadge(st.tier), h('span', { class: 'muted' }, `${recruitCost(p, t)}`));
        }),
      ),
    );
  }

  private provinceCard(p: Province): HTMLElement {
    const s = this.state;
    const f = s.factions[p.owner];
    const mine = p.owner === PLAYER;
    const income = Math.round(provinceIncome(s, p));
    const here = s.armies.filter((a) => townAt(s, a) === p.id || a.siegeOf === p.id);
    const parts: (HTMLElement | null)[] = [
      h('h3', {}, p.capitalOf >= 0 ? `♛ ${p.name}` : p.name),
      h('div', { class: 'muted' }, p.region),
      h('div', { class: 'row', style: 'margin-top:4px' }, h('span', {}, swatch(f.color), f.name),
        p.owner !== PLAYER && p.owner !== IND ? h('span', { class: s.war[PLAYER][p.owner] ? 'neg' : 'pos' }, s.war[PLAYER][p.owner] ? 'at war' : 'at peace') : null),
      h('p', {}, h('b', {}, p.town), ` · ${wallName(p.walls, p.kind, p.sea)}${p.kind === 'port' ? ' · port' : ''}`),
      h('div', { class: 'row muted' }, h('span', {}, `Wealth ${p.wealth}`), h('span', {}, income ? `+${income} gold/month` : p.devastated ? 'devastated' : p.siege ? 'besieged' : '')),
      h('div', { class: 'row muted' }, this.liveText(() => `Food ${Math.max(0, Math.ceil(p.supplies))}/${maxSupplies(p)} days`), h('span', {}, `Garrison ${unitsMen(p.garrison)}`)),
      p.garrison.length ? this.unitList(p.garrison, f.color) : null,
      p.siege ? h('p', { class: 'neg' }, `Besieged by the ${s.factions[armyById(s, p.siege.army)?.owner ?? 0].short}.`) : null,
      this.provinceRealmInfo(p),
      here.length ? h('div', { class: 'btns' }, ...here.map((a) => h('button', { class: 'small', onclick: () => this.select(a, -1) },
        `Select ${s.factions[a.owner].short} army (${fmt(unitsMen(a.units))})`))) : null,
    ];
    if (mine && p.siege && p.garrison.length) {
      const wait = Math.max(0, 6 - (s.day - p.lastSortie));
      parts.push(h('div', { class: 'btns' }, h('button', {
        class: 'small', disabled: wait > 0, title: 'The garrison slips out at night to burn the besiegers\' ladders and rams.',
        onclick: () => { sortie(s, p); this.renderUI(true); },
      }, wait > 0 ? `Sortie (ready in ${Math.ceil(wait)}d)` : '🌙 Night sortie')));
    }
    if (!mine && p.owner !== IND && hostile(s, PLAYER, p.owner)) {
      parts.push(h('div', { class: 'btns' }, h('button', {
        class: 'small', disabled: s.gold[PLAYER] < SPY_COST.incite, title: 'Agents stir up the people: unrest +25 if they succeed.',
        onclick: () => { log(s, incite(s, p), true); this.renderUI(true); },
      }, `🕵 Incite unrest (${SPY_COST.incite})`)));
    }
    if (mine && !p.siege) {
      parts.push(this.recruitButtons(p));
      const err = canBuild(s, p);
      parts.push(h('div', { style: 'margin-top:10px' },
        h('div', { class: 'muted' }, err && err !== 'Under siege.' ? err : 'Build (one project a month):'),
        h('div', { class: 'btns' },
          h('button', {
            class: 'small', disabled: !!err || p.walls >= maxWalls(p) || s.gold[PLAYER] < wallsCost(p),
            title: 'Stronger walls: a bigger garrison, more food, and a harder siege.',
            onclick: () => { const e = buildWalls(s, p); if (e) log(s, e, true); this.renderUI(true); },
          }, p.walls >= maxWalls(p) ? 'Walls at maximum' : `🧱 Walls ${wallsCost(p)}`),
          h('button', {
            class: 'small', disabled: !!err || p.wealth >= maxWealth(p) || s.gold[PLAYER] < marketCost(p),
            title: '+1 wealth: more gold every month.',
            onclick: () => { const e = buildMarket(s, p); if (e) log(s, e, true); this.renderUI(true); },
          }, p.wealth >= maxWealth(p) ? 'Market at maximum' : `🏪 Market ${marketCost(p)}`),
          ...(Object.keys(BUILDINGS) as Building[]).filter((b) => !p.buildings[b] && (b !== 'shipyard' || isCoastal(p))).map((b) => h('button', {
            class: 'small', disabled: !!err || s.gold[PLAYER] < BUILDINGS[b].cost, title: BUILDINGS[b].help,
            onclick: () => { const e = build(s, p, b, canBuild(s, p)); if (e) log(s, e, true); this.renderUI(true); },
          }, `${BUILDINGS[b].icon} ${BUILDINGS[b].name} ${BUILDINGS[b].cost}`)),
        ),
        p.buildings.shipyard ? h('div', { class: 'btns' }, h('button', {
          class: 'small', disabled: s.gold[PLAYER] < SHIP_COST,
          onclick: () => { const e = buildShip(s, p); if (e) log(s, e, true); this.renderUI(true); },
        }, `⛵ Build a ship (${SHIP_COST}, max ${MAX_SHIPS})`)) : null,
      ));
    }
    return h('div', { class: 'card' }, ...parts);
  }

  /** Unrest, faith, chauth, jagirs, buildings and the region's key fort. */
  private provinceRealmInfo(p: Province): HTMLElement {
    const s = this.state;
    const causes = unrestCauses(s, p).filter((c) => Math.abs(c.v) >= 0.5);
    const net = causes.reduce((n, c) => n + c.v, 0);
    const key = keyFort(s, p.region);
    const share = tributeShare(s, p);
    const built = (Object.keys(BUILDINGS) as Building[]).filter((b) => p.buildings[b]);
    return h('div', { style: 'margin-top:6px' },
      h('div', { class: 'row muted' },
        h('span', { title: causes.map((c) => `${c.label} ${c.v > 0 ? '+' : ''}${c.v.toFixed(1)}`).join('\n') },
          `Unrest ${Math.round(p.unrest)} (${net >= 0 ? '+' : ''}${net.toFixed(1)}/mo)`),
        h('span', {}, `${p.faith === 'mixed' ? 'Mixed faiths' : p.faith === 'hindu' ? 'Hindu' : 'Muslim'} · ${s.factions[p.culture]?.short ?? ''} people`)),
      bar(p.unrest / 100, p.unrest > 50 ? 'var(--neg)' : 'var(--gold)'),
      p.owner !== IND ? h('div', { class: 'muted', style: 'font-size:12px' }, causes.map((c) => `${c.label} ${c.v > 0 ? '+' : ''}${c.v.toFixed(1)}`).join(' · ')) : null,
      p.unrest > 50 ? h('div', { class: 'neg', style: 'font-size:12.5px' }, p.unrest >= 80 ? 'On the brink of revolt!' : 'Restless: half revenue, and over 70 no recruits.') : null,
      share > 0 && p.tribute ? h('div', { class: p.tribute.to === PLAYER ? 'pos' : 'neg' },
        `Pays ${Math.round(share * 100)}% of its revenue as chauth${share > 0.25 ? ' and sardeshmukhi' : ''} to the ${s.factions[p.tribute.to].short} until ${dateLabel(p.tribute.until)}.`) : null,
      p.jagir ? h('div', { class: 'muted' }, 'Held as a jagir: half its revenue goes to the jagirdar.') : null,
      s.day < p.famineUntil ? h('div', { class: 'neg' }, 'Famine: half revenue, no recruits.') : null,
      key ? h('div', { class: 'muted', style: 'font-size:12.5px' }, key === p
        ? `The key fort of ${p.region}: its holder gets +15% revenue and +25% recruits across the region.`
        : `Key fort of ${p.region}: ${key.town} (${s.factions[key.owner].short}).`) : null,
      built.length ? h('div', { class: 'muted' }, `Built: ${built.map((b) => `${BUILDINGS[b].icon} ${BUILDINGS[b].name}`).join(', ')}`) : null,
    );
  }

  private realmCard(): HTMLElement {
    const s = this.state;
    const regions = [...regionOwners(s)].filter(([, o]) => o === PLAYER).map(([r]) => r);
    const armies = s.armies.filter((a) => a.owner === PLAYER);
    return h('div', { class: 'card' },
      h('h3', {}, 'Swarajya'),
      h('div', { class: 'row muted' }, h('span', {}, 'Revenue'), h('span', {}, `+${grossIncome(s, PLAYER)}/month`)),
      h('div', { class: 'row muted' }, h('span', {}, 'Army upkeep'), h('span', {}, `-${upkeep(s, PLAYER)}/month`)),
      h('div', { class: 'row muted' }, h('span', {}, 'Provinces'), h('span', {}, `${provincesOf(s, PLAYER).length} of ${VICTORY_PROVINCES} for victory`)),
      h('div', { class: 'row muted' }, h('span', {}, 'Fighting men'),
        h('span', {}, `${fmt(s.manpower[PLAYER])} · +${manpowerRegen(s, PLAYER)}/month · ${manpowerLabel(manpowerRatio(s, PLAYER))}`)),
      bar(manpowerRatio(s, PLAYER), manpowerRatio(s, PLAYER) > 0.35 ? 'var(--gold)' : 'var(--neg)'),
      h('div', { class: 'muted' }, regions.length ? `Whole regions held (+25% revenue): ${regions.join(', ')}` : 'Hold every province of a region for +25% revenue there.'),
      h('div', { class: 'muted' }, this.liveText(() => `Season: ${seasonOf(s.day)}`)),
      h('div', { class: 'muted', style: 'margin-top:6px' }, 'Taxes (heavy: +30% revenue, more unrest):'),
      h('div', { class: 'btns' }, ...(['light', 'normal', 'heavy'] as const).map((t) => h('button', {
        class: `small ${s.policy[PLAYER].tax === t ? 'primary' : ''}`, onclick: () => { s.policy[PLAYER].tax = t; this.renderUI(true); },
      }, t[0].toUpperCase() + t.slice(1)))),
      h('div', { class: 'muted' }, 'Faith (zealous: jizya-style dues, but those of other faiths seethe):'),
      h('div', { class: 'btns' }, ...(['tolerant', 'zealous'] as const).map((t) => h('button', {
        class: `small ${s.policy[PLAYER].faith === t ? 'primary' : ''}`, onclick: () => { s.policy[PLAYER].faith = t; this.renderUI(true); },
      }, t[0].toUpperCase() + t.slice(1)))),
      armies.length ? h('div', { class: 'btns' }, ...armies.map((a) =>
        h('button', { class: 'small', onclick: () => { this.select(a, -1); this.centerOn(a); } },
          `Army ${fmt(unitsMen(a.units))} · ${s.provinces[provinceUnder(s, a, a.node)].name}`))) : null,
    );
  }
}

/** The unit type carrying most of an army's strength (shown on its map banner). */
function mainUnit(units: CUnit[]): UnitType {
  const by = new Map<UnitType, number>();
  for (const u of units) by.set(u.type, (by.get(u.type) ?? 0) + u.men * UNIT_STATS[u.type].value);
  let best: UnitType = units[0]?.type ?? 'spear';
  let bv = -1;
  for (const [t, v] of by) if (v > bv) { bv = v; best = t; }
  return best;
}

function summarize(units: CUnit[]): [UnitType, number, number][] {
  const counts = new Map<UnitType, { n: number; men: number }>();
  for (const u of units) {
    const c = counts.get(u.type) ?? { n: 0, men: 0 };
    c.n++;
    c.men += Math.round(u.men);
    counts.set(u.type, c);
  }
  return [...counts].map(([t, c]) => [t, c.n, c.men]);
}
