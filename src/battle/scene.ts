import { type Scene, VIEW_H, VIEW_W } from '../app';
import { bar, clear, fill, h, hideModal, modalOpen, showModal, swatch, ui } from '../ui';
import { fbm, makeNoise } from '../noise';
import { RNG } from '../rng';
import { UNIT_STATS } from '../data';
import { drawTileSymbol, inkFor, symbolEl, tierBadge } from '../symbols';
import type { CUnit, Faction } from '../campaign/state';
import { Battle, type BUnit, FIELD_H, FIELD_W, radiusOf, type Terrain } from './battle';
import { planSide } from './ai';

export interface BattleSetup {
  mode: 'field' | 'siege';
  playerUnits: CUnit[];
  enemyUnits: CUnit[];
  playerAttacks: boolean;
  title: string;
  seed: number;
  terrain: Terrain;
  rain: boolean;
  walls: number;
  ladders: boolean;
  ram: boolean;
  river?: boolean;
  marsh?: boolean;
  /** Where the battle is fought, written across the field. */
  place?: string;
  playerGeneral?: string;
  enemyGeneral?: string;
  playerFaction: Faction;
  enemyFaction: Faction;
  onDone(playerWon: boolean): void;
}

const STEP = 1 / 60;
const AI_EVERY = 1.5;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string }

export class BattleScene implements Scene {
  private b: Battle;
  private s: BattleSetup;
  private phase: 'deploy' | 'live' | 'done' = 'deploy';
  private paused = false;
  private speed = 1;
  private acc = 0;
  private aiT = 0;
  private uiT = 0;
  private t = 0;
  private selected = new Set<number>();
  private drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** A path being drawn with the right mouse button (or a long press), in world coords. */
  private sketch: [number, number][] | null = null;
  private mouse = { x: -100, y: -100 };
  /** Mouse position on the battlefield (world coords). */
  private mouseW = { x: -100, y: -100 };
  /** Battle camera: world position of the view's top-left, and zoom. Starts showing the whole field. */
  private cam = { x: 0, y: 0, z: VIEW_W / FIELD_W };
  private keys = new Set<string>();
  private panDrag: { x: number; y: number } | null = null;
  private bg: HTMLCanvasElement;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private notice = '';
  private noticeT = 0;
  private particles: Particle[] = [];
  private seenShots = new WeakSet<object>();

  constructor(setup: BattleSetup) {
    this.s = setup;
    this.b = new Battle(setup.playerUnits, setup.enemyUnits, {
      mode: setup.mode, playerAttacks: setup.playerAttacks, seed: setup.seed, terrain: setup.terrain,
      rain: setup.rain, walls: setup.walls, ladders: setup.ladders, ram: setup.ram, river: setup.river, marsh: setup.marsh,
    });
    this.bg = renderBattlefield(this.b, setup);

  }

  enter() {
    this.renderUI();
  }

  // ---------------------------------------------------------------- loop

  update(dt: number) {
    this.t += dt;
    if (this.keys.size) {
      const k = this.keys;
      const pan = (700 / this.cam.z) * dt;
      if (k.has('arrowleft') || k.has('a')) this.cam.x -= pan;
      if (k.has('arrowright') || k.has('d')) this.cam.x += pan;
      if (k.has('arrowup') || k.has('w')) this.cam.y -= pan;
      if (k.has('arrowdown') || k.has('s')) this.cam.y += pan;
      this.clampCam();
    }
    this.noticeT = Math.max(0, this.noticeT - dt);
    if (this.phase !== 'live' || this.paused || modalOpen()) return;
    this.acc = Math.min(this.acc + dt * this.speed, 0.5);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.aiT -= STEP;
      if (this.aiT <= 0) {
        planSide(this.b, 1);
        this.aiT = AI_EVERY;
      }
      this.b.step(STEP);
      if (this.b.winner >= 0) {
        this.finish(this.b.winner === 0);
        return;
      }
    }
    this.spawnParticles(dt);
    this.uiT += dt;
    if (this.uiT > 0.3) {
      this.uiT = 0;
      this.refreshStatus();
    }
  }

  private start() {
    if (this.phase !== 'deploy') return;
    this.phase = 'live';
    planSide(this.b, 1);
    this.aiT = AI_EVERY;
    this.renderUI();
  }

  private finish(won: boolean, retreated = false) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    const before = [0, 0];
    for (const u of this.b.units) before[u.side] += u.startMen;
    this.b.applyResults(won ? 0 : 1, retreated);
    const after = [0, 0];
    for (const u of this.b.units) after[u.side] += u.ref.men;
    this.renderUI();
    const s = this.s;
    const siege = s.mode === 'siege';
    let text: string;
    if (retreated) text = 'You sound the retreat. The army withdraws, bloodied but intact.';
    else if (siege && won) text = s.playerAttacks ? 'The defenders break. The settlement is yours to take.' : 'The assault is thrown back from the walls!';
    else if (siege) text = s.playerAttacks ? 'The assault fails beneath the walls.' : 'The enemy is inside the walls. The settlement falls.';
    else text = won ? `The ${s.enemyFaction.short} break and flee the field.` : 'Your lines break and scatter.';
    showModal(won ? 'Victory!' : 'Defeat', h('div', {},
      h('p', {}, text),
      h('div', { class: 'versus' },
        h('div', { class: 'card' }, h('h3', {}, swatch(s.playerFaction.color), 'Your losses'), h('div', {}, `${before[0] - after[0]} of ${before[0]} men`)),
        h('div', { class: 'card' }, h('h3', {}, swatch(s.enemyFaction.color), 'Enemy losses'), h('div', {}, `${before[1] - after[1]} of ${before[1]} men`)),
      ),
    ), [{ label: 'Return to the campaign map', primary: true, onClick: () => { hideModal(); s.onDone(won); } }]);
  }

  private say(msg: string) {
    this.notice = msg;
    this.noticeT = 2.5;
  }

  // ---------------------------------------------------------------- input

  private minZoom() {
    return Math.min(VIEW_W / FIELD_W, VIEW_H / FIELD_H);
  }

  private clampCam() {
    const c = this.cam;
    c.z = Math.max(this.minZoom(), Math.min(2.5, c.z));
    c.x = Math.max(0, Math.min(FIELD_W - VIEW_W / c.z, c.x));
    c.y = Math.max(0, Math.min(FIELD_H - VIEW_H / c.z, c.y));
  }

  private toW(sx: number, sy: number): [number, number] {
    return [this.cam.x + sx / this.cam.z, this.cam.y + sy / this.cam.z];
  }

  wheel(x: number, y: number, dy: number) {
    const [wx, wy] = this.toW(x, y);
    this.cam.z *= Math.exp(-dy * 0.0015);
    this.clampCam();
    this.cam.x = wx - x / this.cam.z;
    this.cam.y = wy - y / this.cam.z;
    this.clampCam();
  }

  keyUp(e: KeyboardEvent) {
    this.keys.delete(e.key.toLowerCase());
  }

  private unitAt(x: number, y: number, side: 0 | 1): BUnit | null {
    let best: BUnit | null = null;
    let bd = 28 / Math.min(1, this.cam.z);
    for (const u of this.b.units) {
      if (u.side !== side || u.state !== 'ok') continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  private segAtPoint(x: number, y: number): number {
    const W = this.b.walls;
    if (!W || y < W.y - 12 || y > W.y + W.t + 12) return -1;
    return Math.max(0, Math.min(W.segs.length - 1, Math.floor(x / (FIELD_W / W.segs.length))));
  }

  pointerDown(sx: number, sy: number, button: number, e: PointerEvent) {
    if (this.phase === 'done' || modalOpen()) return;
    if (button === 1) {
      this.panDrag = { x: sx, y: sy };
      return;
    }
    const [x, y] = this.toW(sx, sy);
    if (button === 2) {
      // Start sketching a path; a plain right-click (no drag) becomes an ordinary order on release.
      if (this.phase === 'live' && this.mySelected().length) this.sketch = [[x, y]];
      else this.issueOrder(x, y);
      return;
    }
    if (button !== 0) return;
    const u = this.unitAt(x, y, 0);
    if (u) {
      if (e.shiftKey) {
        if (this.selected.has(u.id)) this.selected.delete(u.id);
        else this.selected.add(u.id);
      } else this.selected = new Set([u.id]);
    } else {
      this.drag = { x0: x, y0: y, x1: x, y1: y };
      if (!e.shiftKey) this.selected.clear();
    }
    this.refreshList();
  }

  pointerMove(sx: number, sy: number) {
    this.mouse = { x: sx, y: sy };
    const [x, y] = this.toW(sx, sy);
    this.mouseW = { x, y };
    if (this.panDrag) {
      this.cam.x -= (sx - this.panDrag.x) / this.cam.z;
      this.cam.y -= (sy - this.panDrag.y) / this.cam.z;
      this.panDrag = { x: sx, y: sy };
      this.clampCam();
      return;
    }
    if (this.sketch) {
      const [lx, ly] = this.sketch[this.sketch.length - 1];
      if (Math.hypot(x - lx, y - ly) > 14 / Math.min(1, this.cam.z)) this.sketch.push([x, y]);
      return;
    }
    if (this.drag) {
      this.drag.x1 = x;
      this.drag.y1 = y;
    }
  }

  pointerUp(sx = 0, sy = 0, button = 0) {
    this.panDrag = null;
    if (this.sketch) {
      const pts = this.sketch;
      this.sketch = null;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (len > 40) this.issuePath(pts);
      else this.issueOrder(pts[0][0], pts[0][1]);
      return;
    }
    void sx; void sy; void button;
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (Math.abs(d.x1 - d.x0) < 6 && Math.abs(d.y1 - d.y0) < 6) return;
    const [x0, x1] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)];
    const [y0, y1] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
    for (const u of this.b.units) {
      if (u.side === 0 && u.state === 'ok' && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) this.selected.add(u.id);
    }
    this.refreshList();
  }

  keyDown(e: KeyboardEvent) {
    if (modalOpen()) return;
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(k) && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      this.keys.add(k);
      return;
    }
    if (k === ' ') {
      e.preventDefault();
      if (this.phase === 'deploy') this.start();
      else if (this.phase === 'live') this.togglePause();
    } else if (k === 'escape') {
      this.selected.clear();
      this.refreshList();
    } else if (k === 'a' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.selected = new Set(this.b.units.filter((u) => u.side === 0 && u.state === 'ok').map((u) => u.id));
      this.refreshList();
    } else if (k === '1' || k === '2' || k === '3') {
      this.speed = Number(k);
      this.renderUI();
    } else if (k === 'h') {
      for (const u of this.mySelected()) u.order = { kind: 'hold' };
      this.refreshList();
    }
  }

  private togglePause() {
    this.paused = !this.paused;
    this.renderUI();
  }

  private mySelected(): BUnit[] {
    return this.b.units.filter((u) => this.selected.has(u.id) && u.state === 'ok' && u.side === 0);
  }

  /** Sends the selected regiments along a drawn path, keeping their formation; ending on an enemy attacks it. */
  private issuePath(pts: [number, number][]) {
    const sel = this.mySelected();
    if (!sel.length) return;
    const cx = sel.reduce((s, u) => s + u.x, 0) / sel.length;
    const cy = sel.reduce((s, u) => s + u.y, 0) / sel.length;
    const [ex, ey] = pts[pts.length - 1];
    const enemy = this.unitAt(ex, ey, 1);
    const clamp = (v: number, hi: number) => Math.max(15, Math.min(hi - 15, v));
    for (const u of sel) {
      // Each regiment walks the same curve, shifted by where it stands in the formation.
      const ox = sel.length === 1 ? 0 : u.x - cx;
      const oy = sel.length === 1 ? 0 : u.y - cy;
      const mine: [number, number][] = pts.slice(1).map(([x, y]) => [clamp(x + ox, FIELD_W), clamp(y + oy, FIELD_H)]);
      u.order = { kind: 'path', pts: mine, i: 0, then: enemy?.id };
      this.breakAway(u, enemy?.id);
    }
    this.refreshList();
  }

  private issueOrder(x: number, y: number) {
    const sel = this.mySelected();
    if (!sel.length) {
      this.say('Select a regiment first (left-click, or drag a box).');
      return;
    }
    const cx = sel.reduce((s, u) => s + u.x, 0) / sel.length;
    const cy = sel.reduce((s, u) => s + u.y, 0) / sel.length;
    const spot = (u: BUnit) => ({
      x: Math.max(15, Math.min(FIELD_W - 15, sel.length === 1 ? x : x + (u.x - cx))),
      y: Math.max(15, Math.min(FIELD_H - 15, sel.length === 1 ? y : y + (u.y - cy))),
    });

    if (this.phase === 'deploy') {
      const [y0, y1] = this.b.deployZone(0);
      for (const u of sel) {
        const p = spot(u);
        u.x = p.x;
        u.y = Math.max(y0, Math.min(y1, p.y));
      }
      return;
    }
    const enemy = this.unitAt(x, y, 1);
    if (enemy) {
      for (const u of sel) {
        u.order = { kind: 'attack', target: enemy.id };
        this.breakAway(u, enemy.id);
      }
      this.refreshList();
      return;
    }
    const seg = this.segAtPoint(x, y);
    const W = this.b.walls;
    if (W && seg >= 0 && this.b.attacker === 0 && W.segs[seg].hp > 0) {
      let any = false;
      for (const u of sel) {
        const st = UNIT_STATS[u.type];
        if (st.cls === 'artillery' || st.cls === 'elephant' || (W.segs[seg].gate && st.gate > 0)) {
          u.order = { kind: 'breach', seg };
          this.breakAway(u);
          any = true;
        }
      }
      if (any) {
        this.refreshList();
        return;
      }
      if (!W.segs[seg].gate) this.say('Only guns and elephants can batter a wall. Infantry can hack at the gate.');
    }
    for (const u of sel) {
      u.order = { kind: 'move', ...spot(u) };
      this.breakAway(u);
    }
    this.refreshList();
  }

  /** A regiment locked in melee and sent somewhere else breaks off the fight (unless it's already fighting its new target). */
  private breakAway(u: BUnit, target?: number) {
    if (!u.fighting) return;
    if (target !== undefined) {
      const t = this.b.get(target);
      if (t && Math.hypot(t.x - u.x, t.y - u.y) < 50) return;
    }
    this.b.disengage(u);
  }

  // ---------------------------------------------------------------- drawing

  private spawnParticles(dt: number) {
    for (const s of this.b.shots) {
      if (this.seenShots.has(s)) continue;
      this.seenShots.add(s);
      if (s.kind === 'musket' || s.kind === 'fizzle' || s.kind === 'cannon') {
        const n = s.kind === 'cannon' ? 10 : 6;
        for (let i = 0; i < n; i++) {
          this.particles.push({
            x: s.x0 + (Math.random() - 0.5) * 20, y: s.y0 + (Math.random() - 0.5) * 20,
            vx: (Math.random() - 0.5) * 12, vy: -6 - Math.random() * 8, life: 0,
            max: s.kind === 'cannon' ? 2.4 : 1.6, size: s.kind === 'cannon' ? 9 : 6, color: '235,232,222',
          });
        }
      }
      if (s.kind === 'cannon' || s.kind === 'rocket') {
        for (let i = 0; i < 6; i++) {
          this.particles.push({
            x: s.x1, y: s.y1, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0,
            max: 0.9, size: 5, color: '150,120,80',
          });
        }
      }
    }
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#1d1a12';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    const z = this.cam.z;
    ctx.transform(z, 0, 0, z, -this.cam.x * z, -this.cam.y * z);
    ctx.drawImage(this.bg, 0, 0, FIELD_W, FIELD_H);
    const b = this.b;
    // The place name, written large across the ground as on a battle map.
    ctx.save();
    ctx.translate(FIELD_W * 0.23, FIELD_H * 0.52);
    ctx.rotate(-0.28);
    ctx.font = 'italic 600 88px "EB Garamond", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,250,236,0.45)';
    ctx.fillText(this.s.place ?? this.s.title, 0, 0);
    ctx.restore();
    if (b.walls) this.drawWalls(ctx);

    if (this.phase === 'deploy') {
      const [y0, y1] = b.deployZone(0);
      ctx.save();
      ctx.fillStyle = 'rgba(255,240,200,0.07)';
      ctx.strokeStyle = 'rgba(255,240,200,0.35)';
      ctx.setLineDash([8, 6]);
      ctx.fillRect(4, y0, FIELD_W - 8, y1 - y0);
      ctx.strokeRect(4, y0, FIELD_W - 8, y1 - y0);
      ctx.restore();
    }

    // Orders for the player's selected regiments (and faintly for the rest).
    for (const u of b.units) {
      if (u.side !== 0 || u.state !== 'ok') continue;
      const alpha = this.selected.has(u.id) ? 0.9 : 0.25;
      ctx.save();
      ctx.lineWidth = 2;
      const o = u.order;
      if (o.kind === 'move') {
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(o.x, o.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(o.x, o.y, 5, 0, Math.PI * 2);
        ctx.stroke();
      } else if (o.kind === 'path') {
        ctx.strokeStyle = `rgba(255,236,160,${alpha})`;
        ctx.lineWidth = 2 / this.cam.z;
        ctx.setLineDash([8 / this.cam.z, 6 / this.cam.z]);
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        for (let i = o.i; i < o.pts.length; i++) ctx.lineTo(o.pts[i][0], o.pts[i][1]);
        ctx.stroke();
        ctx.setLineDash([]);
        const last = o.pts[o.pts.length - 1];
        if (last) {
          ctx.beginPath();
          ctx.arc(last[0], last[1], 5 / this.cam.z, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (o.kind === 'attack' || o.kind === 'breach') {
        const t = o.kind === 'attack' ? b.get(o.target) : b.segCenter(o.seg);
        if (t) {
          ctx.strokeStyle = `rgba(255,110,90,${alpha})`;
          ctx.beginPath();
          ctx.moveTo(u.x, u.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Continuous arrow fire.
    if (this.phase === 'live') {
      ctx.save();
      ctx.strokeStyle = 'rgba(40,30,20,0.75)';
      ctx.lineWidth = 1.1;
      for (const u of b.units) {
        if (u.aimId < 0) continue;
        const t = b.get(u.aimId);
        if (!t) continue;
        const ang = Math.atan2(t.y - u.y, t.x - u.x);
        for (let k = 0; k < 4; k++) {
          const f = (this.t * 1.4 + k / 4 + u.id * 0.137) % 1;
          const px = u.x + (t.x - u.x) * f;
          const py = u.y + (t.y - u.y) * f - Math.sin(f * Math.PI) * 30;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - Math.cos(ang) * 7, py - Math.sin(ang) * 7);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    const order = [...b.units].sort((p, q) => p.y - q.y);
    for (const u of order) if (u.state === 'ok' || u.state === 'routing') this.drawUnit(ctx, u);

    // Volleys, cannonballs, rockets and tower bolts.
    ctx.save();
    for (const s of b.shots) {
      const f = Math.min(1, s.t / 0.25);
      if (s.kind === 'musket' || s.kind === 'tower') {
        ctx.strokeStyle = s.kind === 'tower' ? `rgba(40,30,20,${1 - f})` : `rgba(255,236,170,${0.8 * (1 - f)})`;
        ctx.lineWidth = s.kind === 'tower' ? 1.2 : 1;
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x0 + (s.x1 - s.x0) * f, s.y0 + (s.y1 - s.y0) * f);
        ctx.stroke();
      } else if (s.kind === 'cannon') {
        const px = s.x0 + (s.x1 - s.x0) * f;
        const py = s.y0 + (s.y1 - s.y0) * f;
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.kind === 'rocket') {
        const px = s.x0 + (s.x1 - s.x0) * f;
        const py = s.y0 + (s.y1 - s.y0) * f - Math.sin(f * Math.PI) * 40;
        ctx.strokeStyle = 'rgba(255,170,60,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - (s.x1 - s.x0) * 0.04, py - (s.y1 - s.y0) * 0.04 + 4);
        ctx.stroke();
      }
    }
    ctx.restore();

    for (const p of this.particles) {
      const a = (1 - p.life / p.max) * 0.5;
      ctx.fillStyle = `rgba(${p.color},${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + p.life / p.max), 0, Math.PI * 2);
      ctx.fill();
    }

    for (const u of order) if (u.state === 'ok' || u.state === 'routing') this.drawLabel(ctx, u);

    // Melee sparks.
    if (this.phase === 'live' && !this.paused) {
      ctx.fillStyle = '#ffe9a8';
      for (const u of b.units) {
        if (!u.fighting) continue;
        for (let k = 0; k < 3; k++) {
          const a = u.facing + Math.sin(this.t * 23 + u.id * 3 + k * 2.1) * 0.9;
          const r = 14 + ((this.t * 60 + k * 7 + u.id) % 9);
          ctx.fillRect(u.x + Math.cos(a) * r, u.y + Math.sin(a) * r, 2, 2);
        }
      }
    }

    if (this.s.rain) this.drawRain(ctx);

    ctx.save();
    ctx.textAlign = 'center';
    const k = 1 / z;
    ctx.font = `700 ${13 * k}px Georgia, serif`;
    for (const f of b.floaters) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.6);
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(f.text, f.x, f.y - f.t * 18 * k);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.t * 18 * k);
    }
    ctx.restore();

    if (this.sketch && this.sketch.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,15,10,0.5)';
      ctx.lineWidth = 7 / z;
      ctx.beginPath();
      this.sketch.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.strokeStyle = '#ffe9a0';
      ctx.lineWidth = 3 / z;
      ctx.stroke();
      ctx.restore();
    }

    if (this.drag) {
      const d = this.drag;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1 / z;
      ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
      ctx.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
      ctx.restore();
    }

    ctx.restore();
    this.drawBanner(ctx);
    this.drawTooltip(ctx);
  }

  private drawWalls(ctx: CanvasRenderingContext2D) {
    const W = this.b.walls!;
    const stone = W.level === 1 ? '#7a5a36' : W.level === 2 ? '#a39887' : '#8c8274';
    const dark = W.level === 1 ? '#4e3820' : '#5d564b';
    // Plaza.
    ctx.save();
    ctx.fillStyle = 'rgba(200,180,140,0.35)';
    ctx.beginPath();
    ctx.arc(W.plaza.x, W.plaza.y, W.plaza.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(60,40,20,0.5)';
    ctx.stroke();
    if (W.capture > 0) {
      ctx.strokeStyle = this.b.attacker === 0 ? this.s.playerFaction.color : this.s.enemyFaction.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(W.plaza.x, W.plaza.y, W.plaza.r - 3, -Math.PI / 2, -Math.PI / 2 + W.capture * Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    for (const s of W.segs) {
      const w = s.x1 - s.x0;
      if (s.hp <= 0) {
        // Rubble.
        const rng = new RNG(Math.floor(s.x0));
        ctx.fillStyle = dark;
        for (let i = 0; i < 14; i++) ctx.fillRect(s.x0 + rng.range(0, w), W.y + rng.range(-4, W.t + 4), rng.range(3, 8), rng.range(3, 6));
        continue;
      }
      if (s.gate) {
        ctx.fillStyle = stone;
        ctx.fillRect(s.x0, W.y, 22, W.t);
        ctx.fillRect(s.x1 - 22, W.y, 22, W.t);
        ctx.fillStyle = '#5b3a1e';
        ctx.fillRect(s.x0 + 22, W.y + 4, w - 44, W.t - 8);
        ctx.strokeStyle = '#2c1a0c';
        ctx.lineWidth = 1;
        for (let x = s.x0 + 28; x < s.x1 - 22; x += 7) {
          ctx.beginPath();
          ctx.moveTo(x, W.y + 4);
          ctx.lineTo(x, W.y + W.t - 4);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = stone;
        ctx.fillRect(s.x0, W.y, w, W.t);
        // Crenellations.
        ctx.fillStyle = dark;
        for (let x = s.x0; x < s.x1; x += 10) ctx.fillRect(x, W.y + W.t - 5, 5, 5);
      }
      ctx.strokeStyle = dark;
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x0, W.y, w, W.t);
      const dmg = 1 - s.hp / s.maxHp;
      if (dmg > 0.05) {
        ctx.strokeStyle = 'rgba(30,20,10,0.8)';
        ctx.lineWidth = 1.2;
        const rng = new RNG(Math.floor(s.x0) + 7);
        for (let i = 0; i < Math.ceil(dmg * 6); i++) {
          const x = s.x0 + rng.range(8, w - 8);
          ctx.beginPath();
          ctx.moveTo(x, W.y + 2);
          ctx.lineTo(x + rng.range(-8, 8), W.y + W.t / 2);
          ctx.lineTo(x + rng.range(-8, 8), W.y + W.t - 2);
          ctx.stroke();
        }
      }
      if (s.gate) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(s.x0 + 22, W.y + W.t + 4, w - 44, 4);
        ctx.fillStyle = '#e8c14a';
        ctx.fillRect(s.x0 + 22, W.y + W.t + 4, (w - 44) * (s.hp / s.maxHp), 4);
      }
    }
    for (const t of W.towers) {
      ctx.fillStyle = stone;
      ctx.fillRect(t.x - 14, W.y - 8, 28, W.t + 16);
      ctx.strokeStyle = dark;
      ctx.lineWidth = 2;
      ctx.strokeRect(t.x - 14, W.y - 8, 28, W.t + 16);
      ctx.fillStyle = dark;
      for (let x = t.x - 14; x < t.x + 14; x += 8) ctx.fillRect(x, W.y - 8, 4, 4);
    }
  }

  /** Side length (world px) of a unit's counter tile. */
  private tileSize(u: BUnit): number {
    const c = UNIT_STATS[u.type].cls;
    return c === 'elephant' ? 34 : c === 'cavalry' ? 31 : c === 'artillery' ? 26 : 30;
  }

  /**
   * A regiment is a square counter in its colours, split light and dark along
   * the diagonal and marked with its branch symbol, turned to face its front.
   * A faint crowd of men around it shows how many are left.
   */
  private drawUnit(ctx: CanvasRenderingContext2D, u: BUnit) {
    const st = UNIT_STATS[u.type];
    const f = u.side === 0 ? this.s.playerFaction : this.s.enemyFaction;
    const [r, g, bl] = f.rgb;
    const S = this.tileSize(u);
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.rotate(u.facing + Math.PI / 2);
    if (u.state === 'routing') ctx.globalAlpha = 0.45 + 0.25 * Math.sin(this.t * 10);
    if (u.climbing) ctx.globalAlpha = 0.75;

    // The men themselves: a loose crowd spread along the regiment's frontage.
    const men = Math.max(1, Math.ceil(u.men));
    const front = S * 0.9 + men * (st.cls === 'cavalry' ? 0.75 : 0.45);
    const depth = S * 0.75;
    ctx.fillStyle = 'rgba(38,30,18,0.42)';
    let seed = u.id * 9301 + 49297;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const dots = Math.ceil(men / (st.cls === 'elephant' ? 0.3 : 1.6));
    for (let i = 0; i < dots; i++) {
      const dx = (rand() - 0.5) * front;
      const dy = (rand() - 0.5) * depth + (st.cls === 'cavalry' ? 0 : 3);
      const sz = st.cls === 'elephant' ? 3.2 : st.cls === 'cavalry' ? 1.8 : 1.3;
      ctx.fillRect(dx - sz / 2, dy - sz / 2, sz, sz * (st.cls === 'cavalry' ? 1.6 : 1));
    }

    // Speed lines behind a regiment running or galloping in.
    if (u.rushing && u.moving) {
      ctx.strokeStyle = 'rgba(250,240,205,0.65)';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const off = i * S * 0.3;
        const len = 14 + ((this.t * 90 + i * 7 + u.id) % 10);
        ctx.beginPath();
        ctx.moveTo(off, S / 2 + 4);
        ctx.lineTo(off, S / 2 + 4 + len);
        ctx.stroke();
      }
    }

    // Shadow, then the counter.
    ctx.fillStyle = 'rgba(20,14,8,0.35)';
    ctx.fillRect(-S / 2 + 2.5, -S / 2 + 3.5, S, S);
    const light = `rgb(${Math.min(255, r + (255 - r) * 0.45)},${Math.min(255, g + (255 - g) * 0.45)},${Math.min(255, bl + (255 - bl) * 0.45)})`;
    const dark = `rgb(${r * 0.78},${g * 0.78},${bl * 0.78})`;
    ctx.fillStyle = dark;
    ctx.fillRect(-S / 2, -S / 2, S, S);
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(-S / 2, -S / 2);
    ctx.lineTo(S / 2, -S / 2);
    ctx.lineTo(-S / 2, S / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,230,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-S / 2 + 2.5, -S / 2 + 2.5, S - 5, S - 5);
    ctx.strokeStyle = 'rgba(22,13,8,0.95)';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(-S / 2, -S / 2, S, S);
    drawTileSymbol(ctx, u.type, S - 4, 'rgba(26,16,10,0.92)');
    if (st.tier === 'S') {
      ctx.strokeStyle = '#d9b44a';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-S / 2 + 4.5, -S / 2 + 4.5, S - 9, S - 9);
    }
    if (this.selected.has(u.id) && u.state === 'ok') {
      ctx.strokeStyle = '#ffe28a';
      ctx.lineWidth = 2.5 / Math.max(0.6, this.cam.z);
      ctx.shadowColor = 'rgba(255,220,120,0.9)';
      ctx.shadowBlur = 8;
      ctx.strokeRect(-S / 2 - 4, -S / 2 - 4, S + 8, S + 8);
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    if (u.climbing) {
      ctx.save();
      ctx.strokeStyle = '#7a5a36';
      ctx.lineWidth = 2;
      for (const dx of [-8, 8]) {
        ctx.beginPath();
        ctx.moveTo(u.x + dx, u.y);
        ctx.lineTo(u.x + dx, u.y - 30);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (this.b.generalIds[u.side] === u.id && u.state === 'ok') this.drawStandard(ctx, u, f);
  }

  /** The commander's standard: pole, crossbar and swallow-tailed banner above his regiment. */
  private drawStandard(ctx: CanvasRenderingContext2D, u: BUnit, f: Faction) {
    const S = this.tileSize(u);
    const x = u.x + S * 0.55;
    const base = u.y;
    const top = base - 62;
    ctx.save();
    ctx.strokeStyle = '#4a3420';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, top - 6);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 15, top);
    ctx.lineTo(x + 15, top);
    ctx.stroke();
    ctx.fillStyle = '#c9a24a';
    for (const dx of [-15, 15]) {
      ctx.beginPath();
      ctx.arc(x + dx, top, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    const sway = Math.sin(this.t * 2 + u.id) * 1.5;
    const grad = ctx.createLinearGradient(x - 12, top, x + 12, top + 30);
    grad.addColorStop(0, `rgb(${Math.min(255, f.rgb[0] + 40)},${Math.min(255, f.rgb[1] + 40)},${Math.min(255, f.rgb[2] + 40)})`);
    grad.addColorStop(1, `rgb(${f.rgb[0] * 0.7},${f.rgb[1] * 0.7},${f.rgb[2] * 0.7})`);
    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(30,18,10,0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - 12, top + 2);
    ctx.lineTo(x + 12, top + 2);
    ctx.lineTo(x + 12 + sway, top + 32);
    ctx.lineTo(x + sway * 0.5, top + 25);
    ctx.lineTo(x - 12 + sway, top + 32);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Name plate, kept readable on screen.
    const name = (u.side === 0 ? this.s.playerGeneral : this.s.enemyGeneral)?.toUpperCase();
    if (name && this.cam.z >= 0.6) {
      const k = 1 / this.cam.z;
      ctx.translate(x, top - 8);
      ctx.scale(k, k);
      ctx.font = '700 11px Cinzel, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(name).width + 14;
      ctx.fillStyle = '#f1e6c8';
      ctx.strokeStyle = '#3a2a18';
      ctx.fillRect(-w / 2, -16, w, 16);
      ctx.strokeRect(-w / 2, -16, w, 16);
      ctx.fillStyle = '#2a1d12';
      ctx.fillText(name, 0, -7.5);
    }
    ctx.restore();
  }

  /** Headcount, morale and reload bars under the counter, kept the same size on screen. */
  private drawLabel(ctx: CanvasRenderingContext2D, u: BUnit) {
    const st = UNIT_STATS[u.type];
    const k = 1 / this.cam.z;
    ctx.save();
    ctx.translate(u.x, u.y + this.tileSize(u) * 0.5 + 9 * k);
    ctx.scale(k, k);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 10.5px Cinzel, Georgia, serif';
    const label = `${Math.ceil(u.men)}`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(244,236,214,0.85)';
    ctx.strokeText(label, 0, 0);
    ctx.fillStyle = '#24170d';
    ctx.fillText(label, 0, 0);
    const m = Math.max(0, u.morale / u.maxMorale);
    ctx.fillStyle = 'rgba(30,20,10,0.55)';
    ctx.fillRect(-13, 7, 26, 3);
    ctx.fillStyle = m > 0.6 ? '#6f9a3f' : m > 0.3 ? '#c99a2e' : '#b8432f';
    ctx.fillRect(-13, 7, 26 * m, 3);
    if (st.reload > 0 && u.state === 'ok') {
      const r = 1 - Math.max(0, u.reload) / st.reload;
      ctx.fillStyle = 'rgba(30,20,10,0.45)';
      ctx.fillRect(-13, 11, 26, 2);
      ctx.fillStyle = '#4f7fa8';
      ctx.fillRect(-13, 11, 26 * r, 2);
    }
    ctx.restore();
  }

  private drawRain(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = 'rgba(200,215,235,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 160; i++) {
      const x = ((i * 137.5 + this.t * 60) % (FIELD_W + 60)) - 30;
      const y = ((i * 91.3 + this.t * 520) % (FIELD_H + 40)) - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 12);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    let text: string;
    if (this.phase === 'deploy') text = 'DEPLOYMENT · RIGHT-CLICK TO PLACE REGIMENTS · SPACE TO BEGIN';
    else if (this.phase === 'done') text = 'THE BATTLE IS OVER';
    else if (this.paused) text = 'PAUSED · GIVE ORDERS · SPACE TO RESUME';
    else {
      const left = Math.max(0, this.b.timeLimit - this.b.time);
      text = `${this.speed}× · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} LEFT`;
    }
    ctx.save();
    ctx.font = '700 13px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 32;
    ctx.fillStyle = this.phase === 'live' && !this.paused ? 'rgba(90,30,20,0.8)' : 'rgba(30,22,12,0.85)';
    ctx.beginPath();
    ctx.roundRect(VIEW_W / 2 - w / 2, VIEW_H - 40, w, 28, 14);
    ctx.fill();
    ctx.fillStyle = '#f4e3b5';
    ctx.fillText(text, VIEW_W / 2, VIEW_H - 25.5);
    if (this.noticeT > 0) {
      ctx.globalAlpha = Math.min(1, this.noticeT);
      ctx.font = '600 13px Georgia, serif';
      const nw = ctx.measureText(this.notice).width + 24;
      ctx.fillStyle = 'rgba(20,15,10,0.85)';
      ctx.beginPath();
      ctx.roundRect(VIEW_W / 2 - nw / 2, VIEW_H - 72, nw, 24, 12);
      ctx.fill();
      ctx.fillStyle = '#ffd27a';
      ctx.fillText(this.notice, VIEW_W / 2, VIEW_H - 59.5);
    }
    ctx.restore();
  }

  private drawTooltip(ctx: CanvasRenderingContext2D) {
    const u = this.unitAt(this.mouseW.x, this.mouseW.y, 0) ?? this.unitAt(this.mouseW.x, this.mouseW.y, 1);
    if (!u) return;
    const st = UNIT_STATS[u.type];
    const where = [this.b.inForest(u) ? 'in forest' : '', this.b.height(u) > 0.35 ? 'on high ground' : '', this.b.onWall(u) ? 'on the walls' : '',
      this.b.inRiver(u) ? 'wading the river!' : '', this.b.onFord(u) ? 'at a ford' : '', this.b.inMarsh(u) ? 'in marsh' : '', this.b.inVillage(u) ? 'in a village' : '']
      .filter(Boolean).join(', ');
    const lines = [
      `${u.side === 0 ? 'Your' : 'Enemy'} ${st.name}`,
      `${Math.ceil(u.men)}/${u.maxMen} ${st.cls === 'elephant' ? 'elephants' : 'men'} · morale ${Math.round(u.morale)} · tier ${st.tier}`,
      statusOf(u, this.b) + (where ? ` · ${where}` : ''),
    ];
    ctx.save();
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const x = Math.min(VIEW_W - w - 6, this.mouse.x + 16);
    const y = Math.min(VIEW_H - 58, this.mouse.y + 16);
    ctx.fillStyle = 'rgba(20,15,10,0.9)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, 52, 6);
    ctx.fill();
    ctx.fillStyle = '#efe6d2';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, x + 8, y + 6 + i * 14));
    ctx.restore();
  }

  // ---------------------------------------------------------------- side panel

  renderUI() {
    const s = this.s;
    const siege = s.mode === 'siege';
    fill(ui.top,
      h('div', { class: 'brand' }, `${siege ? '🏰' : '⚔'} ${s.title}`),
      h('div', { class: 'stat' }, swatch(s.playerFaction.color), s.playerFaction.short, s.playerAttacks ? ' (attacking)' : ' (defending)'),
      h('div', { class: 'stat muted' }, 'vs'),
      h('div', { class: 'stat' }, swatch(s.enemyFaction.color), s.enemyFaction.short),
      s.rain ? h('div', { class: 'stat muted' }, '🌧 Monsoon rain: bows and matchlocks suffer') : null,
      h('div', { class: 'stat push btns', style: 'margin:0' },
        ...[1, 2, 3].map((n) => h('button', { class: `small ${this.speed === n ? 'primary' : ''}`, onclick: () => { this.speed = n; this.renderUI(); } }, `${n}×`)),
      ),
    );
    this.listEl = h('div', { class: 'stack' });
    this.statusEl = h('div', {});
    const deploying = this.phase === 'deploy';
    clear(ui.side).append(
      h('div', { class: 'card' },
        h('h3', {}, deploying ? 'Deployment' : this.phase === 'done' ? 'Battle over' : this.paused ? 'Paused' : 'Battle in progress'),
        h('p', { class: 'muted' }, deploying
          ? 'Select regiments and right-click inside the dashed zone to position them. The enemy cannot move until you begin.'
          : 'Real-time. Pause with Space at any moment to give orders.'),
        h('div', { class: 'btns' },
          deploying
            ? h('button', { class: 'primary', onclick: () => this.start() }, 'Begin battle (Space)')
            : h('button', { class: 'primary', disabled: this.phase === 'done', onclick: () => this.togglePause() }, this.paused ? 'Resume (Space)' : 'Pause (Space)'),
          h('button', { disabled: this.phase === 'done', onclick: () => this.finish(false, true) }, 'Retreat'),
        ),
        this.statusEl,
        h('ul', { class: 'help' },
          h('li', {}, 'Left-click or drag to select. Shift adds. Right-click: move, or attack an enemy.'),
          h('li', {}, 'Right-drag to draw a curved path; the regiments follow it in formation (end it on an enemy to attack).'),
          h('li', {}, 'A regiment locked in melee breaks off when you order it elsewhere: it falls back for a few seconds, taking blows from behind and a little morale.'),
          h('li', {}, 'Terrain matters: hold high ground, cross rivers only at the sandy fords, keep horse out of marshes, and use villages and woods as cover.'),
          siege && s.playerAttacks ? h('li', {}, 'Right-click the gate or a wall section with guns or elephants to batter it. Infantry can hack at the gate.') : null,
          siege && s.playerAttacks && s.ladders ? h('li', {}, 'You have ladders: send infantry at the walls and they will climb.') : null,
          siege ? h('li', {}, 'The attacker wins by holding the town square, or by breaking the defenders.') : null,
          h('li', {}, 'Cavalry must charge flanks and rear: a head-on charge into formed infantry breaks, and the riders bleed for it (worst against spears). Archers cannot stand against horse at all.'),
          h('li', {}, 'Pin an enemy regiment from the front, then hit its flank or rear: infantry on infantry flanks are devastating.'),
          h('li', {}, 'Regiments sent at an enemy break into a run (horse into a gallop) for the last stretch and hit harder on impact.'),
          h('li', {}, 'Guard your commander (his standard flies over his regiment). If his regiment breaks, the whole army loses heart.'),
          h('li', {}, 'Mavalas fight best in forest and on hills. Keys: 1/2/3 speed, H hold.'),
          h('li', {}, 'Scroll or pinch to zoom; WASD, arrow keys or middle-drag to pan.'),
        ),
      ),
      h('div', { class: 'card' }, h('h3', {}, 'Your regiments'), this.listEl),
    );
    this.refreshStatus();
    this.refreshList();
  }

  private refreshStatus() {
    const el = this.statusEl;
    if (!el) return;
    const b = this.b;
    const foes = b.units.filter((u) => u.side === 1);
    const ok = foes.filter((u) => u.state === 'ok');
    const W = b.walls;
    fill(el,
      h('div', { class: 'muted', style: 'margin-top:8px' }, swatch(this.s.enemyFaction.color),
        `Enemy: ${ok.length}/${foes.length} regiments fighting, ${Math.round(ok.reduce((n, u) => n + u.men, 0))} men`),
      W ? h('div', { class: 'muted' }, `Gate ${Math.round((W.segs[5].hp / W.segs[5].maxHp) * 100)}% · ${W.segs.filter((x) => x.hp <= 0).length} breaches · square ${Math.round(W.capture * 100)}% taken`) : null,
    );
    this.refreshList();
  }

  private refreshList() {
    const el = this.listEl;
    if (!el) return;
    clear(el).append(
      ...this.b.units.filter((u) => u.side === 0).map((u) => {
        const st = UNIT_STATS[u.type];
        const alive = u.state === 'ok';
        const m = Math.max(0, u.morale / u.maxMorale);
        return h('div', {
          class: `unit-row ${alive ? 'clickable' : 'gone'} ${this.selected.has(u.id) ? 'selected' : ''}`,
          title: st.blurb,
          onclick: (e: MouseEvent) => {
            if (!alive) return;
            if (e.shiftKey) {
              if (this.selected.has(u.id)) this.selected.delete(u.id);
              else this.selected.add(u.id);
            } else this.selected = new Set([u.id]);
            this.refreshList();
          },
        },
        h('div', { class: 'row' },
          h('span', { class: 'uname' }, symbolEl(u.type, this.s.playerFaction.color, 22), st.short, tierBadge(st.tier)),
          h('span', { class: 'muted' }, `${Math.ceil(u.men)}/${u.maxMen} · ${statusOf(u, this.b)}`)),
        bar(m, m > 0.6 ? '#8fd16b' : m > 0.3 ? '#e8c14a' : '#e3604f'),
        );
      }),
    );
  }
}

function statusOf(u: BUnit, b: Battle): string {
  if (u.state === 'dead') return 'destroyed';
  if (u.state === 'fled') return 'fled';
  if (u.state === 'routing') return 'routing!';
  if (u.climbing) return 'climbing';
  if (u.disengageT > 0) return 'falling back';
  if (u.fighting) return 'fighting';
  if (u.aimId >= 0) return 'shooting';
  if (u.order.kind === 'breach') return 'battering';
  if (u.order.kind === 'move' || u.order.kind === 'path') return u.moving ? 'marching' : 'blocked';
  if (u.order.kind === 'attack') {
    const t = b.get(u.order.target);
    return t ? `→ ${UNIT_STATS[t.type].short.toLowerCase()}` : 'attacking';
  }
  return 'holding';
}

function renderBattlefield(b: Battle, s: BattleSetup): HTMLCanvasElement {
  // Ground texture at 1x, smoothed onto a 2x canvas; everything drawn on top is crisp vector art.
  const tex = document.createElement('canvas');
  tex.width = FIELD_W;
  tex.height = FIELD_H;
  const tg = tex.getContext('2d')!;
  const img = tg.createImageData(FIELD_W, FIELD_H);
  const n = makeNoise(s.seed);
  const fine = makeNoise(s.seed + 1);
  // Olive-and-straw ground of a painted battle map.
  const ground: Record<Terrain, [number, number, number]> = {
    plains: [190, 184, 112],
    hills: [184, 172, 114],
    forest: [166, 170, 100],
    desert: [218, 200, 146],
  };
  const [gr, gg, gb] = ground[s.terrain];
  const rainK = s.rain ? 0.85 : 1;
  for (let y = 0; y < FIELD_H; y++) {
    for (let x = 0; x < FIELD_W; x++) {
      const v = fbm(n, x / 140, y / 140, 4);
      const f = fine(x / 6, y / 6) - 0.5;
      const hgt = b.height({ x, y });
      const k = (0.82 + 0.36 * v + hgt * 0.18) * rainK;
      const i = (y * FIELD_W + x) * 4;
      img.data[i] = gr * k + f * 10;
      img.data[i + 1] = gg * k + f * 10;
      img.data[i + 2] = gb * k + f * 8;
      img.data[i + 3] = 255;
    }
  }
  tg.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = FIELD_W * 1.5;
  c.height = FIELD_H * 1.5;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(tex, 0, 0, c.width, c.height);
  g.scale(1.5, 1.5);

  // Brush-stroke texture: short slanted strokes, darker and lighter, like grass and furrows.
  const br = new RNG(s.seed + 23);
  g.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const x = br.range(0, FIELD_W);
    const y = br.range(0, FIELD_H);
    const len = br.range(5, 13);
    const a = -0.65 + br.range(-0.15, 0.15);
    g.strokeStyle = br.chance(0.6) ? `rgba(96,86,40,${br.range(0.08, 0.18)})` : `rgba(250,240,190,${br.range(0.08, 0.16)})`;
    g.lineWidth = br.range(0.8, 1.6);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }

  // Sunlit hilltops.
  for (const hl of b.hills) {
    const grad = g.createRadialGradient(hl.x - hl.r * 0.2, hl.y - hl.r * 0.2, 0, hl.x, hl.y, hl.r);
    grad.addColorStop(0, `rgba(255,244,205,${0.22 * hl.h})`);
    grad.addColorStop(1, 'rgba(255,244,205,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(hl.x, hl.y, hl.r, 0, Math.PI * 2);
    g.fill();
  }

  // Marshes: dark pools and reeds.
  const mr = new RNG(s.seed + 11);
  for (const m of b.marshes) {
    for (let i = 0; i < 9; i++) {
      const a = mr.range(0, Math.PI * 2);
      const d = mr.range(0, m.r * 0.6);
      g.fillStyle = 'rgba(64,92,84,0.35)';
      g.beginPath();
      g.ellipse(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, m.r * mr.range(0.35, 0.55), m.r * mr.range(0.25, 0.4), mr.range(0, 3), 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(48,70,40,0.7)';
    g.lineWidth = 1;
    for (let i = 0; i < m.r * 1.2; i++) {
      const a = mr.range(0, Math.PI * 2);
      const d = m.r * Math.sqrt(mr.next()) * 0.9;
      const x = m.x + Math.cos(a) * d;
      const y = m.y + Math.sin(a) * d;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + mr.range(-2, 2), y - mr.range(5, 9));
      g.stroke();
    }
  }

  // The river, with its banks and fords.
  for (const r of b.rivers) {
    const path = new Path2D();
    r.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(112,92,58,0.85)';
    g.lineWidth = r.w + 12;
    g.stroke(path);
    g.strokeStyle = '#4c7ea4';
    g.lineWidth = r.w;
    g.stroke(path);
    g.strokeStyle = 'rgba(200,228,245,0.3)';
    g.lineWidth = r.w * 0.3;
    g.stroke(path);
    const fr = new RNG(s.seed + 13);
    for (const f of r.fords) {
      g.fillStyle = 'rgba(206,186,140,0.92)';
      g.beginPath();
      g.ellipse(f.x, f.y, f.r * 0.85, r.w * 0.85, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(120,110,95,0.8)';
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        g.arc(f.x + fr.range(-f.r * 0.7, f.r * 0.7), f.y + fr.range(-r.w * 0.6, r.w * 0.6), fr.range(1.5, 3), 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // Villages: a fence and a cluster of huts.
  const vr = new RNG(s.seed + 17);
  for (const v of b.villages) {
    g.strokeStyle = 'rgba(92,64,36,0.8)';
    g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.arc(v.x, v.y, v.r, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + vr.range(-0.3, 0.3);
      const d = vr.range(v.r * 0.2, v.r * 0.7);
      const x = v.x + Math.cos(a) * d;
      const y = v.y + Math.sin(a) * d;
      g.fillStyle = `rgb(${vr.int(160, 185)},${vr.int(120, 140)},${vr.int(85, 100)})`;
      g.fillRect(x - 8, y - 6, 16, 12);
      g.fillStyle = 'rgba(110,60,30,0.9)';
      g.beginPath();
      g.moveTo(x - 10, y - 5);
      g.lineTo(x, y - 12);
      g.lineTo(x + 10, y - 5);
      g.closePath();
      g.fill();
    }
  }

  // Contour lines on hills.
  g.strokeStyle = 'rgba(70,55,30,0.25)';
  g.lineWidth = 1;
  for (const hl of b.hills) {
    for (let k = 1; k <= 3; k++) {
      g.beginPath();
      g.arc(hl.x, hl.y, hl.r * (1 - k * 0.25), 0, Math.PI * 2);
      g.stroke();
    }
  }

  const W = b.walls;
  if (W) {
    // Town inside the walls: houses round the square.
    const rng = new RNG(s.seed + 5);
    g.fillStyle = 'rgba(150,130,100,0.6)';
    g.fillRect(0, 0, FIELD_W, W.y);
    for (let i = 0; i < 90; i++) {
      const x = rng.range(10, FIELD_W - 30);
      const y = rng.range(10, W.y - 30);
      if (Math.hypot(x - W.plaza.x, y - W.plaza.y) < W.plaza.r + 30) continue;
      if (Math.abs(x - FIELD_W / 2) < 50) continue; // keep the main street clear
      const w = rng.range(14, 30);
      const hh = rng.range(10, 20);
      g.fillStyle = `rgb(${rng.int(150, 180)},${rng.int(110, 130)},${rng.int(80, 95)})`;
      g.fillRect(x, y, w, hh);
      g.fillStyle = 'rgba(60,35,20,0.5)';
      g.fillRect(x, y + hh - 3, w, 3);
    }
  }

  // Woods: dense, dark stippled thickets.
  const rng = new RNG(s.seed + 3);
  for (const f of b.forests) {
    const soft = g.createRadialGradient(f.x, f.y, f.r * 0.3, f.x, f.y, f.r * 1.1);
    soft.addColorStop(0, 'rgba(48,58,34,0.55)');
    soft.addColorStop(1, 'rgba(48,58,34,0)');
    g.fillStyle = soft;
    g.beginPath();
    g.arc(f.x, f.y, f.r * 1.1, 0, Math.PI * 2);
    g.fill();
    const dots = Math.floor(f.r * f.r * 0.35);
    for (let i = 0; i < dots; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = f.r * Math.sqrt(rng.next());
      const x = f.x + Math.cos(a) * r;
      const y = f.y + Math.sin(a) * r;
      const shade = rng.int(0, 2);
      g.fillStyle = shade === 0 ? 'rgba(30,38,22,0.8)' : shade === 1 ? 'rgba(58,70,40,0.75)' : 'rgba(96,104,62,0.6)';
      g.beginPath();
      g.arc(x, y, rng.range(1.2, 3.2), 0, Math.PI * 2);
      g.fill();
    }
  }
  const grad = g.createRadialGradient(FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.35, FIELD_W / 2, FIELD_H / 2, FIELD_W * 0.7);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(40,30,10,0.28)');
  g.fillStyle = grad;
  g.fillRect(0, 0, FIELD_W, FIELD_H);
  return c;
}
