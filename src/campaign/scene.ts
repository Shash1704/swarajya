import { app, Scene, VIEW_H, VIEW_W } from '../app';
import { bar, clear, h, hideModal, modalOpen, showModal, swatch, ui } from '../ui';
import { makeNoise } from '../noise';
import { UNIT_ICON, UNIT_STATS, UNIT_TYPES, UnitType } from '../data';
import { CELL, MH, MW } from './mapgen';
import {
  Army, armyAt, armyMen, armyStrength, autoResolve, capture, cleanupArmies, GameState, log, MAX_UNITS,
  netIncome, NEUTRAL, newGame, newUnit, PLAYER, Province, retreat, spawnArmy, startTurn,
} from './state';
import { runAiTurn } from './ai';
import { BattleScene } from '../battle/scene';

type RGB = [number, number, number];

const LAND_STOPS: [number, RGB][] = [
  [0.0, [152, 172, 108]],
  [0.35, [128, 152, 90]],
  [0.62, [146, 140, 98]],
  [0.82, [136, 128, 116]],
  [1.0, [214, 212, 206]],
];

function landColor(t: number): RGB {
  for (let i = 1; i < LAND_STOPS.length; i++) {
    const [t1, c1] = LAND_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = LAND_STOPS[i - 1];
      const k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return LAND_STOPS[LAND_STOPS.length - 1][1];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CampaignScene implements Scene {
  /** Province id under each screen pixel (-1 = water). */
  private pixProv: Int16Array;
  /** Province on the other side of a border at this pixel: -2 none, -1 water. */
  private pixNb: Int16Array;
  private base: Uint8ClampedArray;
  private img: ImageData;
  private mapCanvas: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private dirty = true;
  private selProv = -1;
  private selArmy: Army | null = null;
  private busy = false;

  constructor(public state: GameState) {
    const n = VIEW_W * VIEW_H;
    this.pixProv = new Int16Array(n);
    this.pixNb = new Int16Array(n).fill(-2);
    this.base = new Uint8ClampedArray(n * 4);
    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = VIEW_W;
    this.mapCanvas.height = VIEW_H;
    this.mapCtx = this.mapCanvas.getContext('2d')!;
    this.img = this.mapCtx.createImageData(VIEW_W, VIEW_H);
    this.precompute();
  }

  enter() {
    this.dirty = true;
    this.renderUI();
  }

  // ---------------------------------------------------------------- rendering

  private precompute() {
    const { prov, elev } = this.state.map;
    const { pixProv, pixNb, base } = this;
    for (let py = 0; py < VIEW_H; py++) {
      const cy = Math.min(MH - 1, (py / CELL) | 0);
      for (let px = 0; px < VIEW_W; px++) {
        pixProv[py * VIEW_W + px] = prov[cy * MW + Math.min(MW - 1, (px / CELL) | 0)];
      }
    }
    for (let py = 0; py < VIEW_H; py++) {
      for (let px = 0; px < VIEW_W; px++) {
        const p = py * VIEW_W + px;
        const a = pixProv[p];
        const check = (q: number) => {
          const b = pixProv[q];
          if (b === a) return false;
          if (a >= 0) pixNb[p] = b;
          else if (b >= 0) pixNb[p] = b;
          else return false;
          return true;
        };
        if (px < VIEW_W - 1 && check(p + 1)) continue;
        if (py < VIEW_H - 1 && check(p + VIEW_W)) continue;
        if (px > 0 && check(p - 1)) continue;
        if (py > 0) check(p - VIEW_W);
      }
    }

    const sample = (fx: number, fy: number) => {
      fx = Math.max(0, Math.min(MW - 1.001, fx));
      fy = Math.max(0, Math.min(MH - 1.001, fy));
      const ix = fx | 0;
      const iy = fy | 0;
      const tx = fx - ix;
      const ty = fy - iy;
      const i = iy * MW + ix;
      const a = elev[i] + (elev[i + 1] - elev[i]) * tx;
      const b = elev[i + MW] + (elev[i + MW + 1] - elev[i + MW]) * tx;
      return a + (b - a) * ty;
    };
    const grain = makeNoise(this.state.seed + 99);
    for (let py = 0; py < VIEW_H; py++) {
      for (let px = 0; px < VIEW_W; px++) {
        const p = py * VIEW_W + px;
        const cx = px / CELL - 0.5;
        const cy = py / CELL - 0.5;
        const e = sample(cx, cy);
        const g = grain(px / 7, py / 7) - 0.5;
        let c: RGB;
        if (pixProv[p] >= 0) {
          c = landColor(Math.max(0, Math.min(1, e + g * 0.08)));
          const shade = (sample(cx - 0.8, cy - 0.8) - sample(cx + 0.8, cy + 0.8)) * 7;
          const k = 1 + Math.max(-0.28, Math.min(0.28, shade));
          c = [c[0] * k, c[1] * k, c[2] * k];
        } else {
          const t = Math.max(0, Math.min(1, 1 + e * 3));
          const tt = t * t;
          c = [34 + 40 * tt + g * 6, 68 + 58 * tt + g * 6, 108 + 52 * tt + g * 6];
        }
        base[p * 4] = c[0];
        base[p * 4 + 1] = c[1];
        base[p * 4 + 2] = c[2];
        base[p * 4 + 3] = 255;
      }
    }
  }

  private moveTargets(): Set<number> {
    const a = this.selArmy;
    if (!a || a.owner !== PLAYER || a.moved || this.busy) return new Set();
    return new Set(this.state.provinces[a.province].neighbors);
  }

  private composite() {
    const { provinces, factions } = this.state;
    const { pixProv, pixNb, base } = this;
    const d = this.img.data;
    const targets = this.moveTargets();
    for (let py = 0; py < VIEW_H; py++) {
      for (let px = 0; px < VIEW_W; px++) {
        const p = py * VIEW_W + px;
        const i = p * 4;
        let r = base[i];
        let g = base[i + 1];
        let b = base[i + 2];
        const pr = pixProv[p];
        const nb = pixNb[p];
        if (pr >= 0) {
          const own = provinces[pr].owner;
          const fc = factions[own].rgb;
          const a = own === NEUTRAL ? 0.1 : 0.4;
          r = r * (1 - a) + fc[0] * a;
          g = g * (1 - a) + fc[1] * a;
          b = b * (1 - a) + fc[2] * a;
          if (pr === this.selProv) {
            r += 38; g += 38; b += 38;
          } else if (targets.has(pr) && (px + py) & 8) {
            r += 24; g += 24; b += 20;
          }
          if (nb === -1) {
            r *= 0.35; g *= 0.35; b *= 0.35;
          } else if (nb >= 0) {
            if (provinces[nb].owner !== own) {
              if (own === NEUTRAL) { r = 70; g = 66; b = 58; } else { r = fc[0] * 0.55; g = fc[1] * 0.55; b = fc[2] * 0.55; }
            } else {
              r *= 0.72; g *= 0.72; b *= 0.72;
            }
          }
        } else if (nb >= 0) {
          r = r * 0.6 + 100; g = g * 0.6 + 100; b = b * 0.6 + 100;
        }
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
    this.mapCtx.putImageData(this.img, 0, 0);
  }

  update() {}

  draw(ctx: CanvasRenderingContext2D) {
    if (this.dirty) {
      this.composite();
      this.dirty = false;
    }
    ctx.drawImage(this.mapCanvas, 0, 0);
    const s = this.state;

    // Province names.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const p of s.provinces) {
      const label = p.capitalOf >= 0 ? `♛ ${p.name}` : p.name;
      ctx.font = p.capitalOf >= 0 ? '700 12px Georgia, serif' : '600 11px Georgia, serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(245, 238, 220, 0.8)';
      ctx.strokeText(label, p.lx, p.ly + 16);
      ctx.fillStyle = '#2a2216';
      ctx.fillText(label, p.lx, p.ly + 16);
    }

    // Movement arrows for the selected army.
    if (this.selArmy) {
      const from = s.provinces[this.selArmy.province];
      for (const n of this.moveTargets()) {
        const to = s.provinces[n];
        const occ = armyAt(s, n);
        const color = occ && occ.owner !== PLAYER ? '#ff6b5b' : to.owner !== PLAYER ? '#ffd27a' : '#ffffff';
        this.drawArrow(ctx, from.lx, from.ly, to.lx, to.ly, color);
      }
    }

    for (const a of s.armies) this.drawArmy(ctx, a);
  }

  private drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
    const ax = x0 + (x1 - x0) * 0.24;
    const ay = y0 + (y1 - y0) * 0.24;
    const bx = x0 + (x1 - x0) * 0.68;
    const by = y0 + (y1 - y0) * 0.68;
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
      ctx.beginPath();
      const hs = w === 6 ? 13 : 10;
      ctx.moveTo(bx + Math.cos(ang) * hs * 0.6, by + Math.sin(ang) * hs * 0.6);
      ctx.lineTo(bx + Math.cos(ang + 2.4) * hs, by + Math.sin(ang + 2.4) * hs);
      ctx.lineTo(bx + Math.cos(ang - 2.4) * hs, by + Math.sin(ang - 2.4) * hs);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private armyPos(a: Army) {
    const p = this.state.provinces[a.province];
    return { x: p.lx, y: p.ly - 6 };
  }

  private drawArmy(ctx: CanvasRenderingContext2D, a: Army) {
    const { x, y } = this.armyPos(a);
    const f = this.state.factions[a.owner];
    const w = 40;
    const hh = 20;
    const sel = a === this.selArmy;
    ctx.save();
    // Banner pole and pennant.
    ctx.fillStyle = '#3a2c1c';
    ctx.fillRect(x - w / 2 - 1, y - hh / 2 - 10, 2, hh + 10);
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 1, y - hh / 2 - 10);
    ctx.lineTo(x - w / 2 + 12, y - hh / 2 - 6);
    ctx.lineTo(x - w / 2 + 1, y - hh / 2 - 2);
    ctx.fill();
    // Body.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2 + 2, y - hh / 2 + 3, w, hh, 4);
    ctx.fill();
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - hh / 2, w, hh, 4);
    ctx.fill();
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.strokeStyle = sel ? '#ffd86b' : 'rgba(20,15,10,0.85)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(armyMen(a)), x, y + 0.5);
    if (a.owner === PLAYER && a.moved) {
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - hh / 2, w, hh, 4);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- input

  private provAt(x: number, y: number): number {
    const px = Math.max(0, Math.min(VIEW_W - 1, x | 0));
    const py = Math.max(0, Math.min(VIEW_H - 1, y | 0));
    return this.pixProv[py * VIEW_W + px];
  }

  private armyHit(x: number, y: number): Army | null {
    for (const a of this.state.armies) {
      const p = this.armyPos(a);
      if (Math.abs(x - p.x) < 22 && y > p.y - 20 && y < p.y + 12) return a;
    }
    return null;
  }

  pointerDown(x: number, y: number, button: number) {
    if (this.busy || this.state.over || modalOpen()) return;
    const p = this.provAt(x, y);
    const a = this.armyHit(x, y);
    const sel = this.selArmy;
    const canMove = sel && sel.owner === PLAYER && !sel.moved;
    const target = a ? a.province : p;

    if (canMove && target >= 0 && target !== sel.province && (button === 2 || !a || a.owner !== PLAYER)
      && this.state.provinces[sel.province].neighbors.includes(target)) {
      void this.playerMove(sel, target);
      return;
    }
    if (button === 2) return;
    if (a) {
      this.selArmy = a;
      this.selProv = a.province;
    } else {
      this.selArmy = null;
      this.selProv = p;
    }
    this.dirty = true;
    this.renderUI();
  }

  keyDown(e: KeyboardEvent) {
    if (modalOpen()) return;
    if (e.key === 'Enter') void this.endTurn();
    if (e.key === 'Escape') {
      this.selArmy = null;
      this.selProv = -1;
      this.dirty = true;
      this.renderUI();
    }
  }

  // ---------------------------------------------------------------- game flow

  private async playerMove(army: Army, target: number) {
    this.busy = true;
    await this.attemptMove(army, target);
    this.busy = false;
    if (this.selArmy && this.state.armies.includes(this.selArmy)) this.selProv = this.selArmy.province;
    this.dirty = true;
    this.renderUI();
    this.checkOver();
  }

  async attemptMove(army: Army, target: number): Promise<void> {
    const s = this.state;
    const from = s.provinces[army.province];
    const to = s.provinces[target];
    if (army.moved || !from.neighbors.includes(target)) return;
    const occ = armyAt(s, target);

    if (occ && occ.owner === army.owner) {
      if (occ.units.length + army.units.length > MAX_UNITS) {
        if (army.owner === PLAYER) log(s, `Can't merge: an army holds at most ${MAX_UNITS} regiments.`);
        return;
      }
      occ.units.push(...army.units);
      occ.moved = true;
      s.armies = s.armies.filter((a) => a !== army);
      if (this.selArmy === army) this.selArmy = occ;
      this.dirty = true;
      return;
    }

    army.moved = true;
    if (occ) {
      const attackerWon = await this.fight(army, occ, to);
      cleanupArmies(s);
      if (attackerWon) {
        if (s.armies.includes(occ)) retreat(s, occ);
        if (s.armies.includes(army)) {
          army.province = target;
          capture(s, target, army.owner);
        }
      }
    } else {
      army.province = target;
      capture(s, target, army.owner);
    }
    if (this.selArmy && !s.armies.includes(this.selArmy)) this.selArmy = null;
    this.dirty = true;
    this.renderUI();
  }

  private fight(att: Army, def: Army, prov: Province): Promise<boolean> {
    const s = this.state;
    const an = s.factions[att.owner].name;
    const dn = s.factions[def.owner].name;
    if (att.owner !== PLAYER && def.owner !== PLAYER) {
      const won = autoResolve(s, att, def);
      log(s, won ? `${an} defeats ${dn} at ${prov.name}.` : `${an} is repulsed by ${dn} at ${prov.name}.`);
      return Promise.resolve(won);
    }
    const playerAttacks = att.owner === PLAYER;
    const mine = playerAttacks ? att : def;
    const theirs = playerAttacks ? def : att;
    const ratio = (armyStrength(mine) * (playerAttacks ? 1 : 1.15)) / (armyStrength(theirs) * (playerAttacks ? 1.15 : 1));
    const odds = ratio > 1.8 ? 'Overwhelming' : ratio > 1.2 ? 'Favourable' : ratio > 0.85 ? 'Even' : ratio > 0.55 ? 'Unfavourable' : 'Desperate';

    const side = (a: Army, title: string) =>
      h('div', { class: 'card' },
        h('h3', {}, swatch(s.factions[a.owner].color), title),
        ...summarize(a).map((line) => h('div', { class: 'muted' }, line)),
        h('div', { style: 'margin-top:4px' }, `${armyMen(a)} men`),
      );
    const body = h('div', {},
      h('p', {}, playerAttacks ? `Your army marches on ${prov.name}, held by the ${dn}.` : `The ${an} attacks your army at ${prov.name}!`),
      h('p', { class: 'muted' }, `Estimated odds: ${odds}. Command the battle yourself, or let your captains fight it out.`),
      h('div', { class: 'versus' }, side(mine, 'Your forces'), side(theirs, s.factions[theirs.owner].name)),
    );

    return new Promise((resolve) => {
      showModal(`Battle of ${prov.name}`, body, [
        {
          label: 'Auto-resolve',
          onClick: () => {
            hideModal();
            const won = autoResolve(s, att, def);
            const playerWon = playerAttacks === won;
            log(s, playerWon ? `Victory at ${prov.name}!` : `Defeat at ${prov.name}.`);
            resolve(won);
          },
        },
        {
          label: '⚔ Command the battle',
          primary: true,
          onClick: () => {
            hideModal();
            app.setScene(new BattleScene({
              playerArmy: mine,
              enemyArmy: theirs,
              playerAttacks,
              provinceName: prov.name,
              seed: s.seed * 31 + s.turn * 7 + prov.id,
              playerFaction: s.factions[PLAYER],
              enemyFaction: s.factions[theirs.owner],
              onDone: (playerWon) => {
                log(s, playerWon ? `Victory at ${prov.name}!` : `Defeat at ${prov.name}.`);
                app.setScene(this);
                resolve(playerAttacks === playerWon);
              },
            }));
          },
        },
      ]);
    });
  }

  private async endTurn() {
    if (this.busy || this.state.over || modalOpen()) return;
    this.busy = true;
    this.selArmy = null;
    this.dirty = true;
    this.renderUI();
    for (const f of [1, 2, 3]) {
      if (this.state.over) break;
      await runAiTurn(this, f);
      this.dirty = true;
      await sleep(200);
    }
    if (!this.state.over) {
      startTurn(this.state);
      log(this.state, `Turn ${this.state.turn} begins.`);
    }
    this.busy = false;
    this.dirty = true;
    this.renderUI();
    this.checkOver();
  }

  private recruit(provId: number, type: UnitType) {
    const s = this.state;
    const cost = UNIT_STATS[type].cost;
    if (s.gold[PLAYER] < cost || s.provinces[provId].owner !== PLAYER) return;
    let a = armyAt(s, provId);
    if (a && (a.owner !== PLAYER || a.units.length >= MAX_UNITS)) return;
    if (!a) {
      a = spawnArmy(s, PLAYER, provId, []);
      a.moved = true; // freshly raised levies can't march this turn
    }
    a.units.push(newUnit(type));
    s.gold[PLAYER] -= cost;
    this.selArmy = a;
    this.selProv = provId;
    this.dirty = true;
    this.renderUI();
  }

  private checkOver() {
    const over = this.state.over;
    if (!over) return;
    showModal(
      over === 'won' ? 'The realm is yours!' : 'Your kingdom has fallen',
      over === 'won'
        ? `After ${this.state.turn} turns, every rival crown bows to the ${this.state.factions[PLAYER].name}.`
        : 'Your last province has been taken. Perhaps another age will be kinder.',
      [{
        label: 'New campaign',
        primary: true,
        onClick: () => {
          hideModal();
          app.setScene(new CampaignScene(newGame(Math.floor(Math.random() * 1e9))));
        },
      }],
    );
  }

  // ---------------------------------------------------------------- side panel

  renderUI() {
    const s = this.state;
    const me = s.factions[PLAYER];
    const net = netIncome(s, PLAYER);
    clear(ui.top).append(
      h('div', { class: 'brand' }, '⚜ Banners of the Realm'),
      h('div', { class: 'stat' }, swatch(me.color), me.name),
      h('div', { class: 'stat' }, `Turn ${s.turn}`),
      h('div', { class: 'stat' }, `Gold ${s.gold[PLAYER]}`,
        h('span', { class: net >= 0 ? 'pos' : 'neg' }, `(${net >= 0 ? '+' : ''}${net}/turn)`)),
      h('button', { class: 'primary push', onclick: () => void this.endTurn(), disabled: this.busy || !!s.over },
        this.busy ? 'Rivals are moving…' : 'End turn ⏎'),
    );

    const side = clear(ui.side);
    side.append(this.selectionCard(), this.factionsCard(), this.logCard());
  }

  private selectionCard(): HTMLElement {
    const s = this.state;
    const a = this.selArmy;
    if (a && s.armies.includes(a)) {
      const f = s.factions[a.owner];
      const mine = a.owner === PLAYER;
      const p = s.provinces[a.province];
      return h('div', { class: 'card' },
        h('h3', {}, swatch(f.color), mine ? 'Your army' : `${f.name} army`),
        h('div', { class: 'muted' }, `At ${p.name} · ${armyMen(a)} men · ${a.units.length}/${MAX_UNITS} regiments`),
        h('div', { class: 'stack', style: 'margin-top:8px' }, ...a.units.map((u) => unitRow(u.type, u.men))),
        mine ? h('p', { class: a.moved ? 'muted' : '' },
          a.moved ? 'This army has marched this turn.' : 'Click a neighbouring province (or right-click) to march. Red arrows mean battle.') : null,
        mine && p.owner === PLAYER ? this.recruitButtons(p) : null,
      );
    }
    if (this.selProv >= 0) {
      const p = s.provinces[this.selProv];
      const f = s.factions[p.owner];
      const occ = armyAt(s, p.id);
      return h('div', { class: 'card' },
        h('h3', {}, p.capitalOf >= 0 ? `♛ ${p.name}` : p.name),
        h('div', { class: 'row' }, h('span', {}, swatch(f.color), f.name), h('span', { class: 'muted' }, `+${p.income} gold`)),
        p.capitalOf >= 0 ? h('div', { class: 'muted' }, `Capital of the ${s.factions[p.capitalOf].name}`) : null,
        h('p', { class: 'muted' }, occ ? `Garrison: ${armyMen(occ)} men (${s.factions[occ.owner].name})` : 'No army present.'),
        occ ? h('button', { class: 'small', onclick: () => { this.selArmy = occ; this.dirty = true; this.renderUI(); } }, 'Select army') : null,
        p.owner === PLAYER ? this.recruitButtons(p) : null,
      );
    }
    return h('div', { class: 'card' },
      h('h3', {}, 'How to play'),
      h('ul', { class: 'help' },
        h('li', {}, 'Click your blue banner to select an army, then click a neighbouring province to march.'),
        h('li', {}, 'Marching into an enemy army starts a battle: command it yourself or auto-resolve.'),
        h('li', {}, 'Click one of your provinces to recruit regiments with gold.'),
        h('li', {}, 'Press ', h('kbd', {}, 'Enter'), ' to end your turn. Destroy all three rival realms to win.'),
      ),
    );
  }

  private recruitButtons(p: Province): HTMLElement {
    const s = this.state;
    const occ = armyAt(s, p.id);
    const full = !!occ && occ.units.length >= MAX_UNITS;
    return h('div', { style: 'margin-top:10px' },
      h('div', { class: 'muted' }, full ? 'Army is at full size.' : `Recruit at ${p.name}:`),
      h('div', { class: 'btns' },
        ...UNIT_TYPES.map((t) => {
          const st = UNIT_STATS[t];
          return h('button', {
            class: 'small',
            title: st.blurb,
            disabled: full || s.gold[PLAYER] < st.cost || this.busy,
            onclick: () => this.recruit(p.id, t),
          }, `${UNIT_ICON[t]} ${st.name} · ${st.cost}g`);
        }),
      ),
    );
  }

  private factionsCard(): HTMLElement {
    const s = this.state;
    return h('div', { class: 'card' },
      h('h3', {}, 'Realms'),
      h('div', { class: 'stack' },
        ...s.factions.filter((f) => f.isMajor).map((f) => {
          const provs = s.provinces.filter((p) => p.owner === f.id).length;
          const men = s.armies.filter((a) => a.owner === f.id).reduce((n, a) => n + armyMen(a), 0);
          return h('div', { class: 'row', style: f.alive ? '' : 'opacity:.45;text-decoration:line-through' },
            h('span', {}, swatch(f.color), f.name),
            h('span', { class: 'muted' }, f.alive ? `${provs} prov · ${men} men` : 'fallen'),
          );
        }),
      ),
    );
  }

  private logCard(): HTMLElement {
    return h('div', { class: 'card' },
      h('h3', {}, 'Chronicle'),
      h('div', { class: 'log' }, ...this.state.log.slice(-10).reverse().map((l) => h('div', {}, l))),
    );
  }
}

function summarize(a: Army): string[] {
  const out: string[] = [];
  for (const t of UNIT_TYPES) {
    const us = a.units.filter((u) => u.type === t);
    if (us.length) out.push(`${UNIT_ICON[t]} ${us.length}× ${UNIT_STATS[t].name} (${us.reduce((n, u) => n + u.men, 0)})`);
  }
  return out;
}

function unitRow(type: UnitType, men: number): HTMLElement {
  const st = UNIT_STATS[type];
  return h('div', { class: 'unit-row', title: st.blurb },
    h('div', { class: 'row' }, h('span', {}, `${UNIT_ICON[type]} ${st.name}`), h('span', { class: 'muted' }, `${men}/${st.maxMen}`)),
    bar(men / st.maxMen),
  );
}
