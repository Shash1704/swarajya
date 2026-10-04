import { Scene } from '../app';
import { bar, clear, h, hideModal, modalOpen, showModal, swatch, ui } from '../ui';
import { fbm, makeNoise } from '../noise';
import { RNG } from '../rng';
import { UNIT_ICON, UNIT_STATS } from '../data';
import type { Army, Faction } from '../campaign/state';
import { Battle, BUnit, EXEC_TIME, FIELD_H, FIELD_W, MAX_ROUNDS } from './battle';

export interface BattleSetup {
  playerArmy: Army;
  enemyArmy: Army;
  playerAttacks: boolean;
  provinceName: string;
  seed: number;
  playerFaction: Faction;
  enemyFaction: Faction;
  onDone(playerWon: boolean): void;
}

const STEP = 1 / 60;

export class BattleScene implements Scene {
  private b: Battle;
  private phase: 'plan' | 'exec' | 'done' = 'plan';
  private execLeft = 0;
  private acc = 0;
  private uiTimer = 0;
  private t = 0;
  private selected = new Set<number>();
  private drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private mouse = { x: -100, y: -100 };
  private bg: HTMLCanvasElement;
  private listEl: HTMLElement | null = null;
  private notice = '';
  private noticeT = 0;

  constructor(private s: BattleSetup) {
    this.b = new Battle(s.playerArmy.units, s.enemyArmy.units, !s.playerAttacks, s.seed);
    this.bg = renderBattlefield(this.b, s.seed);
    this.b.planAI();
  }

  enter() {
    this.renderUI();
  }

  // ---------------------------------------------------------------- loop

  update(dt: number) {
    this.t += dt;
    this.noticeT = Math.max(0, this.noticeT - dt);
    if (this.phase !== 'exec') return;
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= STEP && this.phase === 'exec') {
      this.acc -= STEP;
      this.b.step(STEP);
      this.execLeft -= STEP;
      if (this.b.winner >= 0) {
        this.finish(this.b.winner === 0);
        return;
      }
      if (this.execLeft <= 0) {
        this.b.round++;
        if (this.b.round > MAX_ROUNDS) {
          this.say('The day is spent; the defender holds the field.');
          this.finish(this.b.defenderSide === 0);
          return;
        }
        this.phase = 'plan';
        this.b.planAI();
        this.renderUI();
      }
    }
    this.uiTimer += dt;
    if (this.uiTimer > 0.25) {
      this.uiTimer = 0;
      this.refreshList();
    }
  }

  private execute() {
    if (this.phase !== 'plan' || modalOpen()) return;
    this.phase = 'exec';
    this.execLeft = EXEC_TIME;
    this.renderUI();
  }

  private finish(won: boolean, retreated = false) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    const winnerSide = won ? 0 : 1;
    let before = [0, 0];
    let after = [0, 0];
    for (const u of this.b.units) {
      let m = u.men;
      if (u.state === 'dead') m = 0;
      else if (u.state === 'fled') m *= u.side === winnerSide ? 0.85 : 0.5;
      else if (u.side !== winnerSide) m *= retreated ? 0.85 : 0.8;
      u.ref.men = Math.floor(m);
      before[u.side] += u.startMen;
      after[u.side] += u.ref.men;
    }
    before = before.map(Math.round);
    after = after.map(Math.round);
    this.renderUI();
    const body = h('div', {},
      h('p', {}, won
        ? `The ${this.s.enemyFaction.name} army breaks and flees the field at ${this.s.provinceName}.`
        : retreated
          ? `You sound the retreat at ${this.s.provinceName}. The army withdraws in good order.`
          : `Your lines break at ${this.s.provinceName}.`),
      h('div', { class: 'versus' },
        h('div', { class: 'card' }, h('h3', {}, swatch(this.s.playerFaction.color), 'Your losses'),
          h('div', {}, `${before[0] - after[0]} of ${before[0]} men`)),
        h('div', { class: 'card' }, h('h3', {}, swatch(this.s.enemyFaction.color), 'Enemy losses'),
          h('div', {}, `${before[1] - after[1]} of ${before[1]} men`)),
      ),
    );
    showModal(won ? 'Victory!' : 'Defeat', body, [
      { label: 'Return to the campaign map', primary: true, onClick: () => { hideModal(); this.s.onDone(won); } },
    ]);
  }

  private say(msg: string) {
    this.notice = msg;
    this.noticeT = 2.5;
  }

  // ---------------------------------------------------------------- input

  private unitAt(x: number, y: number, side: 0 | 1): BUnit | null {
    let best: BUnit | null = null;
    let bd = 26;
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

  pointerDown(x: number, y: number, button: number, e: PointerEvent) {
    if (this.phase === 'done' || modalOpen()) return;
    if (button === 2) {
      this.issueOrder(x, y);
      return;
    }
    if (button !== 0) return;
    const u = this.unitAt(x, y, 0);
    if (u) {
      if (e.shiftKey) {
        if (this.selected.has(u.id)) this.selected.delete(u.id);
        else this.selected.add(u.id);
      } else {
        this.selected = new Set([u.id]);
      }
    } else {
      this.drag = { x0: x, y0: y, x1: x, y1: y };
      if (!e.shiftKey) this.selected.clear();
    }
    this.refreshList();
  }

  pointerMove(x: number, y: number) {
    this.mouse = { x, y };
    if (this.drag) {
      this.drag.x1 = x;
      this.drag.y1 = y;
    }
  }

  pointerUp() {
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
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.execute();
    } else if (e.key === 'Escape') {
      this.selected.clear();
      this.refreshList();
    } else if (e.key.toLowerCase() === 'a' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.selected = new Set(this.b.units.filter((u) => u.side === 0 && u.state === 'ok').map((u) => u.id));
      this.refreshList();
    }
  }

  private issueOrder(x: number, y: number) {
    if (this.phase !== 'plan') {
      this.say('Orders can only be given while planning. Wait for this round to finish.');
      return;
    }
    const sel = this.b.units.filter((u) => this.selected.has(u.id) && u.state === 'ok' && u.side === 0);
    if (!sel.length) {
      this.say('Select a regiment first (left-click or drag a box).');
      return;
    }
    const enemy = this.unitAt(x, y, 1);
    if (enemy) {
      for (const u of sel) u.order = { kind: 'attack', target: enemy.id };
      this.refreshList();
      return;
    }
    // Move as a group, keeping the current formation.
    const cx = sel.reduce((s, u) => s + u.x, 0) / sel.length;
    const cy = sel.reduce((s, u) => s + u.y, 0) / sel.length;
    for (const u of sel) {
      const tx = sel.length === 1 ? x : x + (u.x - cx);
      const ty = sel.length === 1 ? y : y + (u.y - cy);
      u.order = { kind: 'move', x: Math.max(15, Math.min(FIELD_W - 15, tx)), y: Math.max(15, Math.min(FIELD_H - 15, ty)) };
    }
    this.refreshList();
  }

  // ---------------------------------------------------------------- drawing

  draw(ctx: CanvasRenderingContext2D) {
    ctx.drawImage(this.bg, 0, 0);
    const b = this.b;

    // Player orders.
    for (const u of b.units) {
      if (u.side !== 0 || u.state !== 'ok') continue;
      const alpha = this.phase === 'plan' ? 0.9 : 0.35;
      ctx.save();
      ctx.lineWidth = 2;
      if (u.order.kind === 'move') {
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(u.order.x, u.order.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(u.order.x, u.order.y, 5, 0, Math.PI * 2);
        ctx.stroke();
      } else if (u.order.kind === 'attack') {
        const t = b.get(u.order.target);
        if (t && t.state !== 'dead' && t.state !== 'fled') {
          ctx.strokeStyle = `rgba(255,110,90,${alpha})`;
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath();
          ctx.moveTo(u.x, u.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
          const ang = Math.atan2(t.y - u.y, t.x - u.x);
          const ex = t.x - Math.cos(ang) * 22;
          const ey = t.y - Math.sin(ang) * 22;
          ctx.beginPath();
          ctx.moveTo(ex + Math.cos(ang) * 6, ey + Math.sin(ang) * 6);
          ctx.lineTo(ex + Math.cos(ang + 2.5) * 9, ey + Math.sin(ang + 2.5) * 9);
          ctx.lineTo(ex + Math.cos(ang - 2.5) * 9, ey + Math.sin(ang - 2.5) * 9);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Arrow volleys.
    if (this.phase === 'exec') {
      ctx.save();
      ctx.strokeStyle = 'rgba(40,30,20,0.75)';
      ctx.lineWidth = 1.2;
      for (const u of b.units) {
        if (u.shootingAt < 0) continue;
        const t = b.get(u.shootingAt);
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

    const order = [...b.units].sort((p, q) => (p.state === 'routing' ? -1 : 0) - (q.state === 'routing' ? -1 : 0));
    for (const u of order) if (u.state === 'ok' || u.state === 'routing') this.drawUnit(ctx, u);
    for (const u of order) if (u.state === 'ok' || u.state === 'routing') this.drawLabel(ctx, u);

    // Melee sparks.
    if (this.phase === 'exec') {
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

    // Floating combat text.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 13px Georgia, serif';
    for (const f of b.floaters) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.6);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(f.text, f.x, f.y - f.t * 18);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.t * 18);
    }
    ctx.restore();

    if (this.drag) {
      const d = this.drag;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
      ctx.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
      ctx.restore();
    }

    this.drawBanner(ctx);
    this.drawTooltip(ctx);
  }

  private drawUnit(ctx: CanvasRenderingContext2D, u: BUnit) {
    const col = u.side === 0 ? this.s.playerFaction.rgb : this.s.enemyFaction.rgb;
    const men = Math.max(1, Math.ceil(u.men));
    const ranks = u.type === 'spear' ? 3 : 2;
    const files = Math.ceil(men / ranks);
    const spacing = u.type === 'knight' ? 2.6 : 1.7;
    const w = Math.max(14, files * spacing + 6);
    const depth = u.type === 'knight' ? 18 : u.type === 'spear' ? 15 : 12;
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.rotate(u.facing);
    if (u.state === 'routing') ctx.globalAlpha = 0.45 + 0.25 * Math.sin(this.t * 10);
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.35)`;
    ctx.fillRect(-depth / 2, -w / 2, depth, w);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgb(${col[0] * 0.6},${col[1] * 0.6},${col[2] * 0.6})`;
    ctx.strokeRect(-depth / 2, -w / 2, depth, w);
    // Individual soldiers.
    ctx.fillStyle = `rgb(${col[0] * 0.55},${col[1] * 0.55},${col[2] * 0.55})`;
    const dot = u.type === 'knight' ? 2.4 : 1.6;
    let n = 0;
    for (let r = 0; r < ranks && n < men; r++) {
      const rx = depth / 2 - (r + 0.5) * (depth / ranks);
      for (let f = 0; f < files && n < men; f++, n++) {
        const fy = -w / 2 + 3 + (f + 0.5) * ((w - 6) / files);
        ctx.fillRect(rx - dot / 2, fy - dot / 2, dot, dot);
      }
    }
    if (u.type === 'spear') {
      ctx.strokeStyle = 'rgba(60,45,30,0.9)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let f = 0; f < files; f += 2) {
        const fy = -w / 2 + 3 + (f + 0.5) * ((w - 6) / files);
        ctx.moveTo(depth / 2, fy);
        ctx.lineTo(depth / 2 + 6, fy);
      }
      ctx.stroke();
    }
    if (this.selected.has(u.id) && u.state === 'ok') {
      ctx.strokeStyle = '#fff4c2';
      ctx.lineWidth = 2;
      ctx.strokeRect(-depth / 2 - 4, -w / 2 - 4, depth + 8, w + 8);
    }
    ctx.restore();
  }

  private drawLabel(ctx: CanvasRenderingContext2D, u: BUnit) {
    const st = UNIT_STATS[u.type];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    const label = `${UNIT_ICON[u.type]} ${Math.ceil(u.men)}`;
    const y = u.y - 30;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(label, u.x, y);
    ctx.fillStyle = u.side === 0 ? '#ffffff' : '#ffd9d2';
    ctx.fillText(label, u.x, y);
    const m = Math.max(0, u.morale / st.morale);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(u.x - 14, y + 8, 28, 4);
    ctx.fillStyle = m > 0.6 ? '#8fd16b' : m > 0.3 ? '#e8c14a' : '#e3604f';
    ctx.fillRect(u.x - 14, y + 8, 28 * m, 4);
    ctx.restore();
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    let text: string;
    if (this.phase === 'plan') text = `ROUND ${this.b.round} · PLAN YOUR ORDERS · SPACE TO EXECUTE`;
    else if (this.phase === 'exec') text = `ROUND ${this.b.round} · BATTLE IN PROGRESS · ${Math.max(0, this.execLeft).toFixed(1)}s`;
    else text = 'THE BATTLE IS OVER';
    ctx.save();
    ctx.font = '700 13px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 32;
    ctx.fillStyle = this.phase === 'plan' ? 'rgba(30,22,12,0.82)' : 'rgba(90,30,20,0.82)';
    ctx.beginPath();
    ctx.roundRect(FIELD_W / 2 - w / 2, 10, w, 28, 14);
    ctx.fill();
    ctx.fillStyle = '#f4e3b5';
    ctx.fillText(text, FIELD_W / 2, 24.5);
    if (this.noticeT > 0) {
      ctx.globalAlpha = Math.min(1, this.noticeT);
      ctx.font = '600 13px Georgia, serif';
      const nw = ctx.measureText(this.notice).width + 24;
      ctx.fillStyle = 'rgba(20,15,10,0.85)';
      ctx.beginPath();
      ctx.roundRect(FIELD_W / 2 - nw / 2, 46, nw, 24, 12);
      ctx.fill();
      ctx.fillStyle = '#ffd27a';
      ctx.fillText(this.notice, FIELD_W / 2, 58.5);
    }
    ctx.restore();
  }

  private drawTooltip(ctx: CanvasRenderingContext2D) {
    const u = this.unitAt(this.mouse.x, this.mouse.y, 0) ?? this.unitAt(this.mouse.x, this.mouse.y, 1);
    if (!u) return;
    const st = UNIT_STATS[u.type];
    const lines = [
      `${u.side === 0 ? 'Your' : 'Enemy'} ${st.name}`,
      `${Math.ceil(u.men)}/${u.maxMen} men · morale ${Math.round(u.morale)}`,
      statusOf(u, this.b) + (this.b.inForest(u) ? ' · in forest' : ''),
    ];
    ctx.save();
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const x = Math.min(FIELD_W - w - 6, this.mouse.x + 16);
    const y = Math.min(FIELD_H - 58, this.mouse.y + 16);
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
    clear(ui.top).append(
      h('div', { class: 'brand' }, `⚔ Battle of ${s.provinceName}`),
      h('div', { class: 'stat' }, swatch(s.playerFaction.color), s.playerFaction.name, s.playerAttacks ? ' (attacking)' : ' (defending)'),
      h('div', { class: 'stat muted' }, 'vs'),
      h('div', { class: 'stat' }, swatch(s.enemyFaction.color), s.enemyFaction.name),
      h('div', { class: 'stat push' }, `Round ${Math.min(this.b.round, MAX_ROUNDS)}/${MAX_ROUNDS}`),
    );
    const planning = this.phase === 'plan';
    this.listEl = h('div', { class: 'stack' });
    clear(ui.side).append(
      h('div', { class: 'card' },
        h('h3', {}, planning ? 'Planning' : this.phase === 'exec' ? 'Battle in progress' : 'Battle over'),
        h('p', { class: 'muted' }, planning
          ? 'The battle is paused. Give orders, then execute. Both sides act at the same time.'
          : `Each round plays for ${EXEC_TIME} seconds, then pauses for new orders.`),
        h('div', { class: 'btns' },
          h('button', { class: 'primary', disabled: !planning, onclick: () => this.execute() }, 'Execute orders (Space)'),
          h('button', {
            disabled: this.phase === 'done',
            onclick: () => this.finish(false, true),
          }, 'Retreat'),
        ),
        h('ul', { class: 'help' },
          h('li', {}, 'Left-click or drag a box to select regiments. Hold Shift to add.'),
          h('li', {}, 'Right-click the ground to move. Right-click an enemy to attack.'),
          h('li', {}, 'Hit flanks and rear for bonus damage. Knights charge hard but spears stop them.'),
          h('li', {}, 'Forests slow movement and shield units from arrows.'),
        ),
      ),
      h('div', { class: 'card' }, h('h3', {}, 'Your regiments'), this.listEl),
      this.enemyCard(),
    );
    this.refreshList();
  }

  private enemyCard(): HTMLElement {
    const foes = this.b.units.filter((u) => u.side === 1);
    const ok = foes.filter((u) => u.state === 'ok');
    return h('div', { class: 'card' },
      h('h3', {}, swatch(this.s.enemyFaction.color), 'Enemy'),
      h('div', { class: 'muted' }, `${ok.length} of ${foes.length} regiments still fighting`),
      h('div', { class: 'muted' }, `${Math.round(ok.reduce((n, u) => n + u.men, 0))} men in the field`),
    );
  }

  private refreshList() {
    const el = this.listEl;
    if (!el) return;
    clear(el).append(
      ...this.b.units.filter((u) => u.side === 0).map((u) => {
        const st = UNIT_STATS[u.type];
        const alive = u.state === 'ok';
        const m = Math.max(0, u.morale / st.morale);
        return h('div', {
          class: `unit-row ${alive ? 'clickable' : 'gone'} ${this.selected.has(u.id) ? 'selected' : ''}`,
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
          h('span', {}, `${UNIT_ICON[u.type]} ${st.name}`),
          h('span', { class: 'muted' }, `${Math.ceil(u.men)}/${u.maxMen} · ${statusOf(u, this.b)}`)),
        bar(m, m > 0.6 ? '#8fd16b' : m > 0.3 ? '#e8c14a' : '#e3604f'),
        );
      }),
    );
    if (this.phase === 'exec') {
      const enemy = ui.side.lastElementChild;
      if (enemy) enemy.replaceWith(this.enemyCard());
    }
  }
}

function statusOf(u: BUnit, b: Battle): string {
  if (u.state === 'dead') return 'destroyed';
  if (u.state === 'fled') return 'fled';
  if (u.state === 'routing') return 'routing!';
  if (u.fighting) return 'fighting';
  if (u.shootingAt >= 0) return 'shooting';
  if (u.order.kind === 'move') return 'marching';
  if (u.order.kind === 'attack') {
    const t = b.get(u.order.target);
    return t ? `attacking ${UNIT_STATS[t.type].name.toLowerCase()}` : 'attacking';
  }
  return 'holding';
}

function renderBattlefield(b: Battle, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = FIELD_W;
  c.height = FIELD_H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(FIELD_W, FIELD_H);
  const n = makeNoise(seed);
  const fine = makeNoise(seed + 1);
  for (let y = 0; y < FIELD_H; y++) {
    for (let x = 0; x < FIELD_W; x++) {
      const v = fbm(n, x / 140, y / 140, 4);
      const f = fine(x / 6, y / 6) - 0.5;
      const k = 0.82 + 0.36 * v;
      const i = (y * FIELD_W + x) * 4;
      img.data[i] = 108 * k + f * 10;
      img.data[i + 1] = 136 * k + f * 10;
      img.data[i + 2] = 74 * k + f * 8;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const rng = new RNG(seed + 3);
  for (const f of b.forests) {
    g.fillStyle = 'rgba(40,64,32,0.45)';
    g.beginPath();
    g.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    g.fill();
    const trees = Math.floor((f.r * f.r) / 70);
    for (let i = 0; i < trees; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = f.r * Math.sqrt(rng.next()) * 0.95;
      const x = f.x + Math.cos(a) * r;
      const y = f.y + Math.sin(a) * r;
      const s = rng.range(5, 9);
      g.fillStyle = 'rgba(20,35,18,0.45)';
      g.beginPath();
      g.arc(x + 2, y + 3, s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgb(${rng.int(34, 48)},${rng.int(64, 84)},${rng.int(34, 44)})`;
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(120,160,90,0.25)';
      g.beginPath();
      g.arc(x - s * 0.3, y - s * 0.3, s * 0.45, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Vignette.
  const grad = g.createRadialGradient(FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.35, FIELD_W / 2, FIELD_H / 2, FIELD_W * 0.7);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = grad;
  g.fillRect(0, 0, FIELD_W, FIELD_H);
  return c;
}
