/**
 * Scripted tactics for the computer's side in historical battles: regiments that keep a post
 * (the archers on their hill at Uhud), lie hidden until their moment (Khalid's horse behind the
 * hills), then ride a set route into the enemy's flank or rear, charge, or break off to loot.
 * Regiments not (or no longer) under a tactic are left to the ordinary battle AI.
 */
import { UNIT_STATS } from '../data';
import { type Battle, type BUnit, FIELD_H, FIELD_W } from './battle';

export type Pt2 = [number, number];

/** One condition for releasing a tactic: every part given must hold. */
export interface Cond {
  /** Battle seconds passed. */
  time?: number;
  /** This side's battle meter at least this far in its favour (0..0.5). */
  winning?: number;
  /** ...or at least this far against it. */
  losing?: number;
  /** Seconds since this side first came to blows. */
  engaged?: number;
  /** No enemy regiment still standing within r of this point (a post abandoned). */
  empty?: { x: number; y: number; r: number };
  /** An enemy (seen) within this distance of the tactic's regiments. */
  near?: number;
  /** Another of this side's tactics (by index) has been released. */
  after?: number;
  /** A ringed army has starved this far (0..1). */
  hunger?: number;
}

/** What the regiments do once released. */
export type Release =
  /** Hand them to the ordinary battle AI. */
  | 'free'
  /** Fall on the nearest enemy, all together, until they are in the fight. */
  | 'charge'
  /** Ride this route, then strike the nearest enemy there, the enemy commander, or the nearest horse. */
  | { route: Pt2[]; strike: 'nearest' | 'general' | 'cavalry' }
  /** Leave the post for the enemy's camp and plunder it (the archers at Uhud). */
  | { loot: Pt2 };

export interface Tactic {
  /** The regiments, by index in their side's list. */
  regs: number[];
  /** What they did, in a few words (shown before the battle). */
  note: string;
  /** Called out on the field when they are released. */
  shout?: string;
  /** Where they wait, one per regiment (default: where they start). */
  posts?: Pt2[];
  /** While waiting they fall on enemies who come this close to their post (default 150); archers shoot whatever they can reach. */
  reach?: number;
  /** Light horse keeping a ring: give ground before foot and gunfire, and strike only horse, stragglers and men caught in the water. */
  evade?: boolean;
  /** Released as soon as any one of these holds (none: at once). */
  until?: Cond[];
  then: Release;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function closest<T extends { x: number; y: number }>(p: { x: number; y: number }, list: T[]): T | undefined {
  let best: T | undefined;
  let bd = Infinity;
  for (const e of list) {
    const d = dist(p, e);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Room between a point and the nearest edge of the field. */
const edgeRoom = (p: { x: number; y: number }) => Math.min(p.x, p.y, FIELD_W - p.x, FIELD_H - p.y);
/** Keeps a ring's post well clear of the edges (a regiment that rides off the field has left the battle). */
const inside = (p: { x: number; y: number }) => ({ x: Math.max(130, Math.min(FIELD_W - 130, p.x)), y: Math.max(130, Math.min(FIELD_H - 130, p.y)) });

export class Script {
  private ids: number[][];
  private posts: Map<number, { x: number; y: number; face: number }> = new Map();
  /** 'wait' at the post, 'go' carrying out the release, 'free' handed to the AI. */
  phase: ('wait' | 'go' | 'free')[];
  /** Regiments already let go of individually (in the fight, or done with their route). */
  private loose = new Set<number>();
  private lootSince = new Map<number, number>();
  private firstBlow = -1;
  /** Released tactics' notes, newest last, for the battle's messages. */
  readonly released: string[] = [];

  readonly side: 0 | 1;
  readonly tactics: Tactic[];

  constructor(b: Battle, side: 0 | 1, tactics: Tactic[]) {
    this.side = side;
    this.tactics = tactics;
    const list = b.units.filter((u) => u.side === side);
    this.ids = tactics.map((t) => t.regs.map((i) => list[i]?.id).filter((id): id is number => id !== undefined));
    tactics.forEach((t, k) => this.ids[k].forEach((id, j) => {
      const u = b.get(id)!;
      const p = t.posts?.[j];
      this.posts.set(id, { x: p ? p[0] : u.x, y: p ? p[1] : u.y, face: u.facing });
    }));
    this.phase = tactics.map(() => 'wait');
  }

  private holds(b: Battle, k: number, c: Cond, units: BUnit[]): boolean {
    const side = this.side;
    if (c.time !== undefined && b.time < c.time) return false;
    if (c.winning !== undefined && b.momentum(side) < c.winning) return false;
    if (c.losing !== undefined && b.momentum(side) > -c.losing) return false;
    if (c.engaged !== undefined && (this.firstBlow < 0 || b.time - this.firstBlow < c.engaged)) return false;
    if (c.hunger !== undefined && b.hunger < c.hunger) return false;
    if (c.after !== undefined && this.phase[c.after] === 'wait') return false;
    if (c.empty) {
      const e = c.empty;
      if (b.units.some((u) => u.side !== side && u.state === 'ok' && dist(u, e) < e.r)) return false;
    }
    if (c.near !== undefined) {
      const r = c.near;
      const foes = b.units.filter((f) => f.side !== side && f.state === 'ok' && b.sees(side, f));
      if (!units.some((u) => foes.some((f) => dist(u, f) < r || dist(this.posts.get(u.id)!, f) < r))) return false;
    }
    void k;
    return true;
  }

  /** Gives the scripted regiments their orders; returns the ids it has taken care of (the rest are the AI's). */
  run(b: Battle): Set<number> {
    const side = this.side;
    const handled = new Set<number>();
    if (this.firstBlow < 0 && b.units.some((u) => u.side === side && u.fighting)) this.firstBlow = b.time;
    const foesAll = b.units.filter((f) => f.side !== side && f.state === 'ok');
    const seen = foesAll.filter((f) => b.sees(side, f));
    this.tactics.forEach((t, k) => {
      const units = this.ids[k].map((id) => b.get(id)).filter((u): u is BUnit => !!u && u.state === 'ok' && !this.loose.has(u.id));
      if (this.phase[k] === 'free' || !units.length) return;
      if (this.phase[k] === 'wait') {
        if (!t.until || t.until.some((c) => this.holds(b, k, c, units))) this.release(b, k, units);
        else {
          for (const u of units) {
            this.keepPost(b, u, t, seen);
            handled.add(u.id);
          }
          return;
        }
      }
      if (this.phase[k] !== 'go') return;
      for (const u of units) {
        if (this.carryOut(b, u, t, seen.length ? seen : foesAll)) handled.add(u.id);
        else this.loose.add(u.id);
      }
    });
    return handled;
  }

  /** Waiting: stand at the post, shoot what is in reach, fall on whoever comes too close, then come back. */
  private keepPost(b: Battle, u: BUnit, t: Tactic, seen: BUnit[]) {
    const post = this.posts.get(u.id)!;
    const st = UNIT_STATS[u.type];
    if (u.feignT > 0) return; // mid-way through a feigned flight
    if (st.range > 0) {
      const inRange = seen.filter((f) => dist(u, f) <= st.range * b.rangeMod(u));
      const close = inRange.find((f) => dist(u, f) < 70);
      const t2 = close ?? closest(u, inRange);
      if (t2 && u.ammo > 0) { u.order = { kind: 'attack', target: t2.id }; return; }
    } else {
      const reach = t.reach ?? 150;
      if (u.fighting) return;
      if (t.evade) {
        // Foot and guns too close, or shot at: fall back away from them and keep the ring wider.
        // Stronger horse riding at us: the old trick, a feigned flight to draw it out of its order.
        const worth = (x: BUnit) => x.men * UNIT_STATS[x.type].value * Math.max(0.2, x.morale / Math.max(1, x.maxMorale));
        const rider = closest(u, seen.filter((f) => UNIT_STATS[f.type].cls === 'cavalry' && dist(u, f) < 200 && worth(f) > worth(u) * 1.1));
        if (rider && u.feignT <= 0) {
          const role = UNIT_STATS[u.type].role;
          if ((role === 'raider' || role === 'skirmish') && edgeRoom(u) > 300 && b.feign(u)) return;
          const d = dist(u, rider) || 1;
          const to = inside({ x: u.x + (u.x - rider.x) / d * 220, y: u.y + (u.y - rider.y) / d * 220 });
          u.order = { kind: 'move', x: to.x, y: to.y };
          return;
        }
        const foot = seen.filter((f) => UNIT_STATS[f.type].cls !== 'cavalry' && f.morale > f.maxMorale * 0.4);
        const reachOf = (f: BUnit) => Math.max(170, Math.min(UNIT_STATS[f.type].range, 450) * 1.1);
        let threat: BUnit | undefined;
        let worst = -Infinity;
        for (const f of foot) {
          const m = reachOf(f) - dist(u, f);
          if (m > worst) { worst = m; threat = f; }
        }
        if (threat && (worst > 0 || (u.calm < 1.5 && worst > -160))) {
          const d = dist(u, threat) || 1;
          const away = Math.max(worst + 60, 60);
          const to = inside({ x: u.x + (u.x - threat.x) / d * away, y: u.y + (u.y - threat.y) / d * away });
          post.x = to.x;
          post.y = to.y;
          u.order = { kind: 'move', x: post.x, y: post.y, face: Math.atan2(threat.y - post.y, threat.x - post.x) };
          return;
        }
      }
      const fair = (f: BUnit) => !t.evade || f.morale < f.maxMorale * 0.4 || b.inRiver(f)
        || (UNIT_STATS[f.type].cls === 'cavalry' && f.men * UNIT_STATS[f.type].value <= u.men * UNIT_STATS[u.type].value * 1.1);
      const prey = closest(post, seen.filter((f) => dist(post, f) < reach && fair(f)));
      if (prey) { u.order = { kind: 'attack', target: prey.id }; return; }
    }
    if (dist(u, post) > 14) u.order = { kind: 'move', x: post.x, y: post.y, face: post.face };
    else if (u.order.kind !== 'hold') u.order = { kind: 'hold', face: post.face };
  }

  private release(b: Battle, k: number, units: BUnit[]) {
    const t = this.tactics[k];
    this.released.push(t.note);
    if (t.shout) {
      const c = { x: units.reduce((s, u) => s + u.x, 0) / units.length, y: units.reduce((s, u) => s + u.y, 0) / units.length };
      b.float(c.x, c.y - 34, t.shout, this.side === 1 ? '#ff8a7a' : '#ffe08a');
    }
    if (t.then === 'free') { this.phase[k] = 'free'; return; }
    this.phase[k] = 'go';
    const then = t.then;
    if (typeof then === 'object' && 'route' in then) {
      const foes = b.units.filter((f) => f.side !== this.side && f.state === 'ok');
      const end = { x: then.route[then.route.length - 1][0], y: then.route[then.route.length - 1][1] };
      const g = b.get(b.generalIds[this.side === 0 ? 1 : 0]);
      const horse = foes.filter((f) => UNIT_STATS[f.type].cls === 'cavalry');
      const target = then.strike === 'general' && g && g.state === 'ok' ? g
        : closest(end, then.strike === 'cavalry' && horse.length ? horse : foes);
      for (const u of units) {
        const pts: Pt2[] = [];
        let from: { x: number; y: number } = u;
        for (const [x, y] of then.route) {
          pts.push(...b.fordRoute(from, { x, y }), [x, y]);
          from = { x, y };
        }
        u.order = { kind: 'path', pts, i: 0, then: target?.id };
        u.formation = 'normal';
      }
    }
  }

  /** Carrying out the release; false once the regiment should go to the ordinary AI. */
  private carryOut(b: Battle, u: BUnit, t: Tactic, foes: BUnit[]): boolean {
    const then = t.then;
    if (u.fighting) return false;
    if (then === 'charge') {
      const prey = closest(u, foes);
      if (!prey) return false;
      if (u.order.kind !== 'attack' || u.order.target !== prey.id) u.order = { kind: 'attack', target: prey.id };
      return true;
    }
    if (then === 'free') return false;
    if ('route' in then) {
      return u.order.kind === 'path' && u.order.i < u.order.pts.length;
    }
    // Looting: off to the enemy's camp, and there they stay until someone falls on them or the plunder is done.
    const [x, y] = then.loot;
    if (dist(u, { x, y }) > 40) {
      if (u.order.kind !== 'move') u.order = { kind: 'move', x, y };
      return true;
    }
    if (!this.lootSince.has(u.id)) this.lootSince.set(u.id, b.time);
    if (b.time - this.lootSince.get(u.id)! > 120 || foes.some((f) => dist(f, u) < 160)) return false;
    u.order = { kind: 'hold' };
    return true;
  }
}
