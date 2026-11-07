import { app, type Scene, VIEW_H, VIEW_W } from '../app';
import { bar, clear, h, hideModal, modalOpen, showModal, swatch, ui } from '../ui';
import { CELL, MW, toWorld, WH, WW } from '../geo';
import { FOREIGN_LABELS } from '../india';
import { UNIT_STATS, wallName, type UnitType } from '../data';
import { MapRenderer } from './mapRender';
import { Flow, type Hooks } from './flow';
import {
  type Army, armyAt, autoResolve, autoResolveSiege, buildMarket, buildWalls, canBuild, type CUnit,
  dateLabel, declareWar, factionStrength, type GameState, grossIncome, hostile, IND, isMonsoon, liftSiege, log,
  makePeace, acceptsPeace, marketCost, MAX_UNITS, maxSupplies, maxWalls, maxWealth, netIncome, newGame, PLAYER,
  type Province, provinceIncome, provincesOf, raid, recruit, regionOwners, seasonOf, unitsMen, unitsStrength,
  upkeep, VICTORY_PROVINCES, wallFactor, wallsCost, type LogEntry,
} from './state';
import { BattleScene } from '../battle/scene';
import type { Terrain } from '../battle/battle';

const MAX_ZOOM = 3;
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const EQUIPMENT = ['none yet', 'ladders', 'ladders and a ram'];

export class CampaignScene implements Scene {
  state: GameState;
  private flow: Flow;
  private map: MapRenderer;
  private dirty = true;
  private cam = { x: 0, y: 0, z: 2.2 };
  private selProv = -1;
  private selArmy: Army | null = null;
  private busy = false;
  private ptr: { x: number; y: number; button: number; dragged: boolean } | null = null;
  private mouse = { x: -1, y: -1 };
  private hoverProv = -1;
  private keys = new Set<string>();
  private peaceTried = new Map<number, number>();
  private dispatch: LogEntry[] = [];
  private centroids: { f: number; x: number; y: number; cells: number }[] = [];

  constructor(state: GameState) {
    this.state = state;
    this.map = new MapRenderer(state.map, state.seed);
    this.flow = new Flow(state, this.hooks());
    const cap = state.provinces.find((p) => p.capitalOf === PLAYER)!;
    this.cam.x = cap.x - VIEW_W / 2 / this.cam.z + 140;
    this.cam.y = cap.y - VIEW_H / 2 / this.cam.z - 30;
    this.clampCam();
  }

  enter() {
    this.dirty = true;
    this.renderUI();
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

  update(dt: number) {
    const k = this.keys;
    const speed = (600 / this.cam.z) * dt;
    if (k.has('arrowleft') || k.has('a')) this.cam.x -= speed;
    if (k.has('arrowright') || k.has('d')) this.cam.x += speed;
    if (k.has('arrowup') || k.has('w')) this.cam.y -= speed;
    if (k.has('arrowdown') || k.has('s')) this.cam.y += speed;
    if (k.size) this.clampCam();
  }

  // ---------------------------------------------------------------- drawing

  private moveTargets(): Set<number> {
    const a = this.selArmy;
    if (!a || a.owner !== PLAYER || a.mp <= 0 || this.busy) return new Set();
    return new Set(this.state.provinces[a.province].neighbors);
  }

  private recomposite() {
    this.map.composite(this.state, this.selProv, this.moveTargets());
    const acc = new Map<number, { x: number; y: number; cells: number }>();
    for (const p of this.state.provinces) {
      if (p.owner === IND) continue;
      const c = acc.get(p.owner) ?? { x: 0, y: 0, cells: 0 };
      c.x += p.x * p.cells;
      c.y += p.y * p.cells;
      c.cells += p.cells;
      acc.set(p.owner, c);
    }
    this.centroids = [...acc].map(([f, c]) => ({ f, x: c.x / c.cells, y: c.y / c.cells, cells: c.cells }));
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.dirty) {
      this.recomposite();
      this.dirty = false;
    }
    const { z } = this.cam;
    ctx.fillStyle = '#1a3a62';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.imageSmoothingEnabled = true;
    const [ox, oy] = this.toScreen(0, 0);
    ctx.drawImage(this.map.canvas, ox, oy, WW * z, WH * z);

    const s = this.state;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // Seas and foreign lands.
    ctx.font = `italic 600 ${Math.round(Math.max(10, 13 * Math.min(1.3, z)))}px Georgia, serif`;
    for (const l of FOREIGN_LABELS) {
      const [sx, sy] = this.toScreen(...toWorld(...l.at));
      ctx.fillStyle = l.sea ? 'rgba(190,215,240,0.55)' : 'rgba(235,228,210,0.55)';
      ctx.fillText(l.name.split('').join(' '), sx, sy);
    }

    // Realm names when zoomed out.
    if (z < 0.8) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (0.8 - z) * 4);
      for (const c of this.centroids) {
        const f = s.factions[c.f];
        const size = Math.min(34, Math.sqrt(c.cells) * 0.33 * z);
        if (size < 9) continue; // tiny realms would only clutter the overview
        const [sx, sy] = this.toScreen(c.x, c.y);
        ctx.font = `700 ${size}px Georgia, serif`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(20,15,10,0.6)';
        const label = f.short.toUpperCase().split('').join(' ');
        ctx.strokeText(label, sx, sy);
        ctx.fillStyle = 'rgba(255,248,230,0.9)';
        ctx.fillText(label, sx, sy);
      }
      ctx.restore();
    }

    // Movement arrows.
    if (this.selArmy) {
      const from = s.provinces[this.selArmy.province];
      for (const n of this.moveTargets()) {
        const to = s.provinces[n];
        const occ = armyAt(s, n);
        const enemy = (occ && occ.owner !== PLAYER) || (to.owner !== PLAYER);
        const atPeace = enemy && !hostile(s, PLAYER, occ && occ.owner !== PLAYER ? occ.owner : to.owner);
        const color = atPeace ? '#c9c2b0' : occ && occ.owner !== PLAYER ? '#ff6b5b' : enemy ? '#ffd27a' : '#ffffff';
        this.drawArrow(ctx, from.x, from.y, to.x, to.y, color);
      }
    }

    const icon = Math.max(6, Math.min(14, 5 + 4 * z));
    for (const p of s.provinces) {
      const [sx, sy] = this.toScreen(p.x, p.y);
      if (sx < -40 || sy < -40 || sx > VIEW_W + 40 || sy > VIEW_H + 40) continue;
      this.drawSettlement(ctx, p, sx, sy, icon);
      const showName = z >= 0.85 || (p.capitalOf >= 0 && z >= 0.5) || p.id === this.selProv;
      if (showName) {
        ctx.font = p.capitalOf >= 0 ? '700 12px Georgia, serif' : '600 11px Georgia, serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(245,238,220,0.85)';
        ctx.strokeText(p.name, sx, sy + icon + 7);
        ctx.fillStyle = '#2a2216';
        ctx.fillText(p.name, sx, sy + icon + 7);
      }
    }
    for (const a of s.armies) this.drawArmy(ctx, a, icon);
    this.drawTooltip(ctx);
  }

  private drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
    const [ax, ay] = this.toScreen(x0 + (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.2);
    const [bx, by] = this.toScreen(x0 + (x1 - x0) * 0.72, y0 + (y1 - y0) * 0.72);
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.save();
    ctx.lineCap = 'round';
    for (const [w, c] of [[6, 'rgba(20,15,10,0.6)'], [3, color]] as const) {
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      const hs = w === 6 ? 13 : 10;
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(ang) * hs * 0.6, by + Math.sin(ang) * hs * 0.6);
      ctx.lineTo(bx + Math.cos(ang + 2.4) * hs, by + Math.sin(ang + 2.4) * hs);
      ctx.lineTo(bx + Math.cos(ang - 2.4) * hs, by + Math.sin(ang - 2.4) * hs);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawSettlement(ctx: CanvasRenderingContext2D, p: Province, x: number, y: number, s: number) {
    const f = this.state.factions[p.owner];
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = f.color;
    ctx.strokeStyle = '#1d160e';
    ctx.lineWidth = p.walls >= 3 ? 2 : 1.2;
    ctx.beginPath();
    if (p.kind === 'fort') {
      // Keep with three merlons.
      const w = s;
      const t = -s * 0.55;
      const m = w / 5;
      ctx.moveTo(-w / 2, s * 0.45);
      ctx.lineTo(-w / 2, t);
      for (let i = 0; i < 5; i++) {
        const x0 = -w / 2 + i * m;
        if (i % 2 === 0) {
          ctx.lineTo(x0 + m, t);
        } else {
          ctx.lineTo(x0, t + m);
          ctx.lineTo(x0 + m, t + m);
          ctx.lineTo(x0 + m, t);
        }
      }
      ctx.lineTo(w / 2, s * 0.45);
      ctx.closePath();
    } else {
      // Town: base with a dome (ports get a mooring post).
      ctx.rect(-s * 0.5, -s * 0.1, s, s * 0.55);
      ctx.moveTo(s * 0.32, -s * 0.1);
      ctx.arc(0, -s * 0.1, s * 0.32, 0, Math.PI, true);
    }
    ctx.fill();
    ctx.stroke();
    if (p.kind === 'port') {
      ctx.strokeStyle = '#1d160e';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(s * 0.7, -s * 0.4);
      ctx.lineTo(s * 0.7, s * 0.4);
      ctx.moveTo(s * 0.45, s * 0.25);
      ctx.quadraticCurveTo(s * 0.7, s * 0.6, s * 0.95, s * 0.25);
      ctx.stroke();
    }
    if (p.capitalOf >= 0) {
      ctx.fillStyle = '#ffd86b';
      ctx.font = `${Math.round(s * 1.1)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillText('♛', 0, -s * 1.05);
    }
    if (p.siege) {
      ctx.strokeStyle = '#ff5a4a';
      ctx.lineWidth = 2;
      const r = s * 0.9;
      ctx.beginPath();
      ctx.moveTo(-r - 4, -r);
      ctx.lineTo(-4 + r * 0.2, r * 0.2);
      ctx.moveTo(-4 + r * 0.2 - 2 * r - 4, r * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 1.1, 0, Math.PI * 2);
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.devastated > 0) {
      ctx.font = `${Math.round(s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🔥', s * 0.9, s * 0.2);
    }
    ctx.restore();
  }

  private armyRect(a: Army, icon: number) {
    const p = this.state.provinces[a.province];
    const [sx, sy] = this.toScreen(p.x, p.y);
    const k = Math.max(0.8, Math.min(1.15, 0.7 + this.cam.z * 0.3));
    const w = 34 * k;
    const hh = 17 * k;
    // Besiegers camp below the walls; others stand beside the town.
    const x = a.siegeOf >= 0 ? sx - w / 2 : sx + icon * 0.6;
    const y = a.siegeOf >= 0 ? sy + icon * 0.9 : sy - icon * 0.6 - hh;
    return { x, y, w, h: hh };
  }

  private drawArmy(ctx: CanvasRenderingContext2D, a: Army, icon: number) {
    const r = this.armyRect(a, icon);
    if (r.x < -50 || r.y < -50 || r.x > VIEW_W + 50 || r.y > VIEW_H + 50) return;
    const f = this.state.factions[a.owner];
    const sel = a === this.selArmy;
    ctx.save();
    ctx.fillStyle = '#3a2c1c';
    ctx.fillRect(r.x - 1, r.y - 8, 2, r.h + 8);
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(r.x + 1, r.y - 8);
    ctx.lineTo(r.x + 11, r.y - 5);
    ctx.lineTo(r.x + 1, r.y - 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.roundRect(r.x + 2, r.y + 3, r.w, r.h, 4);
    ctx.fill();
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 4);
    ctx.fill();
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.strokeStyle = sel ? '#ffd86b' : 'rgba(20,15,10,0.85)';
    ctx.stroke();
    const light = f.rgb[0] * 0.3 + f.rgb[1] * 0.59 + f.rgb[2] * 0.11 > 170;
    ctx.fillStyle = light ? '#1d160e' : '#fff';
    ctx.font = `700 ${Math.round(r.h * 0.62)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmt(unitsMen(a.units)), r.x + r.w / 2, r.y + r.h / 2 + 0.5);
    if (a.owner === PLAYER && a.mp <= 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 4);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawTooltip(ctx: CanvasRenderingContext2D) {
    const p = this.hoverProv >= 0 && !this.ptr?.dragged ? this.state.provinces[this.hoverProv] : null;
    if (!p) return;
    const s = this.state;
    const occ = armyAt(s, p.id);
    const lines = [
      `${p.name} · ${s.factions[p.owner].short}`,
      `${p.town}: ${wallName(p.walls, p.kind, p.sea).toLowerCase()}`,
      `Garrison ${unitsMen(p.garrison)} · wealth ${p.wealth}${p.devastated ? ' (devastated)' : ''}`,
    ];
    if (p.siege) lines.push(`Under siege, ${Math.max(0, Math.ceil(p.supplies))} turns of food left`);
    if (occ) lines.push(`${s.factions[occ.owner].short} army: ${unitsMen(occ.units)} men`);
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
      if (sx >= r.x - 2 && sx <= r.x + r.w + 2 && sy >= r.y - 9 && sy <= r.y + r.h + 2) return a;
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
    if (button === 2 && !this.busy) this.command(x, y);
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
    if (!p || p.dragged || button !== 0 || modalOpen() || this.busy) return;
    this.click(x, y);
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
    } else if (k === 'enter') void this.endTurn();
    else if (k === 'escape') this.select(null, -1);
    else if (k === '=' || k === '+') this.zoomAt(VIEW_W / 2, VIEW_H / 2, 1.25);
    else if (k === '-') this.zoomAt(VIEW_W / 2, VIEW_H / 2, 0.8);
  }

  keyUp(e: KeyboardEvent) {
    this.keys.delete(e.key.toLowerCase());
  }

  private select(army: Army | null, prov: number) {
    this.selArmy = army;
    this.selProv = army ? army.province : prov;
    this.dirty = true;
    this.renderUI();
  }

  private click(x: number, y: number) {
    const a = this.armyHit(x, y);
    const sel = this.selArmy;
    if (sel && sel.owner === PLAYER && sel.mp > 0) {
      const target = a ? a.province : this.provAtScreen(x, y);
      if (target >= 0 && target !== sel.province && (!a || a.owner !== PLAYER)
        && this.state.provinces[sel.province].neighbors.includes(target)) {
        void this.tryMove(sel, target);
        return;
      }
    }
    if (a) this.select(a, -1);
    else this.select(null, this.provAtScreen(x, y));
  }

  /** Right-click: march the selected army. */
  private command(x: number, y: number) {
    const sel = this.selArmy;
    if (!sel || sel.owner !== PLAYER) return;
    const a = this.armyHit(x, y);
    const target = a ? a.province : this.provAtScreen(x, y);
    if (target < 0 || target === sel.province) return;
    if (!this.state.provinces[sel.province].neighbors.includes(target)) {
      log(this.state, 'Armies march one neighbouring province at a time.', true);
      this.renderUI();
      return;
    }
    if (sel.mp <= 0) {
      log(this.state, 'That army has no moves left this turn.', true);
      this.renderUI();
      return;
    }
    void this.tryMove(sel, target);
  }

  // ---------------------------------------------------------------- game flow

  private confirm(title: string, body: string, yes: string): Promise<boolean> {
    return new Promise((resolve) => {
      showModal(title, body, [
        { label: 'Cancel', onClick: () => { hideModal(); resolve(false); } },
        { label: yes, primary: true, onClick: () => { hideModal(); resolve(true); } },
      ]);
    });
  }

  private async tryMove(army: Army, target: number) {
    const s = this.state;
    const to = s.provinces[target];
    const occ = armyAt(s, target);
    const other = occ && occ.owner !== PLAYER ? occ.owner : to.owner !== PLAYER ? to.owner : -1;
    if (other >= 0 && other !== IND && !s.war[PLAYER][other]) {
      const allies = s.factions.filter((f) => f.alive && s.ally[other][f.id] && f.id !== PLAYER).map((f) => f.name);
      const ok = await this.confirm(`War with the ${s.factions[other].name}?`,
        `You are at peace with the ${s.factions[other].name}. Marching into ${to.name} means war.${allies.length ? ` Their allies (${allies.join(', ')}) will join them.` : ''}`,
        'Declare war');
      if (!ok) return;
      declareWar(s, PLAYER, other);
    }
    this.busy = true;
    this.renderUI();
    await this.flow.moveArmy(army, target);
    this.busy = false;
    if (this.selArmy && !s.armies.includes(this.selArmy)) this.selArmy = null;
    this.selProv = this.selArmy ? this.selArmy.province : target;
    this.dirty = true;
    this.renderUI();
    this.checkOver();
  }

  private async endTurn() {
    if (this.busy || this.state.over || modalOpen()) return;
    const s = this.state;
    const from = s.turn;
    this.busy = true;
    this.selArmy = null;
    this.dirty = true;
    this.renderUI();
    await this.flow.endTurn();
    this.busy = false;
    this.dispatch = s.log.filter((l) => l.mine && l.turn >= from);
    this.dirty = true;
    this.renderUI();
    this.checkOver();
  }

  private async assault(army: Army) {
    const p = this.state.provinces[army.siegeOf];
    if (!p) return;
    this.busy = true;
    this.renderUI();
    await this.flow.assault(army, p);
    this.busy = false;
    if (!this.state.armies.includes(army)) this.selArmy = null;
    this.dirty = true;
    this.renderUI();
    this.checkOver();
  }

  private checkOver() {
    const over = this.state.over;
    if (!over) return;
    const s = this.state;
    showModal(
      over === 'won' ? 'Hindavi Swarajya!' : 'Swarajya has fallen',
      over === 'won'
        ? `By ${dateLabel(s.turn)} the Maratha banner flies over ${provincesOf(s, PLAYER).length} provinces. The empire bends; the people are free.`
        : 'The last Maratha fort has fallen. But hill forts have a way of changing hands again...',
      [{ label: 'New campaign', primary: true, onClick: () => { hideModal(); app.setScene(new CampaignScene(newGame(Math.floor(Math.random() * 1e9)))); } }],
    );
  }

  private terrainAt(p: Province): Terrain {
    const { elev, moist } = this.state.map;
    const i = Math.floor(p.y / CELL) * MW + Math.floor(p.x / CELL);
    if (elev[i] > 0.32 || (p.kind === 'fort' && p.walls >= 3 && !p.sea)) return 'hills';
    if (moist[i] > 0.68) return 'forest';
    if (moist[i] < 0.3) return 'desert';
    return 'plains';
  }

  // ---------------------------------------------------------------- battles

  private hooks(): Hooks {
    return {
      fieldBattle: (att, defUnits, defOwner, p) => this.battlePrompt('field', att, defUnits, defOwner, p),
      siegeBattle: (att, p) => this.battlePrompt('siege', att, p.garrison, p.owner, p),
      chooseSack: (p) => this.sackPrompt(p),
      changed: () => {
        this.dirty = true;
      },
    };
  }

  private battlePrompt(mode: 'field' | 'siege', att: Army, defUnits: CUnit[], defOwner: number, p: Province): Promise<boolean> {
    const s = this.state;
    if (defUnits.length === 0) return Promise.resolve(true);
    const playerAttacks = att.owner === PLAYER;
    const mine = playerAttacks ? att.units : defUnits;
    const theirs = playerAttacks ? defUnits : att.units;
    const enemy = s.factions[playerAttacks ? defOwner : att.owner];
    const siege = mode === 'siege';
    const garrison = defUnits === p.garrison;
    const title = siege ? `Siege of ${p.town}` : garrison ? `Storming ${p.town}` : `Battle of ${p.name}`;
    const eq = p.siege?.equipment ?? 0;
    const wallK = siege ? wallFactor(p, att.units, eq) : 1;
    const ms = unitsStrength(mine) * (playerAttacks ? 1 : wallK * 1.1);
    const ts = unitsStrength(theirs) * (playerAttacks ? wallK * 1.1 : 1);
    const ratio = ms / Math.max(1, ts);
    const odds = ratio > 1.8 ? 'Overwhelming' : ratio > 1.2 ? 'Favourable' : ratio > 0.85 ? 'Even' : ratio > 0.55 ? 'Unfavourable' : 'Desperate';
    const sideCard = (units: CUnit[], f: number, label: string) => h('div', { class: 'card' },
      h('h3', {}, swatch(s.factions[f].color), label),
      ...summarize(units).map((l) => h('div', { class: 'muted' }, l)),
      h('div', { style: 'margin-top:4px' }, `${unitsMen(units)} men`),
    );
    let intro: string;
    if (siege) intro = playerAttacks
      ? `Your army storms the ${wallName(p.walls, p.kind, p.sea).toLowerCase()} of ${p.town}. Siege equipment: ${EQUIPMENT[eq]}.`
      : `The ${enemy.short} assault ${p.town}! Its garrison must hold the walls.`;
    else intro = playerAttacks ? `Your army attacks the ${enemy.short} at ${p.name}.` : `The ${enemy.short} attack your army at ${p.name}!`;
    const body = h('div', {},
      h('p', {}, intro),
      isMonsoon(s.turn) ? h('p', { class: 'muted' }, '🌧 Monsoon rain: bows and matchlocks will suffer.') : null,
      h('p', { class: 'muted' }, `Estimated odds: ${odds}.`),
      h('div', { class: 'versus' }, sideCard(mine, PLAYER, playerAttacks ? 'Your army' : siege ? 'Your garrison' : 'Your army'), sideCard(theirs, enemy.id, enemy.short)),
    );

    return new Promise((resolve) => {
      const done = (playerWon: boolean) => {
        log(s, playerWon ? `Victory at ${siege ? p.town : p.name}!` : `Defeat at ${siege ? p.town : p.name}.`, true);
        resolve(playerAttacks ? playerWon : !playerWon);
      };
      showModal(title, body, [
        {
          label: 'Auto-resolve',
          onClick: () => {
            hideModal();
            const won = siege ? autoResolveSiege(s, att.units, p) : autoResolve(s, att.units, defUnits);
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
              seed: s.seed * 31 + s.turn * 7 + p.id, terrain: this.terrainAt(p), rain: isMonsoon(s.turn),
              walls: siege ? p.walls : 0, ladders: eq >= 1, ram: eq >= 2,
              playerFaction: s.factions[PLAYER], enemyFaction: enemy,
              onDone: (playerWon) => {
                app.setScene(this);
                done(playerWon);
              },
            }));
          },
        },
      ]);
    });
  }

  private sackPrompt(p: Province): Promise<boolean> {
    const loot = Math.round(p.wealth * 8);
    return new Promise((resolve) => {
      showModal(`${p.town} has fallen`, h('div', {},
        h('p', {}, `${p.name} is yours. What becomes of ${p.town}?`),
        h('ul', { class: 'help' },
          h('li', {}, h('b', {}, 'Occupy: '), `keep the town whole. It pays ${p.wealth} gold a turn from now on.`),
          h('li', {}, h('b', {}, 'Sack: '), `seize about ${loot} gold now. The province is devastated for 6 turns and loses much of its wealth for good.`),
        ),
      ), [
        { label: `Sack (+${loot} gold)`, onClick: () => { hideModal(); resolve(true); } },
        { label: 'Occupy', primary: true, onClick: () => { hideModal(); resolve(false); } },
      ]);
    });
  }

  // ---------------------------------------------------------------- diplomacy

  private openDiplomacy() {
    const s = this.state;
    const mine = factionStrength(s, PLAYER) + 1;
    const rows = s.factions.filter((f) => f.id !== PLAYER && f.id !== IND && f.alive).map((f) => {
      const war = s.war[PLAYER][f.id];
      const allies = s.factions.filter((o) => s.ally[f.id][o.id] && o.alive).map((o) => o.short);
      const str = factionStrength(s, f.id);
      return h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('span', {}, swatch(f.color), h('b', {}, f.name)),
          h('span', { class: war ? 'neg' : 'pos' }, war ? 'At war' : 'At peace')),
        h('div', { class: 'row muted' },
          h('span', {}, `${provincesOf(s, f.id).length} provinces · armies ${str > mine * 1.5 ? 'far stronger' : str > mine ? 'stronger' : str > mine * 0.6 ? 'comparable' : 'weaker'}`),
          allies.length ? h('span', {}, `Allied: ${allies.join(', ')}`) : null),
        h('div', { class: 'btns' },
          war
            ? h('button', { class: 'small', disabled: this.peaceTried.get(f.id) === s.turn, onclick: () => this.offerPeace(f.id) },
              this.peaceTried.get(f.id) === s.turn ? 'Envoys refused this turn' : 'Send envoys for peace')
            : h('button', { class: 'small', onclick: () => { declareWar(s, PLAYER, f.id); this.dirty = true; this.renderUI(); this.openDiplomacy(); } }, 'Declare war')),
      );
    });
    showModal('Diplomacy', h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Independent chiefs (grey) may be attacked at any time without a declaration.'),
      ...rows,
    ), [{ label: 'Close', primary: true, onClick: hideModal }]);
  }

  private offerPeace(f: number) {
    const s = this.state;
    if (acceptsPeace(s, f, PLAYER)) {
      makePeace(s, PLAYER, f);
      this.dirty = true;
    } else {
      this.peaceTried.set(f, s.turn);
      log(s, `The ${s.factions[f].name} sends your envoys away.`, true);
    }
    this.renderUI();
    this.openDiplomacy();
  }

  // ---------------------------------------------------------------- side panel

  renderUI() {
    const s = this.state;
    const me = s.factions[PLAYER];
    const net = netIncome(s, PLAYER);
    const top = clear(ui.top);
    top.append(
      h('div', { class: 'brand' }, '🚩 Swarajya'),
      h('div', { class: 'stat' }, swatch(me.color), me.short),
      h('div', { class: 'stat' }, `${isMonsoon(s.turn) ? '🌧 ' : ''}${dateLabel(s.turn)}`),
      h('div', { class: 'stat' }, `💰 ${s.gold[PLAYER]}`, h('span', { class: net >= 0 ? 'pos' : 'neg' }, `(${net >= 0 ? '+' : ''}${net})`)),
      h('div', { class: 'stat', title: `Victory: hold ${VICTORY_PROVINCES} provinces, or take Delhi` }, `🏰 ${provincesOf(s, PLAYER).length}/${VICTORY_PROVINCES}`),
      h('button', { class: 'push', onclick: () => this.openDiplomacy(), disabled: this.busy }, 'Diplomacy'),
      h('button', { class: 'primary', onclick: () => void this.endTurn(), disabled: this.busy || !!s.over }, this.busy ? 'Rivals are moving…' : 'End turn ⏎'),
    );
    const side = clear(ui.side);
    if (this.dispatch.length) side.append(this.dispatchCard());
    side.append(this.selectionCard(), this.realmCard(), this.logCard());
  }

  private dispatchCard(): HTMLElement {
    return h('div', { class: 'card', style: 'border-color:#8a6a2a' },
      h('div', { class: 'row' }, h('h3', {}, `📜 Dispatches, ${seasonOf(this.state.turn)}`),
        h('button', { class: 'small', onclick: () => { this.dispatch = []; this.renderUI(); } }, 'Dismiss')),
      h('div', { class: 'log' }, ...this.dispatch.slice(-8).map((l) => h('div', {}, l.text))),
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
        h('li', {}, 'Drag to pan, scroll to zoom. Click your saffron banner, then a neighbouring province to march.'),
        h('li', {}, 'Walled towns must be besieged: starve them out, or storm them once you have ladders. Mavalas bring ladders from day one.'),
        h('li', {}, 'Raid enemy lands for gold (chauth). Sack captured towns for a fortune, or occupy them for steady income.'),
        h('li', {}, 'An all-horse army marches two provinces a turn. In the monsoon everyone slows down.'),
        h('li', {}, `Win by holding ${VICTORY_PROVINCES} provinces or taking Delhi.`),
      ),
    );
  }

  private unitList(units: CUnit[]): HTMLElement {
    return h('div', { class: 'stack', style: 'margin-top:6px' }, ...units.map((u) => {
      const st = UNIT_STATS[u.type];
      return h('div', { class: 'unit-row', title: st.blurb },
        h('div', { class: 'row' }, h('span', {}, `${st.glyph} ${st.name}`), h('span', { class: 'muted' }, `${u.men}/${st.maxMen}`)),
        bar(u.men / st.maxMen),
      );
    }));
  }

  private armyCard(a: Army): HTMLElement {
    const s = this.state;
    const f = s.factions[a.owner];
    const mine = a.owner === PLAYER;
    const p = s.provinces[a.province];
    const parts: (HTMLElement | null)[] = [
      h('h3', {}, swatch(f.color), mine ? 'Your army' : `${f.short} army`),
      h('div', { class: 'muted' }, `At ${p.name} · ${unitsMen(a.units)} men · ${a.units.length}/${MAX_UNITS} regiments${mine ? ` · moves ${a.mp}` : ''}`),
      this.unitList(a.units),
    ];
    if (mine) {
      if (a.siegeOf >= 0) parts.push(this.siegeBox(a));
      else if (p.owner !== PLAYER) parts.push(h('p', { class: 'muted' }, 'Camped in foreign land.'));
      else parts.push(h('p', { class: a.mp > 0 ? '' : 'muted' }, a.mp > 0
        ? 'Click or right-click a neighbouring province to march. Red arrows mean battle, gold means enemy land, grey means a realm at peace.'
        : 'This army has marched this turn.'));
      if (p.owner !== PLAYER && hostile(s, PLAYER, p.owner) && a.siegeOf < 0) parts.push(this.raidButton(a));
      if (p.owner === PLAYER && !p.siege) parts.push(this.recruitButtons(p));
    }
    return h('div', { class: 'card' }, ...parts);
  }

  private raidButton(a: Army): HTMLElement {
    const p = this.state.provinces[a.province];
    return h('button', {
      class: 'small', disabled: a.raided || this.busy,
      title: 'Plunder the countryside: gold now, and the province pays its owner nothing for 3 turns.',
      onclick: () => { raid(this.state, a); this.dirty = true; this.renderUI(); },
    }, a.raided ? 'Already raided this turn' : `🔥 Raid ${p.name} (chauth)`);
  }

  private siegeBox(a: Army): HTMLElement {
    const s = this.state;
    const p = s.provinces[a.siegeOf];
    const sg = p.siege!;
    const breakers = a.units.filter((u) => u.type === 'cannon' || u.type === 'elephant').length;
    return h('div', { class: 'card', style: 'margin-top:10px;background:#2f2418' },
      h('h3', {}, `🏰 Siege of ${p.town}`),
      h('div', { class: 'muted' }, `${wallName(p.walls, p.kind, p.sea)} · turn ${sg.turns} of the siege`),
      h('div', { class: 'muted' }, `Garrison ${unitsMen(p.garrison)} men · food for ${Math.max(0, Math.ceil(p.supplies))} more turns`),
      h('div', { class: 'muted' }, `Equipment: ${EQUIPMENT[sg.equipment]}${breakers ? ` · ${breakers} gate-breakers (guns/elephants)` : ''}`),
      sg.equipment === 0 && !breakers ? h('p', { class: 'neg', style: 'font-size:12.5px' }, 'Without ladders, a ram, guns or elephants your men can only hack at the gate.') : null,
      h('div', { class: 'btns' },
        h('button', { class: 'small primary', disabled: this.busy || sg.lastAssault === s.turn, onclick: () => void this.assault(a) },
          sg.lastAssault === s.turn ? 'Assaulted this turn' : '⚔ Assault'),
        this.raidButton(a),
        h('button', { class: 'small', disabled: this.busy, onclick: () => { liftSiege(s, p); this.dirty = true; this.renderUI(); } }, 'Lift siege'),
      ),
      h('p', { class: 'muted', style: 'font-size:12px' }, 'Or wait: each turn the besieged eat their stores, and your carpenters build ladders, then a ram.'),
    );
  }

  private recruitButtons(p: Province): HTMLElement {
    const s = this.state;
    const occ = armyAt(s, p.id);
    const full = !!occ && occ.units.length >= MAX_UNITS;
    return h('div', { style: 'margin-top:10px' },
      h('div', { class: 'muted' }, full ? 'Army is at full strength.' : `Raise regiments at ${p.name}:`),
      h('div', { class: 'btns' },
        ...s.factions[PLAYER].roster.map((t: UnitType) => {
          const st = UNIT_STATS[t];
          return h('button', {
            class: 'small', title: `${st.blurb} Upkeep ${st.upkeep}/turn.`,
            disabled: full || s.gold[PLAYER] < st.cost || this.busy,
            onclick: () => {
              const err = recruit(s, p, t);
              if (err) log(s, err, true);
              const a = armyAt(s, p.id);
              if (a) this.selArmy = a;
              this.dirty = true;
              this.renderUI();
            },
          }, `${st.glyph} ${st.short} ${st.cost}`);
        }),
      ),
    );
  }

  private provinceCard(p: Province): HTMLElement {
    const s = this.state;
    const f = s.factions[p.owner];
    const occ = armyAt(s, p.id);
    const mine = p.owner === PLAYER;
    const income = Math.round(provinceIncome(s, p));
    const parts: (HTMLElement | null)[] = [
      h('h3', {}, p.capitalOf >= 0 ? `♛ ${p.name}` : p.name),
      h('div', { class: 'muted' }, `${p.region}`),
      h('div', { class: 'row', style: 'margin-top:4px' }, h('span', {}, swatch(f.color), f.name),
        p.owner !== PLAYER && p.owner !== IND ? h('span', { class: s.war[PLAYER][p.owner] ? 'neg' : 'pos' }, s.war[PLAYER][p.owner] ? 'at war' : 'at peace') : null),
      h('p', {}, h('b', {}, p.town), ` · ${wallName(p.walls, p.kind, p.sea)}${p.kind === 'port' ? ' · port' : ''}`),
      h('div', { class: 'row muted' }, h('span', {}, `Wealth ${p.wealth}`), h('span', {}, income ? `+${income} gold/turn` : p.devastated ? `devastated (${p.devastated} turns)` : p.siege ? 'besieged' : '')),
      h('div', { class: 'row muted' }, h('span', {}, `Food stores ${Math.max(0, Math.ceil(p.supplies))}/${maxSupplies(p)}`), h('span', {}, `Garrison ${unitsMen(p.garrison)}`)),
      p.garrison.length ? this.unitList(p.garrison) : null,
      p.siege ? h('p', { class: 'neg' }, `Besieged by the ${s.factions[s.armies.find((x) => x.id === p.siege!.army)?.owner ?? 0].short} (turn ${p.siege.turns}).`) : null,
      occ ? h('div', { class: 'btns' }, h('button', { class: 'small', onclick: () => this.select(occ, -1) }, `Select ${s.factions[occ.owner].short} army (${unitsMen(occ.units)})`)) : null,
    ];
    if (mine && !p.siege) {
      parts.push(this.recruitButtons(p));
      const err = canBuild(s, p);
      parts.push(h('div', { style: 'margin-top:10px' },
        h('div', { class: 'muted' }, err && err !== 'Under siege.' ? err : 'Build (one project per turn):'),
        h('div', { class: 'btns' },
          h('button', {
            class: 'small', disabled: !!err || p.walls >= maxWalls(p) || s.gold[PLAYER] < wallsCost(p),
            title: 'Stronger walls: a bigger garrison, more food, and a harder siege.',
            onclick: () => { const e = buildWalls(s, p); if (e) log(s, e, true); this.renderUI(); },
          }, p.walls >= maxWalls(p) ? 'Walls at maximum' : `🧱 Walls ${wallsCost(p)}`),
          h('button', {
            class: 'small', disabled: !!err || p.wealth >= maxWealth(p) || s.gold[PLAYER] < marketCost(p),
            title: '+1 wealth: more gold every turn.',
            onclick: () => { const e = buildMarket(s, p); if (e) log(s, e, true); this.renderUI(); },
          }, p.wealth >= maxWealth(p) ? 'Market at maximum' : `🏪 Market ${marketCost(p)}`),
        ),
      ));
    }
    return h('div', { class: 'card' }, ...parts);
  }

  private realmCard(): HTMLElement {
    const s = this.state;
    const regions = [...regionOwners(s)].filter(([, o]) => o === PLAYER).map(([r]) => r);
    const armies = s.armies.filter((a) => a.owner === PLAYER);
    return h('div', { class: 'card' },
      h('h3', {}, 'Swarajya'),
      h('div', { class: 'row muted' }, h('span', {}, 'Revenue'), h('span', {}, `+${grossIncome(s, PLAYER)}`)),
      h('div', { class: 'row muted' }, h('span', {}, 'Army upkeep'), h('span', {}, `-${upkeep(s, PLAYER)}`)),
      h('div', { class: 'row muted' }, h('span', {}, 'Provinces'), h('span', {}, `${provincesOf(s, PLAYER).length} of ${VICTORY_PROVINCES} for victory`)),
      h('div', { class: 'muted' }, regions.length ? `Whole regions held (+25% revenue): ${regions.join(', ')}` : 'Hold every province of a region for +25% revenue there.'),
      armies.length ? h('div', { class: 'btns' }, ...armies.map((a) =>
        h('button', { class: 'small', onclick: () => { this.select(a, -1); this.centerOn(s.provinces[a.province]); } },
          `${s.provinces[a.province].name} (${fmt(unitsMen(a.units))})`))) : null,
    );
  }

  private centerOn(p: Province) {
    this.cam.x = p.x - VIEW_W / 2 / this.cam.z;
    this.cam.y = p.y - VIEW_H / 2 / this.cam.z;
    this.clampCam();
  }

  private logCard(): HTMLElement {
    return h('div', { class: 'card' },
      h('h3', {}, 'Chronicle'),
      h('div', { class: 'log' }, ...this.state.log.slice(-14).reverse().map((l) =>
        h('div', { style: l.mine ? 'color:var(--ink)' : '' }, `${dateLabel(l.turn)} · ${l.text}`))),
    );
  }
}

function summarize(units: CUnit[]): string[] {
  const counts = new Map<UnitType, { n: number; men: number }>();
  for (const u of units) {
    const c = counts.get(u.type) ?? { n: 0, men: 0 };
    c.n++;
    c.men += u.men;
    counts.set(u.type, c);
  }
  return [...counts].map(([t, c]) => `${UNIT_STATS[t].glyph} ${c.n}× ${UNIT_STATS[t].short} (${c.men})`);
}

