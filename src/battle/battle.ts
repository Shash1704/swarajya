import { UNIT_STATS, type UnitType } from '../data';
import type { CUnit } from '../campaign/state';
import { RNG } from '../rng';

export const FIELD_W = 1080;
export const FIELD_H = 720;
/** Collision radius of a regiment. */
export const UNIT_R = 23;
/** Centre distance at which two regiments are locked in melee. */
export const CONTACT = 52;
/** Seconds of real-time combat per round, after each planning phase. */
export const EXEC_TIME = 5;
export const MAX_ROUNDS = 20;

export type Order =
  | { kind: 'hold' }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'attack'; target: number };

export interface BUnit {
  id: number;
  side: 0 | 1;
  type: UnitType;
  /** The campaign regiment this unit came from; casualties are written back to it. */
  ref: CUnit;
  men: number;
  maxMen: number;
  startMen: number;
  x: number;
  y: number;
  facing: number;
  morale: number;
  order: Order;
  state: 'ok' | 'routing' | 'fled' | 'dead';
  /** Seconds spent in the current melee (used for the knight charge bonus). */
  contactTime: number;
  /** Seconds since last taking damage (for morale recovery). */
  calm: number;
  fighting: boolean;
  shootingAt: number;
  dmgMelee: number;
  dmgRanged: number;
  moraleHit: number;
}

export interface Forest {
  x: number;
  y: number;
  r: number;
}

export interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function turnToward(u: BUnit, ang: number, maxStep: number) {
  const d = angDiff(u.facing, ang);
  u.facing += Math.max(-maxStep, Math.min(maxStep, d));
}

/**
 * Real-time regiment combat. The scene alternates planning (paused) and
 * execution (step() called for EXEC_TIME seconds), like simultaneous turns.
 * Side 0 is always the player (deployed at the bottom), side 1 the enemy.
 */
export class Battle {
  units: BUnit[] = [];
  forests: Forest[] = [];
  floaters: Floater[] = [];
  round = 1;
  time = 0;
  winner: -1 | 0 | 1 = -1;
  readonly aiAttacks: boolean;
  private nextId = 1;

  constructor(playerUnits: CUnit[], enemyUnits: CUnit[], aiAttacks: boolean, seed: number) {
    this.aiAttacks = aiAttacks;
    const rng = new RNG(seed);
    const nf = rng.int(3, 6);
    for (let i = 0; i < nf; i++) {
      this.forests.push({ x: rng.range(90, FIELD_W - 90), y: rng.range(240, FIELD_H - 240), r: rng.range(40, 85) });
    }
    this.deploy(playerUnits, 0);
    this.deploy(enemyUnits, 1);
  }

  get defenderSide(): 0 | 1 {
    return this.aiAttacks ? 0 : 1;
  }

  get(id: number): BUnit | undefined {
    return this.units.find((u) => u.id === id);
  }

  inForest(u: { x: number; y: number }): boolean {
    return this.forests.some((f) => dist(u, f) < f.r);
  }

  private deploy(cunits: CUnit[], side: 0 | 1) {
    const spears = cunits.filter((u) => u.type === 'spear');
    const archers = cunits.filter((u) => u.type === 'archer');
    const knights = cunits.filter((u) => u.type === 'knight');
    const gap = 64;
    const cx = FIELD_W / 2;
    const front = side === 0 ? 525 : FIELD_H - 525;
    const back = side === 0 ? 595 : FIELD_H - 595;
    const facing = side === 0 ? -Math.PI / 2 : Math.PI / 2;
    const rowXs = (n: number) => Array.from({ length: n }, (_, i) => cx + (i - (n - 1) / 2) * gap);

    const frontRow = spears.length ? spears : archers;
    const backRow = spears.length ? archers : [];
    const fx = rowXs(frontRow.length);
    frontRow.forEach((u, i) => this.addUnit(u, side, fx[i], front, facing));
    rowXs(backRow.length).forEach((x, i) => this.addUnit(backRow[i], side, x, back, facing));
    const left = fx.length ? fx[0] : cx + gap / 2;
    const right = fx.length ? fx[fx.length - 1] : cx - gap / 2;
    knights.forEach((u, i) => {
      const k = Math.floor(i / 2) + 1;
      const x = i % 2 === 0 ? left - gap * k : right + gap * k;
      this.addUnit(u, side, x, front, facing);
    });
  }

  private addUnit(ref: CUnit, side: 0 | 1, x: number, y: number, facing: number) {
    const st = UNIT_STATS[ref.type];
    this.units.push({
      id: this.nextId++, side, type: ref.type, ref, men: ref.men, maxMen: st.maxMen, startMen: ref.men,
      x, y, facing, morale: st.morale, order: { kind: 'hold' }, state: 'ok',
      contactTime: 0, calm: 10, fighting: false, shootingAt: -1, dmgMelee: 0, dmgRanged: 0, moraleHit: 0,
    });
  }

  private float(u: BUnit, text: string, color: string) {
    this.floaters.push({ x: u.x, y: u.y - 30, text, color, t: 0 });
  }

  // ---------------------------------------------------------------- simulation

  step(dt: number) {
    this.time += dt;
    const us = this.units;
    for (const u of us) {
      u.dmgMelee = 0;
      u.dmgRanged = 0;
      u.moraleHit = 0;
      u.fighting = false;
      u.shootingAt = -1;
    }
    const active = us.filter((u) => u.state === 'ok');
    const hittable = us.filter((u) => u.state === 'ok' || u.state === 'routing');

    // Melee: anything within CONTACT of an enemy stops and fights.
    for (const u of active) {
      let contact: BUnit | null = null;
      let best = Infinity;
      for (const e of hittable) {
        if (e.side === u.side) continue;
        const d = dist(u, e);
        if (d < CONTACT && d < best) {
          best = d;
          contact = e;
        }
      }
      if (u.order.kind === 'attack') {
        const t = this.get(u.order.target);
        if (t && (t.state === 'ok' || t.state === 'routing') && dist(u, t) < CONTACT) contact = t;
      }
      if (contact) {
        if (u.contactTime === 0 && u.type === 'knight' && contact.state === 'ok') this.float(u, 'Charge!', '#ffe08a');
        u.fighting = true;
        u.contactTime += dt;
        turnToward(u, Math.atan2(contact.y - u.y, contact.x - u.x), 4 * dt);
        this.melee(u, contact, dt);
      } else {
        u.contactTime = 0;
      }
    }

    // Movement and missiles for units not locked in melee.
    for (const u of active) {
      if (u.fighting) continue;
      const st = UNIT_STATS[u.type];
      const speed = st.speed * this.terrainSpeed(u);
      let moving = false;
      const o = u.order;
      if (o.kind === 'move') {
        moving = this.moveToward(u, o.x, o.y, speed, dt, 0);
        if (!moving) u.order = { kind: 'hold' };
      } else if (o.kind === 'attack') {
        const t = this.get(o.target);
        const chaseRouters = u.type === 'knight';
        if (!t || t.state === 'dead' || t.state === 'fled' || (t.state === 'routing' && !chaseRouters)) {
          u.order = { kind: 'hold' };
        } else if (st.range > 0 && dist(u, t) <= st.range * 0.95) {
          // In range: stand and shoot.
        } else {
          moving = this.moveToward(u, t.x, t.y, speed, dt, CONTACT - 4);
        }
      }
      if (st.range > 0 && !moving) this.shoot(u, dt);
      if (!moving && u.shootingAt < 0 && u.order.kind === 'hold') {
        // Idle regiments slowly turn to face the nearest threat.
        const n = this.nearestEnemy(u, 280);
        if (n) turnToward(u, Math.atan2(n.y - u.y, n.x - u.x), 1.2 * dt);
      }
    }

    // Routing units run for their own table edge.
    for (const u of us) {
      if (u.state !== 'routing') continue;
      const st = UNIT_STATS[u.type];
      let vx = 0;
      let vy = u.side === 0 ? 1 : -1;
      const n = this.nearestEnemy(u, 220);
      if (n) {
        const d = Math.max(1, dist(u, n));
        vx += ((u.x - n.x) / d) * 0.7;
        vy += ((u.y - n.y) / d) * 0.7;
      }
      const len = Math.hypot(vx, vy) || 1;
      const sp = st.speed * 1.15 * this.terrainSpeed(u);
      u.x += (vx / len) * sp * dt;
      u.y += (vy / len) * sp * dt;
      u.facing = Math.atan2(vy, vx);
      if (u.y < -30 || u.y > FIELD_H + 30 || u.x < -30 || u.x > FIELD_W + 30) u.state = 'fled';
    }

    this.separate();

    // Apply damage, morale and state changes.
    for (const u of us) {
      if (u.state === 'dead' || u.state === 'fled') continue;
      const total = u.dmgMelee + u.dmgRanged;
      if (total > 0) {
        u.men = Math.max(0, u.men - total);
        u.morale -= (u.dmgMelee * 150 + u.dmgRanged * 90) / u.maxMen;
        u.calm = 0;
      } else {
        u.calm += dt;
      }
      u.morale -= u.moraleHit;
      if (u.men < 3) {
        u.state = 'dead';
        u.men = 0;
        this.moraleShock(u, 15);
        continue;
      }
      if (u.state === 'ok') {
        if (u.morale <= 0) {
          u.state = 'routing';
          u.morale = 0;
          u.order = { kind: 'hold' };
          this.float(u, 'Routing!', '#ff8a7a');
          this.moraleShock(u, 12);
        } else if (!u.fighting && u.calm > 1) {
          u.morale = Math.min(UNIT_STATS[u.type].morale, u.morale + 3 * dt);
        }
      }
    }

    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter((f) => f.t < 1.6);
    this.checkEnd();
  }

  private terrainSpeed(u: BUnit): number {
    if (!this.inForest(u)) return 1;
    return u.type === 'knight' ? 0.45 : 0.6;
  }

  private moveToward(u: BUnit, tx: number, ty: number, speed: number, dt: number, stopDist: number): boolean {
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= stopDist + 0.5) return false;
    const s = Math.min(speed * dt, d - stopDist);
    u.x += (dx / d) * s;
    u.y += (dy / d) * s;
    turnToward(u, Math.atan2(dy, dx), 5 * dt);
    return true;
  }

  private nearestEnemy(u: BUnit, maxD: number): BUnit | null {
    let best: BUnit | null = null;
    let bd = maxD;
    for (const e of this.units) {
      if (e.side === u.side || e.state !== 'ok') continue;
      const d = dist(u, e);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private melee(a: BUnit, t: BUnit, dt: number) {
    const sa = UNIT_STATS[a.type];
    const st = UNIT_STATS[t.type];
    let mult = 1;
    // Angle of the attacker relative to where the target is facing: 0 = head-on.
    const rel = Math.abs(angDiff(t.facing, Math.atan2(a.y - t.y, a.x - t.x)));
    if (t.state === 'routing') mult *= 1.5;
    else if (rel > 1.9) {
      mult *= 1.5; // flank or rear attack
      t.moraleHit += 4 * dt;
    }
    if (a.type === 'knight' && a.contactTime < 2.5) {
      const braced = t.type === 'spear' && t.state === 'ok' && rel < 1.2;
      if (!braced) mult *= 2.2;
    }
    if (a.type === 'spear' && t.type === 'knight') mult *= 1.8;
    if (a.type === 'knight' && this.inForest(a)) mult *= 0.7;
    t.dmgMelee += (0.06 * a.men * sa.melee * mult * dt) / st.defense;
  }

  private shoot(u: BUnit, dt: number) {
    const st = UNIT_STATS[u.type];
    let t: BUnit | null = null;
    if (u.order.kind === 'attack') {
      const c = this.get(u.order.target);
      if (c && c.state === 'ok' && dist(u, c) <= st.range) t = c;
    }
    if (!t) t = this.nearestEnemy(u, st.range);
    if (!t) return;
    u.shootingAt = t.id;
    turnToward(u, Math.atan2(t.y - u.y, t.x - u.x), 3 * dt);
    let dmg = 0.05 * u.men * st.ranged * dt;
    if (t.type === 'knight') dmg *= 0.5;
    if (this.inForest(t)) dmg *= 0.55;
    t.dmgRanged += dmg;
  }

  private moraleShock(src: BUnit, amount: number) {
    for (const v of this.units) {
      if (v !== src && v.side === src.side && v.state === 'ok' && dist(v, src) < 170) v.morale -= amount;
    }
  }

  private separate() {
    const live = this.units.filter((u) => u.state === 'ok' || u.state === 'routing');
    const min = UNIT_R * 2;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
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

  private checkEnd() {
    const alive0 = this.units.some((u) => u.side === 0 && u.state === 'ok');
    const alive1 = this.units.some((u) => u.side === 1 && u.state === 'ok');
    if (!alive0 && !alive1) this.winner = this.defenderSide;
    else if (!alive0) this.winner = 1;
    else if (!alive1) this.winner = 0;
  }

  // ---------------------------------------------------------------- enemy AI

  /** Issues orders for side 1 at the start of each planning phase. */
  planAI() {
    const mine = this.units.filter((u) => u.side === 1 && u.state === 'ok');
    const foes = this.units.filter((u) => u.side === 0 && u.state === 'ok');
    if (!foes.length) return;
    const str = (list: BUnit[]) => list.reduce((s, u) => s + u.men * UNIT_STATS[u.type].value, 0);
    const defensive = !this.aiAttacks && str(mine) < str(foes) * 1.1;
    const closest = (u: BUnit, list: BUnit[], weight: (e: BUnit) => number = () => 1) => {
      let best: BUnit | null = null;
      let bd = Infinity;
      for (const e of list) {
        const d = dist(u, e) * weight(e);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      return best;
    };

    for (const u of mine) {
      const near = closest(u, foes)!;
      const dN = dist(u, near);
      if (u.type === 'archer') {
        const range = UNIT_STATS.archer.range;
        if (dN <= range || defensive) u.order = { kind: 'hold' };
        else {
          const k = (range * 0.85) / dN;
          u.order = { kind: 'move', x: near.x + (u.x - near.x) * k, y: near.y + (u.y - near.y) * k };
        }
      } else if (u.type === 'spear') {
        if (defensive && dN > 200) u.order = { kind: 'hold' };
        else {
          const knights = foes.filter((e) => e.type === 'knight' && dist(u, e) < 220);
          const t = closest(u, knights.length ? knights : foes)!;
          u.order = { kind: 'attack', target: t.id };
        }
      } else {
        if (defensive && dN > 260) {
          u.order = { kind: 'hold' };
          continue;
        }
        // Knights hunt archers, avoid spear fronts.
        const t = closest(u, foes, (e) => (e.type === 'archer' ? 0.5 : e.type === 'spear' ? 2 : 1))!;
        u.order = { kind: 'attack', target: t.id };
      }
    }
  }
}
