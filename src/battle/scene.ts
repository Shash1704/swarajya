import { type Scene, VIEW_H, VIEW_W } from '../app';
import { bar, clear, fill, h, hideModal, modalOpen, showModal, swatch, ui } from '../ui';
import { fbm, makeNoise } from '../noise';
import { RNG } from '../rng';
import { FORMATION_HELP, FORMATION_NAMES, type Formation, formationsFor, UNIT_STATS, VET_NAMES } from '../data';
import { drawTileSymbol, inkFor, symbolEl, tierBadge } from '../symbols';
import type { CUnit, Faction } from '../campaign/state';
import { Battle, type BUnit, FIELD_H, FIELD_W, type LeaderMods, type BattleOptions, radiusOf, type Terrain } from './battle';
import { planSide } from './ai';
import type { View3D } from './view3d';

import { canvas3d, hasWebGL, setWant3D, want3D } from '../pref3d';

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
  fog?: boolean;
  dusk?: boolean;
  leaders?: [LeaderMods, LeaderMods];
  /** One line on each commander's gifts, for the side panel. */
  leaderNotes?: [string, string];
  /** Historical battles: set starting places, the player's deployment area, and thirst. */
  placement?: BattleOptions['placement'];
  zone0?: [number, number];
  thirst?: [number, number];
  generals?: [number, number];
  map?: BattleOptions['map'];
  morale?: [number, number];
  encircled?: BattleOptions['encircled'];
  arrivals?: BattleOptions['arrivals'];
  /** The button that ends the battle (default: back to the campaign map). */
  doneLabel?: string;
  /** draw: night fell with neither side broken. */
  /** surrendered: the enemy commander gave himself up (the player accepted his surrender). */
  onDone(playerWon: boolean, draw?: boolean, generalLost?: [boolean, boolean], surrendered?: boolean): void;
}

const STEP = 1 / 60;
const FORM_KEYS: Record<string, Formation> = { n: 'normal', t: 'tight', l: 'loose', b: 'brace', g: 'wedge' };
const fatigueName = (f: number) => (f < 0.25 ? 'fresh' : f < 0.5 ? 'winded' : f < 0.75 ? 'tired' : 'exhausted');
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
  private surrenderAsked = false;
  private drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** A path being drawn with the right mouse button (or a long press), in world coords. */
  private sketch: [number, number][] | null = null;
  /** The drag being drawn is a battle line (straight, sets frontage and facing) rather than a march path. */
  private sketchLine = false;
  /** Right-drags draw battle lines (toggle with Q, or hold Shift for one drag). */
  private lineMode = false;
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
  private ordersEl: HTMLElement | null = null;
  private ordersSig = '';
  private notice = '';
  private noticeT = 0;
  private particles: Particle[] = [];
  /** Fog-of-war shroud, drawn at low resolution and stretched over the field. */
  private shroud = document.createElement('canvas');
  private shroudT = 0;
  private seenShots = new WeakSet<object>();
  /** The 3D battlefield, once Babylon.js has loaded (null while loading, or in 2D). */
  private v3: View3D | null = null;
  private use3D = want3D() && hasWebGL();
  private loading3D = false;
  private gone = false;
  /** The box-select rectangle in screen space (for 3D, where a screen box isn't a field box). */
  private dragS: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private orbit = false;

  constructor(setup: BattleSetup) {
    this.s = setup;
    this.b = new Battle(setup.playerUnits, setup.enemyUnits, {
      mode: setup.mode, playerAttacks: setup.playerAttacks, seed: setup.seed, terrain: setup.terrain,
      rain: setup.rain, walls: setup.walls, ladders: setup.ladders, ram: setup.ram, river: setup.river, marsh: setup.marsh,
      fog: setup.fog, dusk: setup.dusk, leaders: setup.leaders,
      placement: setup.placement, zone0: setup.zone0, thirst: setup.thirst, generals: setup.generals, map: setup.map, morale: setup.morale, encircled: setup.encircled, arrivals: setup.arrivals,
    });
    this.bg = renderBattlefield(this.b, setup);
    if (this.use3D) this.load3D();
  }

  enter() {
    this.renderUI();
  }

  exit() {
    this.gone = true;
    this.drop3D();
  }

  resize() {
    this.v3?.resize();
  }

  /** Loads Babylon.js (only now, so the campaign map never pays for it) and builds the 3D field. */
  private load3D() {
    if (this.v3 || this.loading3D) return;
    this.loading3D = true;
    const canvas = canvas3d();
    import('./view3d').then(({ View3D }) => {
      this.loading3D = false;
      if (this.gone || !this.use3D) return;
      canvas.style.display = 'block';
      this.v3 = new View3D(canvas, this.b, [this.s.playerFaction, this.s.enemyFaction], this.bg, this.s.place ?? this.s.title);
      this.v3.resize();
      this.renderUI();
    }).catch((err) => {
      console.warn('3D battlefield unavailable, using 2D:', err);
      this.loading3D = false;
      this.use3D = false;
      canvas.style.display = 'none';
      this.renderUI();
    });
  }

  private drop3D() {
    this.v3?.dispose();
    this.v3 = null;
    const canvas = canvas3d();
    if (canvas) canvas.style.display = 'none';
  }

  private toggle3D() {
    this.use3D = !this.use3D;
    setWant3D(this.use3D);
    if (this.use3D) this.load3D();
    else this.drop3D();
    this.renderUI();
  }

  // ---------------------------------------------------------------- loop

  update(dt: number) {
    this.t += dt;
    if (this.keys.size && this.v3) {
      const k = this.keys;
      const pan = 900 * dt;
      const right = (k.has('arrowright') || k.has('d') ? 1 : 0) - (k.has('arrowleft') || k.has('a') ? 1 : 0);
      const fwd = (k.has('arrowup') || k.has('w') ? 1 : 0) - (k.has('arrowdown') || k.has('s') ? 1 : 0);
      if (right || fwd) this.v3.panGround(right * pan, fwd * pan);
      if (k.has('z')) this.v3.rotate(1.4 * dt);
      if (k.has('c')) this.v3.rotate(-1.4 * dt);
    } else if (this.keys.size) {
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
      if (this.b.surrenderOffered && !this.b.pursuit && !this.surrenderAsked) {
        this.surrenderAsked = true;
        this.askSurrender();
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
    const draw = this.b.draw && !retreated;
    let text: string;
    if (draw) text = 'Night falls before either army breaks. Both sides draw off to their camps.';
    else if (retreated) text = 'You sound the retreat. The army withdraws, bloodied but intact.';
    else if (siege && won) text = s.playerAttacks ? 'The defenders break. The settlement is yours to take.' : 'The assault is thrown back from the walls!';
    else if (siege) text = s.playerAttacks ? 'The assault fails beneath the walls.' : 'The enemy is inside the walls. The settlement falls.';
    else if (this.b.brokeOut) text = `${s.enemyGeneral ?? 'The enemy commander'} has broken out of the ring with his household. The trap has failed.`;
    else if (this.b.surrenderAccepted) text = `${s.enemyGeneral ?? 'The enemy commander'} surrenders. His men lay down their arms and are sent home; he is your prisoner.`;
    else text = won ? `The ${s.enemyFaction.short} break and flee the field.` : 'Your lines break and scatter.';
    showModal(draw ? 'Nightfall' : won ? 'Victory!' : 'Defeat', h('div', {},
      h('p', {}, text),
      h('div', { class: 'versus' },
        h('div', { class: 'card' }, h('h3', {}, swatch(s.playerFaction.color), 'Your losses'), h('div', {}, `${Math.round(before[0] - after[0])} of ${Math.round(before[0])} men`)),
        h('div', { class: 'card' }, h('h3', {}, swatch(s.enemyFaction.color), 'Enemy losses'), h('div', {}, `${Math.round(before[1] - after[1])} of ${Math.round(before[1])} men`)),
      ),
    ), [{ label: s.doneLabel ?? 'Return to the campaign map', primary: true, onClick: () => { hideModal(); s.onDone(won, draw, [this.b.generalLost[0], this.b.generalLost[1] || this.b.surrenderAccepted], this.b.surrenderAccepted); } }]);
  }

  /** The enemy's army has broken and its commander asks for terms: accept, or ride them down. */
  private askSurrender() {
    const s = this.s;
    const who = s.enemyGeneral ?? `the ${s.enemyFaction.short} commander`;
    showModal(`The ${s.enemyFaction.short} ask for terms`, h('div', {},
      h('p', {}, `The battle has turned against them past bearing. Their army breaks, and ${who} sends his standard down to you asking for quarter.`),
      h('p', { class: 'muted' }, 'Accept, and the battle ends: his men lay down their arms and are sent home, and he is yours to hold. Or ride them down while they run: more of them fall, but some escape, and so may he.'),
    ), [
      { label: '🗡 Ride them down', onClick: () => { hideModal(); this.b.pursue(); this.say('No quarter: ride them down!'); this.renderUI(); } },
      { label: '🏳 Accept the surrender', primary: true, onClick: () => { hideModal(); this.b.acceptSurrender(); this.finish(true); } },
    ]);
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
    if (this.v3) {
      const p = this.v3.pick(sx, sy);
      return p ? [p.x, p.y] : [this.mouseW.x, this.mouseW.y];
    }
    return [this.cam.x + sx / this.cam.z, this.cam.y + sy / this.cam.z];
  }

  wheel(x: number, y: number, dy: number) {
    if (this.v3) {
      this.v3.zoom(dy);
      return;
    }
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
    let bd = this.v3 ? 30 : 28 / Math.min(1, this.cam.z);
    for (const u of this.b.units) {
      if (u.side !== side || u.state !== 'ok' || (side === 1 && !this.b.sees(0, u))) continue;
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
      // In 3D, Shift/Alt + middle-drag turns and tilts the view instead of panning.
      this.orbit = !!this.v3 && (e.shiftKey || e.altKey);
      return;
    }
    const [x, y] = this.toW(sx, sy);
    if (button === 2) {
      // Start sketching a path or a battle line; a plain right-click (no drag) becomes an ordinary order on release.
      if (this.mySelected().length) {
        this.sketch = [[x, y]];
        this.sketchLine = this.phase === 'deploy' || this.lineMode || e.shiftKey || e.altKey;
      } else this.issueOrder(x, y);
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
      this.dragS = { x0: sx, y0: sy, x1: sx, y1: sy };
      if (!e.shiftKey) this.selected.clear();
    }
    this.refreshList();
  }

  pointerMove(sx: number, sy: number) {
    this.mouse = { x: sx, y: sy };
    const [x, y] = this.toW(sx, sy);
    this.mouseW = { x, y };
    if (this.panDrag && this.v3) {
      const dx = sx - this.panDrag.x;
      const dy = sy - this.panDrag.y;
      if (this.orbit) {
        this.v3.rotate(-dx * 0.006);
        this.v3.tilt(-dy * 0.004);
      } else this.v3.panScreen(dx, dy);
      this.panDrag = { x: sx, y: sy };
      return;
    }
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
      if (this.dragS) {
        this.dragS.x1 = sx;
        this.dragS.y1 = sy;
      }
    }
  }

  pointerUp(sx = 0, sy = 0, button = 0) {
    this.panDrag = null;
    if (this.sketch) {
      const pts = this.sketch;
      this.sketch = null;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const [ex, ey] = pts[pts.length - 1];
      if (this.sketchLine && Math.hypot(ex - pts[0][0], ey - pts[0][1]) > 30) this.issueLine(pts[0], [ex, ey]);
      else if (!this.sketchLine && len > 40) this.issuePath(pts);
      else this.issueOrder(pts[0][0], pts[0][1]);
      return;
    }
    void sx; void sy; void button;
    const d = this.drag;
    const ds = this.dragS;
    if (!d) return;
    this.drag = null;
    this.dragS = null;
    // In 3D, box-select by where each regiment appears on screen.
    if (this.v3 && ds) {
      if (Math.abs(ds.x1 - ds.x0) < 6 && Math.abs(ds.y1 - ds.y0) < 6) return;
      const [x0, x1] = [Math.min(ds.x0, ds.x1), Math.max(ds.x0, ds.x1)];
      const [y0, y1] = [Math.min(ds.y0, ds.y1), Math.max(ds.y0, ds.y1)];
      for (const u of this.b.units) {
        if (u.side !== 0 || u.state !== 'ok') continue;
        const p = this.v3.project(u.x, u.y, 8);
        if (p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) this.selected.add(u.id);
      }
      this.refreshList();
      return;
    }
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
    if ((['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(k) || (this.v3 && (k === 'z' || k === 'c'))) && !e.metaKey && !e.ctrlKey) {
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
    } else if (k === 'q') {
      this.lineMode = !this.lineMode;
      this.say(this.lineMode ? 'Line mode: right-drag to draw a battle line.' : 'Path mode: right-drag to draw a march path.');
      this.ordersSig = '';
      this.refreshOrders();
    } else if (this.phase === 'live' && k === 'f') {
      this.feignSelected();
    } else if (this.phase === 'live' && k === 'r') {
      this.rally();
    } else if (FORM_KEYS[k]) {
      this.formSelected(FORM_KEYS[k]);
    }
  }

  /**
   * Where each selected regiment stands on a line drawn from a to b: spread evenly along it,
   * in ranks if there are more than fit (foot in front, then shooters, horse, guns), facing
   * square to the line (to the left of the drag direction).
   */
  private lineSlots(a: [number, number], b: [number, number]): { u: BUnit; x: number; y: number }[] & { face?: number } {
    const sel = this.mySelected();
    const out: { u: BUnit; x: number; y: number }[] & { face?: number } = [];
    if (!sel.length) return out;
    const len = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
    const dx = (b[0] - a[0]) / len;
    const dy = (b[1] - a[1]) / len;
    // The line faces to the left of the drag: drawn left to right it faces up the field,
    // drawn right to left it faces down. Draw it the other way round to turn about.
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const nx = dy;
    const ny = -dx;
    out.face = Math.atan2(ny, nx);
    const GAP = 58;
    const perRow = Math.max(1, Math.min(sel.length, Math.floor(len / GAP) + 1));
    const rankOf = (u: BUnit) => ({ infantry: 0, elephant: 0, missile: 1, cavalry: 2, artillery: 3 } as Record<string, number>)[UNIT_STATS[u.type].cls];
    const units = [...sel].sort((p, q) => rankOf(p) - rankOf(q));
    const spacing = perRow > 1 ? Math.min(len / (perRow - 1), GAP * 2.5) : 0;
    for (let r = 0; r * perRow < units.length; r++) {
      // Within a rank, keep left-to-right order so regiments don't cross each other.
      const row = units.slice(r * perRow, (r + 1) * perRow).sort((p, q) => (p.x * dx + p.y * dy) - (q.x * dx + q.y * dy));
      row.forEach((u, k) => {
        const along = (k - (row.length - 1) / 2) * spacing;
        out.push({ u, x: mx + dx * along - nx * 56 * r, y: my + dy * along - ny * 56 * r });
      });
    }
    return out;
  }

  /** Deployment: no regiment may start within charging distance of the enemy. */
  private keepClear(u: BUnit) {
    const CLEAR = 170;
    for (let pass = 0; pass < 4; pass++) {
      const e = this.b.units.find((o) => o.side === 1 && Math.hypot(o.x - u.x, o.y - u.y) < CLEAR);
      if (!e) return;
      const d = Math.hypot(u.x - e.x, u.y - e.y) || 1;
      const k = (u.x - e.x) / d;
      const m = d < 1.5 ? 1 : (u.y - e.y) / d;
      u.x = Math.max(15, Math.min(FIELD_W - 15, e.x + k * CLEAR));
      u.y = Math.max(15, Math.min(FIELD_H - 15, e.y + m * CLEAR));
    }
  }

  /** Forms the selected regiments up on a drawn line, facing square to it. */
  private issueLine(a: [number, number], b: [number, number]) {
    const slots = this.lineSlots(a, b);
    const face = slots.face ?? 0;
    const clamp = (v: number, hi: number) => Math.max(15, Math.min(hi - 15, v));
    if (this.phase === 'deploy') {
      const [y0, y1] = this.b.deployZone(0);
      for (const s of slots) {
        s.u.x = clamp(s.x, FIELD_W);
        s.u.y = Math.max(y0, Math.min(y1, s.y));
        s.u.facing = face;
        s.u.order = { kind: 'hold', face };
        this.keepClear(s.u);
      }
      return;
    }
    for (const s of slots) {
      s.u.order = { kind: 'move', x: clamp(s.x, FIELD_W), y: clamp(s.y, FIELD_H), face };
      this.breakAway(s.u);
    }
    this.refreshList();
  }

  private formSelected(form: Formation) {
    let n = 0;
    for (const u of this.mySelected()) if (this.b.setFormation(u, form)) n++;
    if (!n && this.mySelected().length) this.say(`None of these regiments can form a ${FORMATION_NAMES[form].toLowerCase()}.`);
    this.renderUI();
  }

  private feignSelected() {
    const horse = this.mySelected().filter((u) => UNIT_STATS[u.type].cls === 'cavalry');
    if (!horse.length) {
      this.say('Only cavalry can feign flight.');
      return;
    }
    for (const u of horse) this.b.feign(u);
    this.refreshList();
  }

  private rally() {
    const b = this.b;
    if (b.generalLost[0]) this.say('Your commander has fallen: there is no one to rally the army.');
    else if (b.rallyCd[0] > 0) this.say(`The commander is still riding the line (${Math.ceil(b.rallyCd[0])}s).`);
    else b.rally(0);
    this.renderUI();
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
        this.keepClear(u);
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
    if (this.v3) {
      ctx.clearRect(0, 0, VIEW_W, VIEW_H);
      this.v3.render({ t: this.t, selected: this.selected, visible: (u) => this.b.sees(0, u), paused: this.paused || this.phase !== 'live' });
      this.drawOverlay3D(ctx);
      this.drawBanner(ctx);
      this.drawTooltip(ctx);
      return;
    }
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

    if (b.fogOn && this.phase !== 'deploy') this.drawShroud(ctx);

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
        if (o.face !== undefined) {
          ctx.globalAlpha = alpha;
          this.drawGhostSlot(ctx, o.x, o.y, o.face, u);
          ctx.globalAlpha = 1;
        } else {
          ctx.beginPath();
          ctx.arc(o.x, o.y, 5, 0, Math.PI * 2);
          ctx.stroke();
        }
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
        if (u.aimId < 0 || (u.side === 1 && !b.sees(0, u))) continue;
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

    // The enemy is drawn only where our scouts can see it; elsewhere a faint mark shows where it was last seen.
    const shown = (u: BUnit) => (u.state === 'ok' || u.state === 'routing') && (u.side === 0 || b.sees(0, u));
    const order = [...b.units].sort((p, q) => p.y - q.y).filter(shown);
    this.drawGhosts(ctx);
    for (const u of order) this.drawUnit(ctx, u);

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

    for (const u of order) this.drawLabel(ctx, u);

    // Melee sparks.
    if (this.phase === 'live' && !this.paused) {
      ctx.fillStyle = '#ffe9a8';
      for (const u of order) {
        if (!u.fighting) continue;
        for (let k = 0; k < 3; k++) {
          const a = u.facing + Math.sin(this.t * 23 + u.id * 3 + k * 2.1) * 0.9;
          const r = 14 + ((this.t * 60 + k * 7 + u.id) % 9);
          ctx.fillRect(u.x + Math.cos(a) * r, u.y + Math.sin(a) * r, 2, 2);
        }
      }
    }

    if (this.s.rain) this.drawRain(ctx);
    // Morning mist and the coming of night.
    const mist = b.mist();
    if (mist > 0) {
      ctx.fillStyle = `rgba(226,230,232,${0.26 * mist})`;
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    }
    const light = b.light();
    if (light < 1) {
      ctx.fillStyle = `rgba(18,22,52,${(1 - light) * 0.75})`;
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    }

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

    if (this.sketch && this.sketch.length > 1 && this.sketchLine) {
      const a = this.sketch[0];
      const e = this.sketch[this.sketch.length - 1];
      const slots = this.lineSlots(a, e);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,233,160,0.9)';
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([8 / z, 5 / z]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(e[0], e[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const s of slots) this.drawGhostSlot(ctx, s.x, s.y, slots.face ?? 0, s.u);
      ctx.restore();
    } else if (this.sketch && this.sketch.length > 1) {
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

  /**
   * Everything drawn over the 3D field: the deployment zone, orders, arrows and shot,
   * smoke, last-seen marks, labels, the commanders' names, floating words, the path
   * or line being drawn, and the selection box. Positions come from View3D.project.
   */
  private drawOverlay3D(ctx: CanvasRenderingContext2D) {
    const v = this.v3!;
    const b = this.b;
    const P = (x: number, y: number, lift = 0) => v.project(x, y, lift);
    const poly = (pts: ([number, number] | null)[]) => {
      let first = true;
      ctx.beginPath();
      for (const p of pts) {
        if (!p) { first = true; continue; }
        if (first) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
        first = false;
      }
    };
    /** A straight ground line, sampled so it follows the hills. */
    const groundLine = (x0: number, y0: number, x1: number, y1: number, lift = 1.5) => {
      const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 25));
      const pts: ([number, number] | null)[] = [];
      for (let i = 0; i <= n; i++) pts.push(P(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, lift));
      return pts;
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.phase === 'deploy') {
      const [y0, y1] = b.deployZone(0);
      ctx.strokeStyle = 'rgba(255,240,200,0.75)';
      ctx.fillStyle = 'rgba(255,240,200,0.08)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      poly([...groundLine(6, y0, FIELD_W - 6, y0), ...groundLine(FIELD_W - 6, y1, 6, y1), P(6, y0, 1.5)]);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Orders for the player's regiments (selected ones bright, the rest faint).
    for (const u of b.units) {
      if (u.side !== 0 || u.state !== 'ok') continue;
      const alpha = this.selected.has(u.id) ? 0.9 : 0.25;
      const o = u.order;
      ctx.lineWidth = 2;
      if (o.kind === 'move') {
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.setLineDash([6, 5]);
        poly(groundLine(u.x, u.y, o.x, o.y));
        ctx.stroke();
        ctx.setLineDash([]);
        const end = P(o.x, o.y, 1.5);
        if (end) {
          ctx.beginPath();
          ctx.arc(end[0], end[1], 4, 0, Math.PI * 2);
          ctx.stroke();
          if (o.face !== undefined) {
            const tip = P(o.x + Math.cos(o.face) * 26, o.y + Math.sin(o.face) * 26, 1.5);
            if (tip) {
              ctx.beginPath();
              ctx.moveTo(end[0], end[1]);
              ctx.lineTo(tip[0], tip[1]);
              ctx.stroke();
            }
          }
        }
      } else if (o.kind === 'path') {
        ctx.strokeStyle = `rgba(255,236,160,${alpha})`;
        ctx.setLineDash([8, 6]);
        const pts: ([number, number] | null)[] = [];
        let px = u.x;
        let py = u.y;
        for (let i = o.i; i < o.pts.length; i++) {
          pts.push(...groundLine(px, py, o.pts[i][0], o.pts[i][1]));
          [px, py] = o.pts[i];
        }
        poly(pts);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (o.kind === 'attack' || o.kind === 'breach') {
        const t = o.kind === 'attack' ? b.get(o.target) : b.segCenter(o.seg);
        if (t) {
          ctx.strokeStyle = `rgba(255,110,90,${alpha})`;
          poly(groundLine(u.x, u.y, t.x, t.y, 3));
          ctx.stroke();
        }
      }
    }

    if (this.phase === 'live') {
      // Arrows arcing between bowmen and their targets.
      ctx.strokeStyle = 'rgba(40,30,20,0.8)';
      ctx.lineWidth = 1.2;
      for (const u of b.units) {
        if (u.aimId < 0 || (u.side === 1 && !b.sees(0, u))) continue;
        const t = b.get(u.aimId);
        if (!t) continue;
        for (let k = 0; k < 4; k++) {
          const f = (this.t * 1.4 + k / 4 + u.id * 0.137) % 1;
          const a = P(u.x + (t.x - u.x) * f, u.y + (t.y - u.y) * f, 10 + Math.sin(f * Math.PI) * 45);
          const c = P(u.x + (t.x - u.x) * (f - 0.03), u.y + (t.y - u.y) * (f - 0.03), 10 + Math.sin((f - 0.03) * Math.PI) * 45);
          if (a && c) {
            ctx.beginPath();
            ctx.moveTo(c[0], c[1]);
            ctx.lineTo(a[0], a[1]);
            ctx.stroke();
          }
        }
      }
      // Volleys, cannonballs, rockets and tower bolts.
      for (const s of b.shots) {
        const f = Math.min(1, s.t / 0.25);
        const a = P(s.x0, s.y0, 8);
        if (!a) continue;
        if (s.kind === 'musket' || s.kind === 'tower' || s.kind === 'fizzle') {
          const e = P(s.x0 + (s.x1 - s.x0) * f, s.y0 + (s.y1 - s.y0) * f, 8);
          if (!e) continue;
          ctx.strokeStyle = s.kind === 'tower' ? `rgba(40,30,20,${1 - f})` : `rgba(255,236,170,${0.85 * (1 - f)})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(e[0], e[1]);
          ctx.stroke();
        } else {
          const arc = s.kind === 'rocket' ? 60 : 30;
          const e = P(s.x0 + (s.x1 - s.x0) * f, s.y0 + (s.y1 - s.y0) * f, 8 + Math.sin(f * Math.PI) * arc);
          if (!e) continue;
          ctx.fillStyle = s.kind === 'rocket' ? 'rgba(255,170,60,0.95)' : '#222';
          ctx.beginPath();
          ctx.arc(e[0], e[1], s.kind === 'rocket' ? 2.5 : 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Clash of steel where regiments are locked together.
      ctx.fillStyle = '#ffe9a8';
      for (const u of b.units) {
        if (!u.fighting || (u.side === 1 && !b.sees(0, u))) continue;
        for (let k = 0; k < 3; k++) {
          const a = u.facing + Math.sin(this.t * 23 + u.id * 3 + k * 2.1) * 0.9;
          const r = 14 + ((this.t * 60 + k * 7 + u.id) % 9);
          const p = P(u.x + Math.cos(a) * r, u.y + Math.sin(a) * r, 6);
          if (p) ctx.fillRect(p[0], p[1], 2, 2);
        }
      }
    }

    // Smoke.
    for (const p of this.particles) {
      const s = P(p.x, p.y, 10 + (1 - p.life / p.max) * 12);
      if (!s) continue;
      const k = v.scaleAt(p.x, p.y);
      ctx.fillStyle = `rgba(${p.color},${(1 - p.life / p.max) * 0.5})`;
      ctx.beginPath();
      ctx.arc(s[0], s[1], Math.max(1, p.size * (0.6 + p.life / p.max) * k * 1.4), 0, Math.PI * 2);
      ctx.fill();
    }

    // Where enemy regiments were last seen.
    if (b.fogOn) {
      ctx.font = '700 14px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const [id, p] of b.lastSeen[0]) {
        const u = b.get(id);
        if (!u || u.state !== 'ok' || b.sees(0, u)) continue;
        const age = b.time - p.t;
        if (age > 60) continue;
        const s = P(p.x, p.y, 10);
        if (!s) continue;
        const a = 0.7 * (1 - age / 60);
        ctx.strokeStyle = `rgba(60,20,15,${a})`;
        ctx.fillStyle = `rgba(60,20,15,${a})`;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(s[0] - 9, s[1] - 9, 18, 18);
        ctx.setLineDash([]);
        ctx.fillText('?', s[0], s[1] + 1);
      }
    }

    // Labels under each counter, and the commanders' names over their standards.
    for (const u of b.units) {
      if ((u.state !== 'ok' && u.state !== 'routing') || (u.side === 1 && !b.sees(0, u))) continue;
      const big = UNIT_STATS[u.type].cls === 'elephant';
      const up = v.raise(u);
      const s = P(u.x, u.y, (big ? 30 : 22) + up);
      if (!s) continue;
      const k = Math.max(0.55, Math.min(1.2, v.scaleAt(u.x, u.y) * 1.6));
      this.labelAt(ctx, u, s[0], s[1] + 15 * k * 1.1, 1);
      if (b.generalIds[u.side] === u.id && u.state === 'ok') {
        const top = P(u.x, u.y, 48 + up);
        const name = (u.side === 0 ? this.s.playerGeneral : this.s.enemyGeneral)?.toUpperCase();
        if (top && name) {
          ctx.font = '700 11px Cinzel, Georgia, serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const w = ctx.measureText(name).width + 14;
          ctx.fillStyle = '#f1e6c8';
          ctx.strokeStyle = '#3a2a18';
          ctx.lineWidth = 1;
          ctx.fillRect(top[0] + 6 - w / 2, top[1] - 16, w, 16);
          ctx.strokeRect(top[0] + 6 - w / 2, top[1] - 16, w, 16);
          ctx.fillStyle = '#2a1d12';
          ctx.fillText(name, top[0] + 6, top[1] - 7.5);
        }
      }
    }

    // Floating words.
    ctx.textAlign = 'center';
    ctx.font = '700 13px Georgia, serif';
    for (const fl of b.floaters) {
      const s = P(fl.x, fl.y + 30, 34 + fl.t * 22);
      if (!s) continue;
      ctx.globalAlpha = Math.max(0, 1 - fl.t / 1.6);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(fl.text, s[0], s[1]);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, s[0], s[1]);
    }
    ctx.globalAlpha = 1;

    // The path or battle line being drawn.
    if (this.sketch && this.sketch.length > 1) {
      const sk = this.sketch;
      if (this.sketchLine) {
        const a = sk[0];
        const e = sk[sk.length - 1];
        ctx.strokeStyle = 'rgba(255,233,160,0.95)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 5]);
        poly(groundLine(a[0], a[1], e[0], e[1]));
        ctx.stroke();
        ctx.setLineDash([]);
        const slots = this.lineSlots(a, e);
        const face = slots.face ?? 0;
        for (const s of slots) {
          const c = P(s.x, s.y, 1.5);
          const tip = P(s.x + Math.cos(face) * 18, s.y + Math.sin(face) * 18, 1.5);
          if (!c || !tip) continue;
          ctx.fillStyle = 'rgba(255,236,170,0.35)';
          ctx.strokeStyle = 'rgba(255,236,170,0.95)';
          ctx.beginPath();
          ctx.arc(c[0], c[1], 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(c[0], c[1]);
          ctx.lineTo(tip[0], tip[1]);
          ctx.stroke();
        }
      } else {
        const pts: ([number, number] | null)[] = [];
        for (let i = 1; i < sk.length; i++) pts.push(...groundLine(sk[i - 1][0], sk[i - 1][1], sk[i][0], sk[i][1]));
        ctx.strokeStyle = 'rgba(20,15,10,0.5)';
        ctx.lineWidth = 7;
        poly(pts);
        ctx.stroke();
        ctx.strokeStyle = '#ffe9a0';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    if (this.dragS) {
      const d = this.dragS;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
      ctx.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    }

    if (this.s.rain) {
      ctx.strokeStyle = 'rgba(210,222,238,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 180; i++) {
        const x = ((i * 137.5 + this.t * 70) % (VIEW_W + 60)) - 30;
        const y = ((i * 91.3 + this.t * 620) % (VIEW_H + 40)) - 20;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 4, y + 13);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** An outline of where a regiment will stand and which way it will face. */
  private drawGhostSlot(ctx: CanvasRenderingContext2D, x: number, y: number, face: number, u: BUnit) {
    const S = this.tileSize(u);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(face + Math.PI / 2);
    ctx.fillStyle = 'rgba(255,236,170,0.18)';
    ctx.strokeStyle = 'rgba(255,236,170,0.95)';
    ctx.lineWidth = 1.6;
    ctx.fillRect(-S / 2, -S / 2, S, S);
    ctx.strokeRect(-S / 2, -S / 2, S, S);
    // Facing arrow off the front edge.
    ctx.beginPath();
    ctx.moveTo(-6, -S / 2 - 2);
    ctx.lineTo(0, -S / 2 - 10);
    ctx.lineTo(6, -S / 2 - 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Darkens the ground none of our regiments can see. */
  private drawShroud(ctx: CanvasRenderingContext2D) {
    const K = 8;
    const c = this.shroud;
    if (this.t - this.shroudT > 0.2 || c.width === 0) {
      this.shroudT = this.t;
      c.width = Math.ceil(FIELD_W / K);
      c.height = Math.ceil(FIELD_H / K);
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(16,13,8,0.24)';
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-out';
      for (const u of this.b.units) {
        if (u.side !== 0 || u.state !== 'ok') continue;
        const r = this.b.sightOf(u) / K;
        const grad = g.createRadialGradient(u.x / K, u.y / K, r * 0.6, u.x / K, u.y / K, r);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(u.x / K, u.y / K, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, 0, 0, FIELD_W, FIELD_H);
    ctx.restore();
  }

  /** Dashed outlines where enemy regiments were last seen (fading over a minute). */
  private drawGhosts(ctx: CanvasRenderingContext2D) {
    const b = this.b;
    if (!b.fogOn) return;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.font = '700 14px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [id, p] of b.lastSeen[0]) {
      const u = b.get(id);
      if (!u || u.state !== 'ok' || b.sees(0, u)) continue;
      const age = b.time - p.t;
      if (age > 60) continue;
      const a = 0.6 * (1 - age / 60);
      ctx.strokeStyle = `rgba(60,20,15,${a})`;
      ctx.fillStyle = `rgba(60,20,15,${a})`;
      ctx.strokeRect(p.x - 14, p.y - 14, 28, 28);
      ctx.fillText('?', p.x, p.y + 1);
    }
    ctx.restore();
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
    const spread = u.formation === 'loose' ? 1.45 : u.formation === 'tight' || u.formation === 'brace' ? 0.75 : 1;
    const front = (S * 0.9 + men * (st.cls === 'cavalry' ? 0.75 : 0.45)) * spread;
    const depth = S * 0.75 * (u.formation === 'loose' ? 1.4 : 1);
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
    // Formation marks on the front edge: a row of levelled spears, or a wedge's point.
    ctx.strokeStyle = 'rgba(22,13,8,0.95)';
    ctx.lineWidth = 1.6;
    if (u.formation === 'brace') {
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) {
        ctx.moveTo(i * S * 0.2, -S / 2);
        ctx.lineTo(i * S * 0.2, -S / 2 - 7);
      }
      ctx.stroke();
    } else if (u.formation === 'wedge') {
      ctx.beginPath();
      ctx.moveTo(-S / 2, -S / 2);
      ctx.lineTo(0, -S / 2 - 9);
      ctx.lineTo(S / 2, -S / 2);
      ctx.stroke();
    } else if (u.formation === 'tight') {
      ctx.strokeRect(-S / 2 - 3, -S / 2 - 3, S + 6, S + 6);
    } else if (u.formation === 'loose') {
      ctx.setLineDash([3, 4]);
      ctx.strokeRect(-S / 2 - 4, -S / 2 - 4, S + 8, S + 8);
      ctx.setLineDash([]);
    }
    // Veteran chevrons in the corner.
    if (u.rank > 0) {
      ctx.strokeStyle = '#f2d27a';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < u.rank; i++) {
        const y = S / 2 - 4 - i * 3.5;
        ctx.beginPath();
        ctx.moveTo(S / 2 - 10, y);
        ctx.lineTo(S / 2 - 6.5, y - 3);
        ctx.lineTo(S / 2 - 3, y);
        ctx.stroke();
      }
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
    const k = 1 / this.cam.z;
    this.labelAt(ctx, u, u.x, u.y + this.tileSize(u) * 0.5 + 9 * k, k);
  }

  /** The label drawn at (x, y) in the current coordinates, scaled by k. */
  private labelAt(ctx: CanvasRenderingContext2D, u: BUnit, lx: number, ly: number, k: number) {
    const st = UNIT_STATS[u.type];
    ctx.save();
    ctx.translate(lx, ly);
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
    let y = 11;
    if (st.reload > 0 && u.state === 'ok') {
      const r = 1 - Math.max(0, u.reload) / st.reload;
      ctx.fillStyle = 'rgba(30,20,10,0.45)';
      ctx.fillRect(-13, y, 26, 2);
      ctx.fillStyle = '#4f7fa8';
      ctx.fillRect(-13, y, 26 * r, 2);
      y += 3;
    }
    if (u.maxAmmo > 0 && Number.isFinite(u.maxAmmo) && u.state === 'ok') {
      ctx.fillStyle = 'rgba(30,20,10,0.45)';
      ctx.fillRect(-13, y, 26, 2);
      ctx.fillStyle = u.ammo > 0 ? '#8a6a3a' : '#b8432f';
      ctx.fillRect(-13, y, 26 * (u.ammo / u.maxAmmo), 2);
      y += 3;
    }
    if (u.fatigue > 0.2 && u.state === 'ok') {
      ctx.fillStyle = 'rgba(30,20,10,0.45)';
      ctx.fillRect(-13, y, 26, 2);
      ctx.fillStyle = u.fatigue > 0.6 ? '#c46a2a' : '#d8b04a';
      ctx.fillRect(-13, y, 26 * u.fatigue, 2);
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

  /** The battle meter across the top: whose favour the battle is going in, and where an army breaks. */
  private drawMeter(ctx: CanvasRenderingContext2D) {
    const b = this.b;
    if (b.walls) return;
    const w = 320;
    const x = VIEW_W / 2 - w / 2;
    const y = 12;
    const share = Math.max(0, Math.min(1, b.balance));
    ctx.save();
    ctx.fillStyle = 'rgba(20,15,10,0.78)';
    ctx.beginPath();
    ctx.roundRect(x - 10, y - 6, w + 20, 34, 10);
    ctx.fill();
    ctx.fillStyle = this.s.playerFaction.color;
    ctx.fillRect(x, y, w * share, 10);
    ctx.fillStyle = this.s.enemyFaction.color;
    ctx.fillRect(x + w * share, y, w * (1 - share), 10);
    // Where the enemy army breaks and asks for terms.
    const T = Battle.SURRENDER;
    ctx.strokeStyle = 'rgba(255,240,200,0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(x + w * (1 - T), y - 3);
    ctx.lineTo(x + w * (1 - T), y + 13);
    ctx.stroke();
    ctx.setLineDash([]);
    // The needle.
    ctx.fillStyle = '#fff4d6';
    ctx.fillRect(x + w * share - 1.5, y - 4, 3, 18);
    ctx.font = '600 11px Georgia, serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4e3b5';
    ctx.textAlign = 'left';
    ctx.fillText(`${this.s.playerFaction.short} ${Math.round(share * 100)}%`, x, y + 20);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round((1 - share) * 100)}% ${this.s.enemyFaction.short}`, x + w, y + 20);
    ctx.textAlign = 'center';
    const m = share - 0.5;
    ctx.fillText(b.surrenderOffered ? (b.pursuit ? 'The enemy is broken: pursuit!' : 'The enemy is broken') : Math.abs(m) < 0.06 ? 'The battle hangs in the balance'
      : m > 0 ? (m > 0.2 ? 'The day is yours' : 'The battle goes your way') : (m < -0.2 ? 'The day is going against you' : 'The battle turns against you'), VIEW_W / 2, y + 20);
    const next = b.nextArrival();
    if (next && !this.s.encircled) {
      ctx.fillStyle = 'rgba(20,15,10,0.78)';
      ctx.beginPath();
      ctx.roundRect(x - 10, y + 30, w + 20, 20, 8);
      ctx.fill();
      ctx.fillStyle = next.side === 1 ? '#ff9a8a' : '#ffd27a';
      const s = Math.ceil(next.inSec);
      ctx.fillText(`${next.who} comes up in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${next.side === 1 ? ' · win before then, or get away' : ''}`, VIEW_W / 2, y + 40);
    }
    const ring = this.s.encircled;
    if (ring) {
      const who = ring.side === 1 ? (this.s.enemyGeneral ?? 'the enemy') : 'your army';
      ctx.fillStyle = 'rgba(20,15,10,0.78)';
      ctx.beginPath();
      ctx.roundRect(x - 10, y + 30, w + 20, 20, 8);
      ctx.fill();
      ctx.fillStyle = '#ffd27a';
      ctx.fillText(`Hunger in the camp of ${who}: ${Math.round(b.hunger * 100)}%${b.reliefCame ? ' · his guns have come up' : ''} · if he reaches the field's edge he escapes`, VIEW_W / 2, y + 40);
    }
    ctx.restore();
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    this.drawMeter(ctx);
    let text: string;
    if (this.phase === 'deploy') text = 'DEPLOYMENT · RIGHT-CLICK TO PLACE · RIGHT-DRAG FOR A LINE · SPACE TO BEGIN';
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
      `${u.side === 0 ? 'Your' : 'Enemy'} ${st.name}${u.ref.label ? `: ${u.ref.label}` : ''}`,
      `${Math.ceil(u.men)}/${u.maxMen} ${st.cls === 'elephant' ? 'elephants' : 'men'} · morale ${Math.round(u.morale)} · tier ${st.tier} · ${VET_NAMES[u.rank]}`,
      `${FORMATION_NAMES[u.formation]} · ${fatigueName(u.fatigue)}${u.maxAmmo > 0 && Number.isFinite(u.maxAmmo) ? ` · ammo ${Math.round((u.ammo / u.maxAmmo) * 100)}%` : ''}`,
      statusOf(u, this.b) + (where ? ` · ${where}` : ''),
    ];
    ctx.save();
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const x = Math.min(VIEW_W - w - 6, this.mouse.x + 16);
    const y = Math.min(VIEW_H - 72, this.mouse.y + 16);
    ctx.fillStyle = 'rgba(20,15,10,0.9)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, 66, 6);
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
      s.rain ? h('div', { class: 'stat muted' }, '🌧 Rain: bows and matchlocks suffer, mud slows everyone') : null,
      s.fog ? h('div', { class: 'stat muted' }, '🌫 Morning mist: short sight until it lifts') : null,
      s.dusk ? h('div', { class: 'stat muted' }, '🌇 Late in the day: night will end the battle') : null,
      h('div', { class: 'stat push btns', style: 'margin:0' },
        ...[1, 2, 3].map((n) => h('button', { class: `small ${this.speed === n ? 'primary' : ''}`, onclick: () => { this.speed = n; this.renderUI(); } }, `${n}×`)),
        h('button', {
          class: `small ${this.use3D ? 'primary' : ''}`, title: 'Switch between the 3D battlefield and the flat map view',
          onclick: () => this.toggle3D(),
        }, this.use3D ? (this.v3 ? '3D' : '3D…') : '2D'),
        this.v3 ? h('button', { class: 'small', title: 'Turn the view left (Z)', onclick: () => this.v3?.rotate(0.35) }, '⟲') : null,
        this.v3 ? h('button', { class: 'small', title: 'Turn the view right (C)', onclick: () => this.v3?.rotate(-0.35) }, '⟳') : null,
      ),
    );
    this.listEl = h('div', { class: 'stack' });
    this.statusEl = h('div', {});
    this.ordersEl = h('div', { class: 'card' });
    this.ordersSig = '';
    const deploying = this.phase === 'deploy';
    clear(ui.side).append(
      h('div', { class: 'card' },
        h('h3', {}, deploying ? 'Deployment' : this.phase === 'done' ? 'Battle over' : this.paused ? 'Paused' : 'Battle in progress'),
        h('p', { class: 'muted' }, deploying
          ? 'Select regiments and right-click inside the dashed zone to position them, or right-drag to lay them out along a line at any angle. The enemy cannot move until you begin.'
          : 'Real-time. Pause with Space at any moment to give orders.'),
        h('div', { class: 'btns' },
          deploying
            ? h('button', { class: 'primary', onclick: () => this.start() }, 'Begin battle (Space)')
            : h('button', { class: 'primary', disabled: this.phase === 'done', onclick: () => this.togglePause() }, this.paused ? 'Resume (Space)' : 'Pause (Space)'),
          h('button', { disabled: this.phase === 'done', onclick: () => this.finish(false, true) }, 'Retreat'),
        ),
        this.statusEl,
        s.leaderNotes ? h('div', { class: 'muted', style: 'margin-top:6px;font-size:12.5px' }, `Your commander: ${s.leaderNotes[0]}`) : null,
        s.leaderNotes ? h('div', { class: 'muted', style: 'font-size:12.5px' }, `Theirs: ${s.leaderNotes[1]}`) : null,
      ),
      this.ordersEl,
      h('div', { class: 'card' }, h('h3', {}, 'How to fight'),
        h('ul', { class: 'help' },
          h('li', {}, 'Left-click or drag to select. Shift adds. Right-click: move, or attack an enemy.'),
          h('li', {}, 'Right-drag to draw a curved path; the regiments follow it in formation (end it on an enemy to attack).'),
          h('li', {}, 'Shift+right-drag (or Q for line mode) draws a battle line at any angle: the selected regiments spread along it, in ranks if needed (foot in front, then shooters, horse and guns), and wheel to face it. Drag left to right to face up the field, right to left to face down (the arrows show which way). During deployment, right-drag always draws a line.'),
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
          h('li', {}, 'Fog of war: you see only what your regiments see. Light horse scout furthest, high ground helps, and woods and villages hide whoever keeps still in them.'),
          h('li', {}, 'Ganimi kava: hide Mavalas or horse in a wood and strike from it for an ambush. Order light horse to feign flight (F) to draw the enemy out of line, then wheel on the stragglers.'),
          h('li', {}, 'Formations: N open, T tight block, L loose order, B spear hedge, G cavalry wedge.'),
          h('li', {}, 'Men tire from marching, running and fighting. Rest them before the clash. Archers and gunners run short and must go back to the baggage at your edge to refill.'),
          h('li', {}, 'R: the commander rallies the army around his standard. Routed regiments near him come back sooner. Elephants panic under rockets and shot and can run amok through your own lines.'),
          h('li', {}, 'Scroll or pinch to zoom; WASD, arrow keys or middle-drag to pan.'),
          h('li', {}, '3D view: Z and C (or the ⟲ ⟳ buttons) turn the camera; Shift+middle-drag turns and tilts it. The 3D/2D button switches to the flat map.'),
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
        b.fogOn
          ? `Enemy: ${ok.filter((u) => b.sees(0, u)).length} regiments in sight (${foes.length} took the field)`
          : `Enemy: ${ok.length}/${foes.length} regiments fighting, ${Math.round(ok.reduce((n, u) => n + u.men, 0))} men`),
      W ? h('div', { class: 'muted' }, `Gate ${Math.round((W.segs[5].hp / W.segs[5].maxHp) * 100)}% · ${W.segs.filter((x) => x.hp <= 0).length} breaches · square ${Math.round(W.capture * 100)}% taken`) : null,
    );
    this.refreshList();
  }

  /** Formation, feint and rally buttons for the current selection. */
  private refreshOrders() {
    const el = this.ordersEl;
    if (!el) return;
    const sel = this.mySelected();
    const b = this.b;
    const sig = [...sel.map((u) => `${u.id}${u.formation}${u.feignT > 0}`), this.phase, Math.ceil(b.rallyCd[0]), b.generalLost[0], this.lineMode].join(',');
    if (sig === this.ordersSig) return;
    this.ordersSig = sig;
    const forms = new Set<Formation>();
    for (const u of sel) for (const f of formationsFor(u.type)) forms.add(f);
    const horse = sel.some((u) => UNIT_STATS[u.type].cls === 'cavalry');
    const live = this.phase === 'live';
    const key: Record<Formation, string> = { normal: 'N', tight: 'T', loose: 'L', brace: 'B', wedge: 'G' };
    fill(el,
      h('h3', {}, 'Orders'),
      sel.length ? null : h('p', { class: 'muted' }, 'Select regiments to change their formation.'),
      forms.size > 1 ? h('div', { class: 'btns' }, ...[...forms].map((f) => h('button', {
        class: `small ${sel.every((u) => u.formation === f || !formationsFor(u.type).includes(f)) ? 'primary' : ''}`,
        title: FORMATION_HELP[f], onclick: () => this.formSelected(f),
      }, `${FORMATION_NAMES[f]} (${key[f]})`))) : null,
      h('div', { class: 'btns' },
        h('button', {
          class: `small ${this.lineMode ? 'primary' : ''}`,
          title: 'When on, a right-drag draws a battle line: the selected regiments spread along it, facing the enemy. When off, it draws a march path. Shift+right-drag always draws a line.',
          onclick: () => { this.lineMode = !this.lineMode; this.ordersSig = ''; this.refreshOrders(); },
        }, this.lineMode ? '📏 Line mode (Q)' : '〰 Path mode (Q)'),
        horse ? h('button', { class: 'small', disabled: !live, title: 'Gallop away as if beaten, drawing pursuers out of their line, then wheel about.', onclick: () => this.feignSelected() }, '🐎 Feigned flight (F)') : null,
        h('button', {
          class: 'small', disabled: !live || b.generalLost[0] || b.rallyCd[0] > 0,
          title: 'Your commander rides along the line: nearby regiments steady, routed ones turn back.', onclick: () => this.rally(),
        }, b.generalLost[0] ? 'Commander fallen' : b.rallyCd[0] > 0 ? `Rally (${Math.ceil(b.rallyCd[0])}s)` : '🚩 Rally (R)'),
      ),
    );
  }

  private refreshList() {
    this.refreshOrders();
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
  if (u.feignT > 0) return 'feigning flight';
  if (u.disengageT > 0) return 'falling back';
  if (u.fighting) return 'fighting';
  if (u.aimId >= 0) return 'shooting';
  if (u.maxAmmo > 0 && u.ammo <= 0) return b.atBaggage(u) ? 'resupplying' : 'out of ammo';
  if (u.luredT > 0) return 'pursuing, disordered';
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
  // Height field once, for shading and contours.
  const H = new Float32Array(FIELD_W * FIELD_H);
  for (let y = 0; y < FIELD_H; y++) for (let x = 0; x < FIELD_W; x++) H[y * FIELD_W + x] = b.height({ x, y });
  const at = (x: number, y: number) => H[Math.max(0, Math.min(FIELD_H - 1, y)) * FIELD_W + Math.max(0, Math.min(FIELD_W - 1, x))];
  const LEVELS = 7;
  for (let y = 0; y < FIELD_H; y++) {
    for (let x = 0; x < FIELD_W; x++) {
      const v = fbm(n, x / 140, y / 140, 4);
      const f = fine(x / 6, y / 6) - 0.5;
      const hgt = H[y * FIELD_W + x];
      // Hillshade, lit from the north-west: sunlit slopes glow, far slopes fall into shadow.
      const slope = (at(x - 3, y - 3) - at(x + 3, y + 3)) * 9;
      const shade = Math.max(-0.38, Math.min(0.32, slope));
      let k = (0.84 + 0.3 * v + shade) * rainK;
      // Higher ground turns from olive to warm ochre and rock.
      const up = Math.min(1, hgt * 1.2);
      let r = gr * (1 - up * 0.1) + 40 * up;
      let gg2 = gg * (1 - up * 0.18) + 8 * up;
      let bb = gb * (1 - up * 0.3);
      // Contour lines at even heights; every third one heavier.
      const lv = Math.floor(hgt * LEVELS);
      if (hgt > 0.03 && (Math.floor(at(x + 1, y) * LEVELS) !== lv || Math.floor(at(x, y + 1) * LEVELS) !== lv)) {
        k *= lv % 3 === 0 ? 0.62 : 0.76;
        r = r * 0.92 + 8;
      }
      const i = (y * FIELD_W + x) * 4;
      img.data[i] = r * k + f * 10;
      img.data[i + 1] = gg2 * k + f * 10;
      img.data[i + 2] = bb * k + f * 8;
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

  // Hachures: short strokes running down the steep slopes, as on an old survey map.
  const hr = new RNG(s.seed + 29);
  g.lineCap = 'round';
  for (let i = 0; i < 26000; i++) {
    const x = hr.range(0, FIELD_W);
    const y = hr.range(0, FIELD_H);
    const dx = (at(Math.round(x) + 2, Math.round(y)) - at(Math.round(x) - 2, Math.round(y))) / 4;
    const dy = (at(Math.round(x), Math.round(y) + 2) - at(Math.round(x), Math.round(y) - 2)) / 4;
    const grade = Math.hypot(dx, dy);
    if (grade < 0.0035) continue;
    const len = Math.min(9, 3 + grade * 900);
    g.strokeStyle = `rgba(78,52,24,${Math.min(0.5, 0.12 + grade * 40)})`;
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - (dx / grade) * len, y - (dy / grade) * len);
    g.stroke();
  }

  // Marshes: dark pools and reeds.
  const mr = new RNG(s.seed + 11);
  for (const m of b.marshes) {
    for (let i = 0; i < 9; i++) {
      const a = mr.range(0, Math.PI * 2);
      const d = mr.range(0, m.r * 0.6);
      g.fillStyle = 'rgba(58,98,104,0.5)';
      g.beginPath();
      g.ellipse(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, m.r * mr.range(0.35, 0.55), m.r * mr.range(0.25, 0.4), mr.range(0, 3), 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(40,62,34,0.85)';
    g.lineWidth = 1.2;
    for (let i = 0; i < m.r * 2; i++) {
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
    g.strokeStyle = 'rgba(132,150,96,0.6)'; // reedy banks (narrower for a small stream)
    g.lineWidth = r.w + Math.min(34, r.w * 1.2);
    g.stroke(path);
    g.strokeStyle = 'rgba(92,72,44,0.95)';
    g.lineWidth = r.w + Math.min(10, r.w * 0.4);
    g.stroke(path);
    if (r.shallow) {
      // Low water in the dry season: a sandy bed with a thin channel, fordable anywhere.
      g.strokeStyle = 'rgba(206,186,140,0.95)';
      g.lineWidth = r.w;
      g.stroke(path);
    }
    g.strokeStyle = '#3f74a0';
    g.lineWidth = r.shallow ? r.w * 0.45 : r.w;
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
    // Patchwork fields around the village.
    for (let i = 0; i < 10; i++) {
      const a = vr.range(0, Math.PI * 2);
      const d = vr.range(v.r * 1.05, v.r * 1.9);
      g.save();
      g.translate(v.x + Math.cos(a) * d, v.y + Math.sin(a) * d);
      g.rotate(vr.range(-0.5, 0.5));
      const w = vr.range(28, 50);
      const hh = vr.range(18, 32);
      g.fillStyle = vr.chance(0.5) ? 'rgba(214,190,110,0.45)' : 'rgba(140,150,72,0.4)';
      g.fillRect(-w / 2, -hh / 2, w, hh);
      g.strokeStyle = 'rgba(100,80,40,0.35)';
      g.lineWidth = 1;
      g.strokeRect(-w / 2, -hh / 2, w, hh);
      g.restore();
    }
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

  // Summit marks on the higher hills.
  for (const hl of b.hills) {
    if (hl.h < 0.6) continue;
    g.fillStyle = 'rgba(70,44,20,0.8)';
    g.beginPath();
    g.moveTo(hl.x, hl.y - 7);
    g.lineTo(hl.x - 6, hl.y + 4);
    g.lineTo(hl.x + 6, hl.y + 4);
    g.closePath();
    g.fill();
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
    soft.addColorStop(0, 'rgba(34,48,24,0.78)');
    soft.addColorStop(0.75, 'rgba(38,52,26,0.6)');
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
      g.fillStyle = shade === 0 ? 'rgba(22,32,16,0.85)' : shade === 1 ? 'rgba(50,66,34,0.8)' : 'rgba(92,106,58,0.65)';
      g.beginPath();
      g.arc(x, y, rng.range(1.2, 3.2), 0, Math.PI * 2);
      g.fill();
    }
    // Tree crowns: a shadow, a dark crown and a sunlit highlight.
    const crowns = Math.floor(f.r * f.r * 0.012);
    for (let i = 0; i < crowns; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = f.r * 0.92 * Math.sqrt(rng.next());
      const x = f.x + Math.cos(a) * r;
      const y = f.y + Math.sin(a) * r;
      const cr = rng.range(5, 9);
      g.fillStyle = 'rgba(16,20,10,0.35)';
      g.beginPath();
      g.arc(x + 2.5, y + 3, cr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(40,58,28,0.95)';
      g.beginPath();
      g.arc(x, y, cr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(110,130,70,0.6)';
      g.beginPath();
      g.arc(x - cr * 0.3, y - cr * 0.3, cr * 0.45, 0, Math.PI * 2);
      g.fill();
    }
    // A dark edge so the wood reads as a block of cover.
    g.strokeStyle = 'rgba(26,36,18,0.55)';
    g.lineWidth = 2;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  // Names of the real places on a historical field, as on an old campaign map.
  for (const l of b.opts.map?.labels ?? []) {
    g.save();
    g.translate(l.x, l.y);
    g.rotate(l.rot ?? 0);
    g.font = `italic 600 ${l.size ?? 26}px "EB Garamond", Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(250,244,226,0.75)';
    g.strokeText(l.text, 0, 0);
    g.fillStyle = 'rgba(52,40,24,0.9)';
    g.fillText(l.text, 0, 0);
    g.restore();
  }
  const grad = g.createRadialGradient(FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.35, FIELD_W / 2, FIELD_H / 2, FIELD_W * 0.7);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(40,30,10,0.28)');
  g.fillStyle = grad;
  g.fillRect(0, 0, FIELD_W, FIELD_H);
  return c;
}
