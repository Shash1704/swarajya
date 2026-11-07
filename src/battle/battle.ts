import { isLarge, UNIT_STATS, type UnitType } from '../data';
import type { CUnit } from '../campaign/state';
import { RNG } from '../rng';

/** Battlefield size in world pixels (the battle camera zooms and pans over it). */
export const FIELD_W = 1620;
export const FIELD_H = 1080;
/** Centre distance at which two regiments are locked in melee. */
export const CONTACT = 50;
/** Men killed per attacking man per second at melee 1.0 against defense 1.0. */
const MELEE_RATE = 0.032;

export type Terrain = 'plains' | 'hills' | 'forest' | 'desert';

export interface BattleOptions {
  mode: 'field' | 'siege';
  playerAttacks: boolean;
  seed: number;
  terrain: Terrain;
  rain: boolean;
  /** Siege only: 1 mud walls, 2 stone walls, 3 hill or sea fort. */
  walls: number;
  ladders: boolean;
  ram: boolean;
}

export type Order =
  | { kind: 'hold' }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'attack'; target: number }
  | { kind: 'breach'; seg: number };

export interface BUnit {
  id: number;
  side: 0 | 1;
  type: UnitType;
  /** Campaign regiment this unit came from; casualties are written back to it. */
  ref: CUnit;
  men: number;
  maxMen: number;
  startMen: number;
  x: number;
  y: number;
  facing: number;
  morale: number;
  maxMorale: number;
  order: Order;
  state: 'ok' | 'routing' | 'fled' | 'dead';
  contactTime: number;
  chargeT: number;
  movingT: number;
  calm: number;
  fighting: boolean;
  moving: boolean;
  aimId: number;
  reload: number;
  climbing: boolean;
  climbT: number;
  blocked: boolean;
  rallied: boolean;
  dmgMelee: number;
  dmgMissile: number;
  moraleHit: number;
  px: number;
  py: number;
}

export interface Forest { x: number; y: number; r: number }
export interface Hill { x: number; y: number; r: number; h: number }

export interface WallSeg {
  x0: number;
  x1: number;
  hp: number;
  maxHp: number;
  gate: boolean;
}

export interface Walls {
  /** Inner edge of the wall band; the band runs to y + t (the outer face). */
  y: number;
  t: number;
  level: number;
  segs: WallSeg[];
  towers: { x: number; cd: number }[];
  plaza: { x: number; y: number; r: number };
  /** Attacker's progress capturing the plaza, 0..1. */
  capture: number;
  captureTime: number;
}

export interface Shot {
  kind: 'musket' | 'rocket' | 'cannon' | 'tower' | 'fizzle';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}

export interface Floater { x: number; y: number; text: string; color: string; t: number }

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function turnToward(u: BUnit, ang: number, maxStep: number) {
  const d = angDiff(u.facing, ang);
  u.facing += Math.max(-maxStep, Math.min(maxStep, d));
}

export const radiusOf = (t: UnitType) => {
  const c = UNIT_STATS[t].cls;
  return c === 'elephant' ? 26 : c === 'artillery' ? 18 : 22;
};
const cls = (u: BUnit) => UNIT_STATS[u.type].cls;
const weapon = (u: BUnit) => UNIT_STATS[u.type].weapon;
const canMountWalls = (t: UnitType) => {
  const c = UNIT_STATS[t].cls;
  return c === 'infantry' || c === 'missile';
};

/**
 * Real-time regiment combat. Side 0 is always the player. In field battles
 * the player deploys at the bottom; in sieges the defender holds the walls
 * at the top and the attacker comes from the bottom.
 */
export class Battle {
  units: BUnit[] = [];
  forests: Forest[] = [];
  hills: Hill[] = [];
  walls: Walls | null = null;
  shots: Shot[] = [];
  floaters: Floater[] = [];
  time = 0;
  winner: -1 | 0 | 1 = -1;
  readonly opts: BattleOptions;
  readonly attacker: 0 | 1;
  readonly timeLimit: number;
  private rng: RNG;
  private nextId = 1;

  constructor(player: CUnit[], enemy: CUnit[], opts: BattleOptions) {
    this.opts = opts;
    this.attacker = opts.playerAttacks ? 0 : 1;
    this.timeLimit = opts.mode === 'siege' ? 1200 : 900;
    this.rng = new RNG(opts.seed);
    this.makeTerrain();
    if (opts.mode === 'siege') this.makeWalls();
    this.deploy(player, 0);
    this.deploy(enemy, 1);
  }

  get defender(): 0 | 1 {
    return this.attacker === 0 ? 1 : 0;
  }

  /** Which edge a side calls home (and flees toward). */
  homeTop(side: 0 | 1): boolean {
    return this.opts.mode === 'siege' ? side === this.defender : side === 1;
  }

  get(id: number): BUnit | undefined {
    return this.units.find((u) => u.id === id);
  }

  // ---------------------------------------------------------------- setup

  private makeTerrain() {
    const rng = this.rng;
    const t = this.opts.terrain;
    const siege = this.opts.mode === 'siege';
    const nForest = t === 'forest' ? rng.int(9, 13) : t === 'desert' ? rng.int(0, 2) : rng.int(3, 6);
    const nHill = t === 'hills' ? rng.int(6, 9) : t === 'desert' ? rng.int(2, 4) : rng.int(2, 3);
    const yMin = siege ? FIELD_H * 0.46 : FIELD_H * 0.3;
    const yMax = siege ? FIELD_H * 0.62 : FIELD_H * 0.7;
    for (let i = 0; i < nForest; i++) {
      this.forests.push({ x: rng.range(60, FIELD_W - 60), y: rng.range(yMin, yMax), r: rng.range(35, t === 'forest' ? 95 : 75) });
    }
    for (let i = 0; i < nHill; i++) {
      this.hills.push({ x: rng.range(80, FIELD_W - 80), y: rng.range(yMin - 40, yMax + 40), r: rng.range(90, 170), h: rng.range(0.5, 1) });
    }
  }

  private makeWalls() {
    const level = Math.max(1, Math.min(3, this.opts.walls));
    const n = 11;
    const w = FIELD_W / n;
    const segHp = [0, 60, 120, 200][level];
    const gateHp = [0, 35, 70, 110][level];
    const segs: WallSeg[] = [];
    for (let i = 0; i < n; i++) {
      const gate = i === 5;
      segs.push({ x0: i * w, x1: (i + 1) * w, hp: gate ? gateHp : segHp, maxHp: gate ? gateHp : segHp, gate });
    }
    const towers: { x: number; cd: number }[] = [];
    if (level >= 2) {
      for (let k = 1; k < n; k++) if (level === 3 || k % 2 === 1 || k === 5 || k === 6) towers.push({ x: k * w, cd: k * 0.3 });
    }
    this.walls = {
      y: Math.round(FIELD_H * 0.32), t: 28, level, segs, towers,
      plaza: { x: FIELD_W / 2, y: Math.round(FIELD_H * 0.15), r: 90 }, capture: 0, captureTime: level === 1 ? 30 : 40,
    };
  }

  /**
   * Lays an army out in ranks: foot (and elephants) in front, missile troops
   * behind them, guns at the back, horse on the wings. Big armies get several
   * lines of each.
   */
  private deploy(cunits: CUnit[], side: 0 | 1) {
    const top = this.homeTop(side);
    const facing = top ? Math.PI / 2 : -Math.PI / 2;
    const dir = top ? -1 : 1; // +1 means "further back" is down the screen
    const cx = FIELD_W / 2;
    const gap = 64;
    const rowGap = 58;
    const of = (...cls: string[]) => cunits.filter((u) => cls.includes(UNIT_STATS[u.type].cls));
    /** Places units in centred rows of at most `cap`, starting at y0 and stepping back. Returns the next free y. */
    const rows = (list: CUnit[], y0: number, cap: number, spacing = gap) => {
      let y = y0;
      for (let i = 0; i < list.length; i += cap) {
        const row = list.slice(i, i + cap);
        row.forEach((u, k) => this.addUnit(u, side, cx + (k - (row.length - 1) / 2) * spacing, y, facing));
        y += rowGap * dir;
      }
      return y;
    };

    const W = this.walls;
    if (W && side === this.defender) {
      // Missile troops man the walls; foot soldiers wait behind the gate; horse and elephants hold the square.
      const onWall = Math.floor((FIELD_W - 120) / 80);
      const missile = of('missile', 'artillery');
      rows(missile.slice(0, onWall), W.y + W.t / 2, onWall, 80);
      const inner = [...missile.slice(onWall), ...of('infantry')];
      const yInner = W.y - 55;
      let y = yInner;
      for (let i = 0; i < inner.length; i += 18) {
        inner.slice(i, i + 18).forEach((u, k, row) => this.addUnit(u, side, cx + (k - (row.length - 1) / 2) * gap, y, facing));
        y -= rowGap;
      }
      const big = of('cavalry', 'elephant');
      big.forEach((u, k) => {
        const ring = Math.floor(k / 8);
        const a = (k % 8) / 8 * Math.PI * 2 + ring * 0.4;
        const r = W.plaza.r * 0.6 + ring * 50;
        this.addUnit(u, side, W.plaza.x + Math.cos(a) * r * 1.6, Math.max(25, W.plaza.y + Math.sin(a) * r * 0.6), facing);
      });
      return;
    }

    const cap = Math.floor((FIELD_W - 420) / gap); // leave room for the cavalry wings
    const front = FIELD_H * (top ? 0.28 : 0.72);
    const foot = of('infantry', 'elephant');
    const missile = of('missile');
    const firstLine = foot.length ? foot : missile;
    let y = rows(firstLine, front, cap);
    if (foot.length) y = rows(missile, y, cap);
    rows(of('artillery'), y + rowGap * 0.3 * dir, cap, 90);
    // Horse on both wings, in columns outward from the line's ends.
    const lineHalf = (Math.min(cap, Math.max(1, firstLine.length)) - 1) / 2 * gap;
    of('cavalry').forEach((u, i) => {
      const wing = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const col = Math.floor(k / 3);
      const rank = k % 3;
      const x = cx + wing * (lineHalf + gap * (col + 1.2));
      this.addUnit(u, side, Math.max(30, Math.min(FIELD_W - 30, x)), front + rank * rowGap * dir, facing);
    });
  }

  private addUnit(ref: CUnit, side: 0 | 1, x: number, y: number, facing: number) {
    const st = UNIT_STATS[ref.type];
    this.units.push({
      id: this.nextId++, side, type: ref.type, ref, men: ref.men, maxMen: st.maxMen, startMen: ref.men,
      x, y, facing, morale: st.morale, maxMorale: st.morale, order: { kind: 'hold' }, state: 'ok',
      contactTime: 0, chargeT: 0, movingT: 0, calm: 10, fighting: false, moving: false, aimId: -1,
      reload: st.reload * this.rng.range(0.3, 0.8), climbing: false, climbT: 0, blocked: false, rallied: false,
      dmgMelee: 0, dmgMissile: 0, moraleHit: 0, px: x, py: y,
    });
  }

  /** Deployment-phase zone for a side (y range). */
  deployZone(side: 0 | 1): [number, number] {
    const W = this.walls;
    if (W && side === this.defender) return [20, W.y + W.t];
    return this.homeTop(side) ? [20, FIELD_H * 0.4] : [FIELD_H * 0.6, FIELD_H - 20];
  }

  // ---------------------------------------------------------------- terrain helpers

  inForest(p: { x: number; y: number }): boolean {
    return this.forests.some((f) => dist(p, f) < f.r);
  }

  height(p: { x: number; y: number }): number {
    let h = 0;
    for (const hl of this.hills) {
      const d = dist(p, hl);
      if (d < hl.r) h = Math.max(h, hl.h * (1 - (d / hl.r) ** 2));
    }
    return h;
  }

  region(y: number): 'in' | 'band' | 'out' {
    const W = this.walls!;
    return y < W.y ? 'in' : y <= W.y + W.t ? 'band' : 'out';
  }

  onWall(u: BUnit): boolean {
    return !!this.walls && !u.climbing && this.region(u.y) === 'band';
  }

  segAt(x: number): WallSeg | null {
    const W = this.walls;
    if (!W) return null;
    const i = Math.max(0, Math.min(W.segs.length - 1, Math.floor(x / (FIELD_W / W.segs.length))));
    return W.segs[i];
  }

  isOpen(x: number): boolean {
    const s = this.segAt(x);
    return !!s && s.hp <= 0;
  }

  segCenter(i: number): { x: number; y: number } {
    const W = this.walls!;
    const s = W.segs[i];
    return { x: (s.x0 + s.x1) / 2, y: W.y + W.t / 2 };
  }

  private canClimb(u: BUnit): boolean {
    return !!this.walls && u.side === this.attacker && this.opts.ladders && UNIT_STATS[u.type].climb > 0 && canMountWalls(u.type);
  }

  private speedMod(u: BUnit): number {
    const st = UNIT_STATS[u.type];
    let m = this.opts.rain ? 0.9 : 1;
    if (this.inForest(u)) m *= st.wild ? 0.95 : st.cls === 'cavalry' ? 0.45 : st.cls === 'artillery' ? 0.4 : 0.65;
    else if (this.height(u) > 0.35 && !st.wild) m *= 0.85;
    return m;
  }

  /** Where a unit should steer to reach (tx, ty), going round walls through gaps. */
  private route(u: BUnit, tx: number, ty: number): [number, number] {
    const W = this.walls;
    if (!W) return [tx, ty];
    const face = W.y + W.t;
    const ru = this.region(u.y);
    const rt = this.region(ty);
    const mount = canMountWalls(u.type);
    const sameSide = mount ? (ru === 'out') === (rt === 'out') : (ru === 'out') === (rt === 'out') && (ru === 'in') === (rt === 'in');
    if (sameSide) return [tx, ty];
    const goingIn = ru === 'out';
    // Nearest open gap (by total detour).
    let gx = -1;
    let best = Infinity;
    for (const s of W.segs) {
      if (s.hp > 0) continue;
      const c = (s.x0 + s.x1) / 2;
      const cost = Math.abs(c - u.x) + Math.abs(c - tx);
      if (cost < best) {
        best = cost;
        gx = c;
      }
    }
    if (gx >= 0) {
      const half = (W.segs[0].x1 - W.segs[0].x0) / 2 - radiusOf(u.type);
      if (goingIn) {
        if (Math.abs(u.x - gx) > half && u.y > face + 2) return [gx, face + 35];
        return [gx, W.y - 45];
      }
      if (Math.abs(u.x - gx) > half && u.y < W.y - 2) return [gx, W.y - 35];
      return [gx, face + 45];
    }
    if (goingIn && this.canClimb(u)) return [u.x + Math.max(-40, Math.min(40, tx - u.x)), face - 4];
    return [Math.max(20, Math.min(FIELD_W - 20, tx)), goingIn ? face + 30 : W.y - 30];
  }

  /** Moves a unit toward (tx, ty); returns whether it moved. */
  private travel(u: BUnit, tx: number, ty: number, speed: number, dt: number, stopDist: number): boolean {
    const [wx, wy] = this.route(u, tx, ty);
    const final = wx === tx && wy === ty;
    const stop = final ? stopDist : 0;
    const dx = wx - u.x;
    const dy = wy - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= stop + 0.5) return false;
    const s = Math.min(speed * dt, d - stop);
    u.x += (dx / d) * s;
    u.y += (dy / d) * s;
    turnToward(u, Math.atan2(dy, dx), 5 * dt);
    return true;
  }

  private destOf(u: BUnit): { x: number; y: number } | null {
    const o = u.order;
    if (o.kind === 'move') return o;
    if (o.kind === 'attack') return this.get(o.target) ?? null;
    return null;
  }

  private nearestEnemy(u: BUnit, maxD: number, filter?: (e: BUnit) => boolean): BUnit | null {
    let best: BUnit | null = null;
    let bd = maxD;
    for (const e of this.units) {
      if (e.side === u.side || e.state !== 'ok') continue;
      if (filter && !filter(e)) continue;
      const d = dist(u, e);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private canMelee(a: BUnit, b: BUnit): boolean {
    const W = this.walls;
    if (!W) return true;
    if (a.climbing || b.climbing) return true;
    const outA = this.region(a.y) === 'out';
    const outB = this.region(b.y) === 'out';
    if (outA === outB) return true;
    return this.isOpen((a.x + b.x) / 2);
  }

  private float(x: number, y: number, text: string, color: string) {
    this.floaters.push({ x, y: y - 30, text, color, t: 0 });
  }

  // ---------------------------------------------------------------- simulation

  step(dt: number) {
    if (this.winner >= 0) return;
    this.time += dt;
    const us = this.units;
    for (const u of us) {
      u.dmgMelee = 0;
      u.dmgMissile = 0;
      u.moraleHit = 0;
      u.fighting = false;
      u.aimId = -1;
      u.blocked = false;
      u.px = u.x;
      u.py = u.y;
    }
    const live = us.filter((u) => u.state === 'ok');
    const hittable = us.filter((u) => u.state === 'ok' || u.state === 'routing');

    // 1. Melee: anything within reach of an enemy stops and fights.
    for (const u of live) {
      let contact: BUnit | null = null;
      let best = Infinity;
      for (const e of hittable) {
        if (e.side === u.side) continue;
        const d = dist(u, e);
        if (d < CONTACT && d < best && this.canMelee(u, e)) {
          best = d;
          contact = e;
        }
      }
      if (u.order.kind === 'attack') {
        const t = this.get(u.order.target);
        if (t && (t.state === 'ok' || t.state === 'routing') && dist(u, t) < CONTACT && this.canMelee(u, t)) contact = t;
      }
      if (contact) {
        const st = UNIT_STATS[u.type];
        if (u.contactTime === 0 && u.movingT > 0.4 && st.charge > 1.1 && !u.climbing) {
          u.chargeT = 2.5;
          if (isLarge(u.type)) this.float(u.x, u.y, 'Charge!', '#ffe08a');
        }
        u.fighting = true;
        u.contactTime += dt;
        u.chargeT = Math.max(0, u.chargeT - dt);
        if (!u.climbing) turnToward(u, Math.atan2(contact.y - u.y, contact.x - u.x), 4 * dt);
        this.melee(u, contact, dt);
      } else {
        u.contactTime = 0;
        u.chargeT = 0;
      }
    }

    // 2. Orders: movement, missiles and battering.
    for (const u of live) {
      if (u.climbing) {
        u.climbT -= dt;
        u.moving = false;
        continue;
      }
      if (u.fighting) {
        u.moving = false;
        u.movingT = 0;
        continue;
      }
      this.act(u, dt);
    }

    // 3. Routing units flee for their own edge; panicked elephants trample everyone.
    for (const u of us) {
      if (u.state !== 'routing') continue;
      const st = UNIT_STATS[u.type];
      let vx = 0;
      let vy = this.homeTop(u.side) ? -1 : 1;
      const n = this.nearestEnemy(u, 220);
      if (n) {
        const d = Math.max(1, dist(u, n));
        vx += ((u.x - n.x) / d) * 0.7;
        vy += ((u.y - n.y) / d) * 0.7;
      }
      if (cls(u) === 'elephant') {
        vx += Math.sin(this.time * 1.7 + u.id) * 0.9;
        for (const v of hittable) {
          if (v !== u && dist(u, v) < CONTACT) v.dmgMelee += (MELEE_RATE * u.men * st.melee * 0.5 * dt) / UNIT_STATS[v.type].defense;
        }
      }
      // Walls: route the panicked toward a gap if they're on the wrong side.
      if (this.walls) {
        const [rx, ry] = this.route(u, u.x + vx * 50, u.y + vy * 50);
        vx = rx - u.x;
        vy = ry - u.y;
      }
      const len = Math.hypot(vx, vy) || 1;
      const sp = st.speed * 1.15 * this.speedMod(u);
      u.x += (vx / len) * sp * dt;
      u.y += (vy / len) * sp * dt;
      u.facing = Math.atan2(vy, vx);
      if (u.y < -30 || u.y > FIELD_H + 30 || u.x < -30 || u.x > FIELD_W + 30) u.state = 'fled';
    }

    // 4. Elephants terrify whatever stands near them.
    for (const e of live) {
      const fear = UNIT_STATS[e.type].fear;
      if (!fear) continue;
      for (const v of live) {
        if (v.side === e.side || dist(v, e) > 85) continue;
        const k = cls(v) === 'elephant' ? 0 : isLarge(v.type) ? 1.6 : UNIT_STATS[v.type].role === 'pike' ? 0.5 : 1;
        v.moraleHit += fear * k * (e.men / e.maxMen) * dt;
      }
    }

    // 5. Wall towers shoot at attackers in range.
    const W = this.walls;
    if (W) {
      for (const tw of W.towers) {
        const i = Math.round(tw.x / (FIELD_W / W.segs.length));
        if (W.segs[i - 1].hp <= 0 || W.segs[i].hp <= 0) continue;
        tw.cd -= dt;
        if (tw.cd > 0) continue;
        const pos = { x: tw.x, y: W.y + W.t / 2 };
        let target: BUnit | null = null;
        let bd = 260;
        for (const u of live) {
          if (u.side !== this.attacker || (this.region(u.y) !== 'out' && !u.climbing)) continue;
          const d = dist(pos, u);
          if (d < bd) {
            bd = d;
            target = u;
          }
        }
        if (!target) {
          tw.cd = 0.5;
          continue;
        }
        tw.cd = 2;
        const dmg = (W.level === 3 ? 2.4 : 1.7) * (this.opts.rain ? 0.5 : 1) * (1 - UNIT_STATS[target.type].armor * 0.7);
        target.dmgMissile += dmg / Math.max(1, UNIT_STATS[target.type].defense / 1.5);
        this.shots.push({ kind: 'tower', x0: pos.x, y0: pos.y - 14, x1: target.x, y1: target.y, t: 0 });
      }
    }

    this.separate();
    this.enforceWalls();

    // 6. Climbers who reach the top step onto the walls.
    for (const u of live) {
      if (u.climbing && u.climbT <= 0 && W) {
        u.climbing = false;
        u.y = W.y + W.t / 2;
        u.px = u.x;
        u.py = u.y;
        this.float(u.x, u.y, 'Over the wall!', '#ffe08a');
      }
    }

    // 7. Casualties, morale, rout and rally.
    for (const u of us) {
      if (u.state === 'dead' || u.state === 'fled') continue;
      const total = u.dmgMelee + u.dmgMissile;
      if (total > 0) {
        u.men = Math.max(0, u.men - total);
        u.morale -= (u.dmgMelee * 110 + u.dmgMissile * 70) / u.maxMen;
        u.calm = 0;
      } else {
        u.calm += dt;
      }
      u.morale -= u.moraleHit;
      if (u.men < Math.max(1, u.maxMen * 0.05)) {
        u.state = 'dead';
        u.men = 0;
        this.moraleShock(u, 9);
        continue;
      }
      if (u.state === 'ok') {
        if (u.morale <= 0) {
          u.state = 'routing';
          u.morale = 0;
          u.climbing = false;
          u.order = { kind: 'hold' };
          this.float(u.x, u.y, cls(u) === 'elephant' ? 'Amok!' : 'Routing!', '#ff8a7a');
          this.moraleShock(u, 7);
        } else if (!u.fighting && u.calm > 1) {
          u.morale = Math.min(u.maxMorale, u.morale + 3 * dt);
        }
      } else if (u.state === 'routing' && !u.rallied && cls(u) !== 'elephant' && u.calm > 6
        && u.men > u.startMen * 0.25 && !this.nearestEnemy(u, 220)) {
        u.state = 'ok';
        u.rallied = true;
        u.morale = u.maxMorale * 0.4;
        this.float(u.x, u.y, 'Rallied', '#bfe39a');
      }
    }

    // 8. The plaza: attackers win a siege by holding it.
    if (W) {
      const inPlaza = (s: number) => live.some((u) => u.side === s && u.state === 'ok' && dist(u, W.plaza) < W.plaza.r);
      const att = inPlaza(this.attacker);
      const def = inPlaza(this.defender);
      if (att && !def) W.capture = Math.min(1, W.capture + dt / W.captureTime);
      else if (def && !att) W.capture = Math.max(0, W.capture - dt / 60);
      if (W.capture >= 1) this.winner = this.attacker;
    }

    for (const s of this.shots) s.t += dt;
    this.shots = this.shots.filter((s) => s.t < 0.6);
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter((f) => f.t < 1.6);

    if (this.winner < 0) this.checkEnd();
  }

  private act(u: BUnit, dt: number) {
    const st = UNIT_STATS[u.type];
    const speed = st.speed * this.speedMod(u);
    const o = u.order;
    let moving = false;
    let breachSeg = -1;

    if (o.kind === 'move') {
      moving = this.travel(u, o.x, o.y, speed, dt, 0);
      if (!moving && Math.hypot(o.x - u.x, o.y - u.y) < 3) u.order = { kind: 'hold' };
    } else if (o.kind === 'attack') {
      const t = this.get(o.target);
      const chase = st.cls === 'cavalry';
      if (!t || t.state === 'dead' || t.state === 'fled' || (t.state === 'routing' && !chase)) {
        u.order = { kind: 'hold' };
      } else if (st.range > 0 && dist(u, t) <= st.range * this.rangeMod(u) * 0.95 && st.cls !== 'cavalry') {
        // In range: stand and shoot.
      } else if (st.skirmish && dist(u, t) <= st.range * 0.9) {
        // Horse archers circle at bow range.
      } else {
        moving = this.travel(u, t.x, t.y, speed, dt, CONTACT - 6);
      }
    } else if (o.kind === 'breach' && this.walls) {
      const seg = this.walls.segs[o.seg];
      if (!seg || seg.hp <= 0) {
        u.order = { kind: 'hold' };
      } else {
        const c = this.segCenter(o.seg);
        if (st.cls === 'artillery') {
          if (dist(u, c) > st.range * 0.95) moving = this.travel(u, c.x, c.y + 120, speed, dt, 0);
          else breachSeg = o.seg;
        } else {
          const spot = { x: Math.max(seg.x0 + 20, Math.min(seg.x1 - 20, u.x)), y: this.walls.y + this.walls.t + 20 };
          if (dist(u, spot) > 10) moving = this.travel(u, spot.x, spot.y, speed, dt, 0);
          else this.batter(u, seg, dt);
        }
      }
    }

    // Horse archers keep their distance from anything that wants to close.
    if (st.skirmish) {
      const threat = this.nearestEnemy(u, 120, (e) => UNIT_STATS[e.type].range === 0 || isLarge(e.type));
      if (threat) {
        const d = Math.max(1, dist(u, threat));
        moving = this.travel(u, u.x + ((u.x - threat.x) / d) * 80, u.y + ((u.y - threat.y) / d) * 80, speed, dt, 0) || moving;
      }
    }

    if (st.range > 0 && (!moving || st.shootMoving)) this.shoot(u, dt, breachSeg);
    if (!moving && u.aimId < 0 && u.order.kind === 'hold') {
      const n = this.nearestEnemy(u, 300);
      if (n) turnToward(u, Math.atan2(n.y - u.y, n.x - u.x), 1.2 * dt);
    }
    u.moving = moving;
    u.movingT = moving ? u.movingT + dt : 0;
  }

  private batter(u: BUnit, seg: WallSeg, dt: number) {
    const st = UNIT_STATS[u.type];
    const W = this.walls!;
    let dmg = st.gate * u.men * dt;
    if (seg.gate) {
      if (this.opts.ram && st.cls === 'infantry') dmg *= 6;
      if (cls(u) === 'elephant' && W.level === 3) dmg *= 0.4; // spiked fort gates
    } else {
      dmg = cls(u) === 'elephant' ? dmg * 0.3 : 0; // only elephants can push over a wall
    }
    if (dmg <= 0) return;
    turnToward(u, -Math.PI / 2, 4 * dt);
    this.damageSeg(seg, dmg);
  }

  private damageSeg(seg: WallSeg, dmg: number) {
    if (seg.hp <= 0) return;
    seg.hp -= dmg;
    if (seg.hp <= 0) {
      seg.hp = 0;
      const W = this.walls!;
      this.float((seg.x0 + seg.x1) / 2, W.y + 40, seg.gate ? 'The gate is down!' : 'Breach!', '#ffd27a');
    }
  }

  rangeMod(u: BUnit): number {
    let m = 1;
    if (this.onWall(u)) m *= 1.2;
    if (this.height(u) > 0.4) m *= 1.1;
    if (this.opts.rain && weapon(u) === 'bow') m *= 0.8;
    return m;
  }

  private missileMod(u: BUnit, t: BUnit): number {
    const tt = UNIT_STATS[t.type];
    const pierce = weapon(u) === 'gun' ? 0.25 : weapon(u) === 'cannon' ? 0 : 0.7;
    let m = (1 - tt.armor * pierce) / Math.max(1, tt.defense / 1.5);
    if (weapon(u) !== 'cannon' && this.inForest(t)) m *= 0.55;
    if (this.walls && this.region(u.y) === 'out') {
      const rt = this.region(t.y);
      if (rt === 'band' && !t.climbing) m *= 0.5;
      else if (rt === 'in') m *= 0.75;
    }
    if (t.climbing) m *= 1.3;
    if (this.opts.rain) {
      if (weapon(u) === 'bow') m *= 0.6;
      if (weapon(u) === 'rocket') m *= 0.7;
    }
    return m;
  }

  private shoot(u: BUnit, dt: number, breachSeg: number) {
    const st = UNIT_STATS[u.type];
    const range = st.range * this.rangeMod(u);
    let t: BUnit | null = null;
    if (u.order.kind === 'attack') {
      const c = this.get(u.order.target);
      if (c && c.state === 'ok' && dist(u, c) <= range) t = c;
    }
    if (!t && breachSeg < 0) {
      t = weapon(u) === 'rocket'
        ? this.nearestEnemy(u, range, (e) => isLarge(e.type)) ?? this.nearestEnemy(u, range)
        : this.nearestEnemy(u, range);
    }
    if (!t && breachSeg < 0) return;
    const aim = t ?? this.segCenter(breachSeg);
    turnToward(u, Math.atan2(aim.y - u.y, aim.x - u.x), 3 * dt);

    if (st.reload === 0) {
      if (!t) return;
      u.aimId = t.id;
      t.dmgMissile += u.men * st.missile * dt * this.missileMod(u, t);
      return;
    }

    u.reload -= dt;
    if (u.reload > 0) return;
    u.reload = st.reload * this.rng.range(0.9, 1.1);
    if (breachSeg >= 0 && this.walls) {
      const seg = this.walls.segs[breachSeg];
      this.shots.push({ kind: 'cannon', x0: u.x, y0: u.y, x1: aim.x, y1: aim.y, t: 0 });
      this.damageSeg(seg, (st.wall * u.men) / u.maxMen);
      return;
    }
    if (!t) return;
    if (weapon(u) === 'gun' && this.opts.rain && this.rng.chance(0.45)) {
      this.shots.push({ kind: 'fizzle', x0: u.x, y0: u.y, x1: t.x, y1: t.y, t: 0 });
      return;
    }
    let victim = t;
    if (weapon(u) === 'rocket') {
      // Rockets wander: they often land on some other enemy nearby, or nowhere at all.
      const roll = this.rng.next();
      if (roll < 0.3) {
        this.shots.push({ kind: 'rocket', x0: u.x, y0: u.y, x1: t.x + this.rng.range(-60, 60), y1: t.y + this.rng.range(-60, 60), t: 0 });
        return;
      }
      if (roll < 0.55) {
        const near = this.units.filter((e) => e.side !== u.side && e.state === 'ok' && dist(e, t!) < 90);
        victim = near.length ? this.rng.pick(near) : t;
      }
    }
    const dmg = u.men * st.missile * this.missileMod(u, victim);
    victim.dmgMissile += dmg;
    const shock = (dmg * 35) / victim.maxMen * (cls(victim) === 'elephant' ? 4 : isLarge(victim.type) ? 1.5 : 1);
    if (weapon(u) !== 'bow') victim.moraleHit += shock;
    this.shots.push({ kind: weapon(u) === 'cannon' ? 'cannon' : weapon(u) === 'rocket' ? 'rocket' : 'musket', x0: u.x, y0: u.y, x1: victim.x, y1: victim.y, t: 0 });
  }

  private melee(a: BUnit, t: BUnit, dt: number) {
    const sa = UNIT_STATS[a.type];
    const st = UNIT_STATS[t.type];
    let mult = 1;
    const rel = Math.abs(angDiff(t.facing, Math.atan2(a.y - t.y, a.x - t.x)));
    if (t.state === 'routing') mult *= 1.5;
    else if (rel > 1.9 && !t.climbing) {
      mult *= 1.5; // flank or rear
      t.moraleHit += 4 * dt;
    }
    if (a.chargeT > 0) {
      const braced = st.antiLarge > 1 && isLarge(a.type) && t.state === 'ok' && rel < 1.2;
      if (!braced) mult *= sa.charge;
    }
    if (isLarge(t.type)) mult *= sa.antiLarge;
    if (sa.wild && (this.inForest(a) || this.height(a) > 0.35)) mult *= 1.25;
    if (sa.cls === 'cavalry' && this.inForest(a)) mult *= 0.7;
    if (this.height(a) - this.height(t) > 0.15) mult *= 1.2;
    if (this.walls) {
      if (a.climbing) mult *= 0.5;
      if (t.climbing && this.onWall(a)) mult *= 1.3;
    }
    const def = st.defense * (this.onWall(t) && !this.onWall(a) ? 1.5 : 1);
    t.dmgMelee += (MELEE_RATE * a.men * sa.melee * mult * dt) / def;
  }

  private moraleShock(src: BUnit, amount: number) {
    for (const v of this.units) {
      if (v !== src && v.side === src.side && v.state === 'ok' && dist(v, src) < 130) v.morale -= amount;
    }
  }

  private separate() {
    const live = this.units.filter((u) => u.state === 'ok' || u.state === 'routing');
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (a.climbing || b.climbing) continue;
        const min = radiusOf(a.type) + radiusOf(b.type) - 6;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 0.01) {
          dx = this.rng.range(-0.5, 0.5);
          dy = this.rng.range(-0.5, 0.5);
          d = Math.hypot(dx, dy);
        }
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
    for (const u of live) {
      if (u.state !== 'ok') continue;
      u.x = Math.max(15, Math.min(FIELD_W - 15, u.x));
      u.y = Math.max(15, Math.min(FIELD_H - 15, u.y));
    }
  }

  /** Stops anything from walking through intact wall; flags units that bumped it. */
  private enforceWalls() {
    const W = this.walls;
    if (!W) return;
    const face = W.y + W.t;
    for (const u of this.units) {
      if ((u.state !== 'ok' && u.state !== 'routing') || u.climbing) continue;
      const wasOut = u.py > face;
      const isOut = u.y > face;
      if (wasOut !== isOut && !this.isOpen(u.x)) {
        u.y = wasOut ? face + 0.5 : face - 0.5;
        u.blocked = true;
      }
      if (!canMountWalls(u.type)) {
        const wasIn = u.py < W.y;
        const isIn = u.y < W.y;
        if (wasIn !== isIn && !this.isOpen(u.x)) {
          u.y = wasIn ? W.y - 0.5 : W.y + 0.5;
          u.blocked = true;
        }
      }
      // Bumped the outer face while trying to get in: up the ladders.
      if (u.blocked && u.state === 'ok' && wasOut && this.canClimb(u)) {
        const d = this.destOf(u);
        if (d && d.y < face) {
          u.climbing = true;
          u.climbT = 7 / UNIT_STATS[u.type].climb;
          u.y = face + 2;
        }
      }
    }
  }

  private checkEnd() {
    // Gun crews alone cannot hold a field.
    const alive = (s: number) => this.units.some((u) => u.side === s && u.state === 'ok' && cls(u) !== 'artillery');
    const a0 = alive(0);
    const a1 = alive(1);
    if (!a0 && !a1) this.winner = this.defender;
    else if (!a0) this.winner = 1;
    else if (!a1) this.winner = 0;
    else if (this.time >= this.timeLimit || this.assaultSpent()) this.winner = this.defender;
  }

  /** A siege assault is over once nobody left outside can get over, through or under the walls. */
  private assaultSpent(): boolean {
    const W = this.walls;
    if (!W || W.segs.some((s) => s.hp <= 0)) return false;
    return !this.units.some((u) => {
      if (u.side !== this.attacker || u.state !== 'ok') return false;
      if (u.climbing || this.region(u.y) !== 'out') return true;
      const st = UNIT_STATS[u.type];
      return this.canClimb(u) || st.gate > 0 || st.wall > 0;
    });
  }

  /** Writes casualties back to the campaign regiments. */
  applyResults(winnerSide: 0 | 1, retreated = false) {
    for (const u of this.units) {
      let m = u.men;
      if (u.state === 'dead') m = 0;
      else if (u.state === 'fled') m *= u.side === winnerSide ? 0.85 : 0.5;
      else if (u.side !== winnerSide) m *= retreated ? 0.85 : 0.7;
      u.ref.men = Math.floor(m);
    }
  }
}
