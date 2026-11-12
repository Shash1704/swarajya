import { ammoFor, type Formation, formationsFor, isLarge, UNIT_STATS, type UnitType, vetRank } from '../data';
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
  /** A river crosses the field between the armies (fordable in a few places). */
  river?: boolean;
  /** Boggy ground: marshes slow horse and elephants. */
  marsh?: boolean;
  /** Morning mist: short sight and poor aim until it lifts. */
  fog?: boolean;
  /** Battle joined late in the day: night ends it early, in a draw. */
  dusk?: boolean;
  /** The two commanders' gifts: [player side, enemy side]. */
  leaders?: [LeaderMods, LeaderMods];
  /** Set starting places for each side's regiments, in order (historical battles). */
  placement?: [Spot[] | undefined, Spot[] | undefined];
  /** Where the player may move regiments before the battle (y range); default: the bottom of the field. */
  zone0?: [number, number];
  /** A drawn map of the real ground (historical battles), instead of a random field. */
  map?: BattleMap;
  /** Which regiment (by index in each side's list) the commander rides with; default: the strongest. */
  generals?: [number, number];
  /** Each side's starting heart (e.g. 0.75: hungry and dispirited men start at three quarters of their usual morale, and cannot recover more). */
  morale?: [number, number];
  /** Armies that march onto the field partway through the battle (e.g. the Vizier coming up at Delhi). */
  arrivals?: Arrival[];
  /**
   * An army ringed in and starving (Palkhed): its hearts sink over `starveSeconds` until it breaks;
   * the `relief` regiments (indices in its list) march to it, and their arrival lifts it; it wins
   * if its commander's regiment reaches the edge of the field (it has broken out of the ring).
   */
  encircled?: { side: 0 | 1; starveSeconds: number; relief?: number[] };
  /** Thirst or hunger: each side's regiments never rest below this fatigue. */
  thirst?: [number, number];
}

/** An army that reaches the field `at` seconds into the battle, where `spots` say. */
export interface Arrival { side: 0 | 1; at: number; units: CUnit[]; spots: Spot[]; who: string }

/** A regiment's starting place on the field, facing in radians (0 = east, pi/2 = south). */
export interface Spot { x: number; y: number; face?: number }

/** How a commander's traits and experience shape his side in battle. */
export interface LeaderMods {
  morale: number;
  melee: number;
  charge: number;
  /** Extra for cavalry (speed and blows). */
  horse: number;
  defense: number;
  fatigue: number;
}
export const NO_LEADER: LeaderMods = { morale: 1, melee: 1, charge: 1, horse: 1, defense: 1, fatigue: 1 };

export type Order =
  /** Stand still; `face` is the bearing it was told to face (radians), if any. */
  | { kind: 'hold'; face?: number }
  /** March to a point, then face `face` if given (a line drawn with a right-drag). */
  | { kind: 'move'; x: number; y: number; face?: number }
  | { kind: 'attack'; target: number }
  | { kind: 'breach'; seg: number }
  /** Follow a drawn (possibly curved) path, then attack `then` if given. */
  | { kind: 'path'; pts: [number, number][]; i: number; then?: number };

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
  /** Running or galloping in to close with the enemy this step. */
  rushing: boolean;
  /** Seconds left breaking away from a melee: it won't fight back while it pulls clear. */
  disengageT: number;
  /** Battle time of the last disengage, so the AI doesn't flit in and out. */
  lastDisengage: number;
  /** How many times it has come back from a rout. */
  rallies: number;
  /** 0 fresh .. 1 spent: marching, running and fighting tire men out. */
  fatigue: number;
  formation: Formation;
  /** Arrows (seconds of shooting) or volleys left; resupplied from the baggage at the rear. */
  ammo: number;
  maxAmmo: number;
  /** Elephants: fright from fire and shot. Past 1 they may run amok. */
  panic: number;
  amokT: number;
  /** Seconds left of a feigned flight (light horse luring pursuers). */
  feignT: number;
  /** Strung out chasing a feigned flight: easier to cut up. */
  luredT: number;
  /** Seconds left of an ambush's shock. */
  ambushT: number;
  /** Seconds this regiment has gone unseen by the enemy, and when it was last spotted. */
  unseenT: number;
  revealedAt: number;
  ambushReady: boolean;
  /** Veteran rank 0..3 (from its campaign experience). */
  rank: number;
  /** Casualties it has inflicted (for experience). */
  dealt: number;
  dmgMelee: number;
  dmgMissile: number;
  moraleHit: number;
  px: number;
  py: number;
}

export interface Forest { x: number; y: number; r: number }
/** shallow: low in the dry season, so it can be forded anywhere (still bad footing to fight in). */
export interface River { pts: [number, number][]; w: number; fords: Forest[]; shallow?: boolean }
export interface Hill { x: number; y: number; r: number; h: number }

/** The ground of a real battlefield: its features, and names written on the map. */
export interface BattleMap {
  forests?: Forest[];
  hills?: Hill[];
  /** Streams; a short, wide one is a tank or pond. Only the first one's width is used for wading. */
  rivers?: River[];
  marshes?: Forest[];
  villages?: Forest[];
  labels?: { x: number; y: number; text: string; rot?: number; size?: number }[];
}

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

/**
 * The high-ground edge: attacks from clearly higher ground hit harder, rising to double strength
 * when the attacker stands well above the target (a third of a hill's height or more).
 */
/** How much of a downhill run a charge has behind it: 0 on the flat, 1 coming down a steep hill. */
export const downhill = (dh: number) => Math.max(0, Math.min(1, (dh - 0.05) / 0.45));
export const heightEdge = (dh: number) => 1 + Math.max(0, Math.min(1, (dh - 0.1) / 0.2));

export const radiusOf = (t: UnitType) => {
  const c = UNIT_STATS[t].cls;
  return c === 'elephant' ? 26 : c === 'artillery' ? 18 : 22;
};
const cls = (u: BUnit) => UNIT_STATS[u.type].cls;
/** How fast each kind of unit can wheel, in radians per second. */
/** Turns larger than this (about 70 degrees) are made at once, as an about-face, not wheeled. */
const SNAP_TURN = 1.2;
const TURN_RATE: Record<string, number> = { infantry: 3.3, missile: 3.0, cavalry: 1.6, elephant: 1.1, artillery: 0.8 };
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
  rivers: River[] = [];
  marshes: Forest[] = [];
  villages: Forest[] = [];
  hills: Hill[] = [];
  walls: Walls | null = null;
  shots: Shot[] = [];
  floaters: Floater[] = [];
  time = 0;
  winner: -1 | 0 | 1 = -1;
  /** The regiment each side's commander rides with, and whether he has fallen. */
  generalIds: [number, number] = [-1, -1];
  generalLost: [boolean, boolean] = [false, false];
  /** Seconds before each side's commander can rally the army again. */
  rallyCd: [number, number] = [0, 0];
  /** Night fell before either side broke. */
  draw = false;
  /** The battle meter: side 0's share of the fighting strength on the field (0..1, smoothed). */
  balance = 0.5;
  /** The enemy's army has broken and its commander asks for terms; the player must choose. */
  surrenderOffered = false;
  /** The player chose to ride down the broken army: the battle runs on until it has gone. */
  pursuit = false;
  private pursuitEnd = 0;
  /** The player accepted the enemy's surrender. */
  surrenderAccepted = false;
  /** The player chose to destroy the broken army where it stood. */
  destroyed = false;
  /** The enemy army was surrounded when it broke (no way out for it). */
  ringed = false;
  /** Each side's commander was slain (not just his regiment broken). */
  generalSlain: [boolean, boolean] = [false, false];
  /** What became of the enemy commander when his army was destroyed. */
  enemyGeneralFate: 'killed' | 'captured' | null = null;
  /** Encirclement: how far the ringed army has starved (0..1), whether relief has come, whether it broke out. */
  hunger = 0;
  private starveFrom = 0;
  reliefCame = false;
  brokeOut = false;
  /** How many of opts.arrivals have reached the field. */
  arrived = 0;
  /** Fog of war: the enemy regiments each side can see, and where it last saw the rest. */
  readonly fogOn: boolean;
  seen: [Set<number>, Set<number>] = [new Set(), new Set()];
  lastSeen: [Map<number, { x: number; y: number; t: number }>, Map<number, { x: number; y: number; t: number }>] = [new Map(), new Map()];
  private visT = 0;
  readonly leaders: [LeaderMods, LeaderMods];
  readonly opts: BattleOptions;
  readonly attacker: 0 | 1;
  readonly timeLimit: number;
  private rng: RNG;
  private nextId = 1;

  constructor(player: CUnit[], enemy: CUnit[], opts: BattleOptions) {
    this.opts = opts;
    this.attacker = opts.playerAttacks ? 0 : 1;
    this.timeLimit = opts.mode === 'siege' ? 1200 : opts.dusk ? 540 : 900;
    this.fogOn = opts.mode === 'field';
    this.leaders = opts.leaders ?? [NO_LEADER, NO_LEADER];
    this.rng = new RNG(opts.seed);
    this.makeTerrain();
    if (opts.mode === 'siege') this.makeWalls();
    this.deploy(player, 0);
    this.deploy(enemy, 1);
    if (opts.thirst) for (const u of this.units) u.fatigue = opts.thirst[u.side];
    // Each commander rides with the strongest regiment on his side.
    for (const side of [0, 1] as const) {
      const best = this.units.filter((u) => u.side === side)
        .sort((a, c) => c.men * UNIT_STATS[c.type].value - a.men * UNIT_STATS[a.type].value)[0];
      if (best) this.generalIds[side] = best.id;
      const pick = opts.generals?.[side];
      const set = pick !== undefined ? this.units.filter((u) => u.side === side)[pick] : undefined;
      if (set) this.generalIds[side] = set.id;
    }
    this.updateVision();
  }

  // ---------------------------------------------------------------- light, weather and sight

  /** Daylight, 1 by day falling toward 0.45 as night comes on (dusk battles). */
  light(): number {
    if (!this.opts.dusk) return 1;
    return 1 - 0.55 * Math.max(0, Math.min(1, (this.time - (this.timeLimit - 240)) / 240));
  }

  /** Thickness of the morning mist, 1 to 0 as it burns off. */
  mist(): number {
    if (!this.opts.fog) return 0;
    return this.time < 90 ? 0.8 : Math.max(0, 0.8 - (this.time - 90) / 75);
  }

  /** How far a regiment can see. Scouts (light horse) and high ground see furthest. */
  sightOf(u: BUnit): number {
    const st = UNIT_STATS[u.type];
    let r = st.role === 'raider' || st.role === 'skirmish' ? 580 : st.cls === 'cavalry' ? 490 : 440;
    if (this.height(u) > 0.35) r *= 1.3;
    r *= 1 - this.mist() * 0.3;
    r *= 0.6 + 0.4 * this.light();
    return r;
  }

  /** Can side `s` see enemy regiment `t`? (Always true without fog of war.) */
  sees(s: 0 | 1, t: BUnit): boolean {
    return !this.fogOn || this.seen[s].has(t.id);
  }

  private canSee(o: BUnit, t: BUnit): boolean {
    const d = dist(o, t);
    if (d < 110) return true;
    let r = this.sightOf(o);
    const close = d < 240;
    const busy = t.fighting || t.aimId >= 0 || t.moving && t.rushing;
    // Woods and villages hide whoever keeps still in them.
    if (this.inForest(t)) r = Math.min(r, busy ? 230 : UNIT_STATS[t.type].wild ? 85 : 110);
    else if (this.inVillage(t)) r = Math.min(r, busy ? 260 : 160);
    if (d > r) return false;
    // Woods in between thin the view; a ridge in between blocks it.
    const hMax = Math.max(this.height(o), this.height(t)) + 0.45;
    let thinned = false;
    for (let k = 1; k <= 5; k++) {
      const p = { x: o.x + (t.x - o.x) * k / 6, y: o.y + (t.y - o.y) * k / 6 };
      if (!close && this.height(p) > hMax) return false;
      if (!thinned && this.inForest(p) && dist(p, o) > 60 && dist(p, t) > 60) {
        thinned = true;
        if (d > r * 0.75) return false;
      }
    }
    return true;
  }

  private updateVision() {
    for (const s of [0, 1] as const) {
      const eyes = this.units.filter((u) => u.side === s && u.state === 'ok');
      const set = new Set<number>();
      for (const t of this.units) {
        if (t.side === s || (t.state !== 'ok' && t.state !== 'routing')) continue;
        if (!this.fogOn || eyes.some((o) => this.canSee(o, t))) {
          set.add(t.id);
          this.lastSeen[s].set(t.id, { x: t.x, y: t.y, t: this.time });
        }
      }
      this.seen[s] = set;
    }
    // Ambushers: a regiment that has lain unseen a while hits doubly hard when it springs.
    for (const u of this.units) {
      if (u.state !== 'ok') continue;
      const hidden = !this.seen[u.side === 0 ? 1 : 0].has(u.id);
      if (hidden) {
        u.unseenT += 0.25;
        if (u.unseenT >= 3) u.ambushReady = true;
      } else {
        if (u.unseenT > 0) u.revealedAt = this.time;
        u.unseenT = 0;
      }
    }
  }

  /** Called when a regiment strikes (charge or first shot): springs an ambush if it was lying hidden. */
  private spring(u: BUnit, t: BUnit) {
    if (!u.ambushReady || (u.unseenT <= 0 && this.time - u.revealedAt > 3)) return;
    u.ambushReady = false;
    u.ambushT = 5;
    const zone = this.attackZone(u, t);
    if (t.state === 'ok') t.morale -= 14 * (UNIT_STATS[u.type].wild ? 1.4 : 1) * (zone === 'front' ? 1 : 1.5);
    t.calm = 0;
    this.float(u.x, u.y - 14, 'Ambush!', '#ffb36b');
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
    const m = this.opts.map;
    if (m) {
      this.forests = [...(m.forests ?? [])];
      this.hills = [...(m.hills ?? [])];
      this.rivers = (m.rivers ?? []).map((r) => ({ ...r, fords: [...r.fords] }));
      this.marshes = [...(m.marshes ?? [])];
      this.villages = [...(m.villages ?? [])];
      return;
    }
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
    if (siege) return;
    // A river winding across the middle of the field, with two or three fords.
    if (this.opts.river) {
      const y0 = FIELD_H * 0.5 + rng.range(-50, 50);
      const phase = rng.range(0, Math.PI * 2);
      const pts: [number, number][] = [];
      for (let x = -40; x <= FIELD_W + 40; x += 40) {
        pts.push([x, y0 + Math.sin(x / 230 + phase) * 55 + Math.sin(x / 90 + phase * 2) * 12]);
      }
      const nFord = rng.int(2, 3);
      const fords: Forest[] = [];
      for (let i = 0; i < nFord; i++) {
        const fx = FIELD_W * (i + 0.5) / nFord + rng.range(-120, 120);
        const k = Math.max(0, Math.min(pts.length - 1, Math.round((fx + 40) / 40)));
        fords.push({ x: pts[k][0], y: pts[k][1], r: 46 });
      }
      this.rivers.push({ pts, w: 38, fords });
      // Nothing else grows in the river bed.
      this.forests = this.forests.filter((f) => this.riverDist(f) > f.r + 20);
    }
    const nMarsh = this.opts.marsh ? rng.int(2, 4) : t === 'plains' && rng.chance(0.3) ? 1 : 0;
    for (let i = 0; i < nMarsh; i++) {
      this.marshes.push({ x: rng.range(120, FIELD_W - 120), y: rng.range(yMin, yMax), r: rng.range(60, 110) });
    }
    const nVillage = t === 'forest' ? rng.int(0, 1) : rng.int(1, 2);
    for (let i = 0; i < nVillage; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const v = { x: rng.range(150, FIELD_W - 150), y: rng.range(yMin + 20, yMax - 20), r: rng.range(45, 60) };
        if (this.riverDist(v) > v.r + 30 && !this.marshes.some((m) => dist(m, v) < m.r + v.r)) {
          this.villages.push(v);
          break;
        }
      }
    }
  }

  /** Distance from a point to the nearest river's centre line (Infinity if no river). */
  riverDist(p: { x: number; y: number }): number {
    let best = Infinity;
    for (const r of this.rivers) {
      for (let i = 1; i < r.pts.length; i++) {
        const [ax, ay] = r.pts[i - 1];
        const [bx, by] = r.pts[i];
        const vx = bx - ax;
        const vy = by - ay;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy) / (vx * vx + vy * vy)));
        best = Math.min(best, Math.hypot(p.x - ax - vx * t, p.y - ay - vy * t));
      }
    }
    return best;
  }

  onFord(p: { x: number; y: number }): boolean {
    return this.rivers.some((r) => r.fords.some((f) => dist(p, f) < f.r)
      || (r.shallow && this.distTo(r, p) < r.w / 2 + 4));
  }

  /** Distance from a point to one river's centre line. */
  private distTo(r: River, p: { x: number; y: number }): number {
    let best = Infinity;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, ay] = r.pts[i - 1];
      const [bx, by] = r.pts[i];
      const vx = bx - ax;
      const vy = by - ay;
      const k = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy) / (vx * vx + vy * vy)));
      best = Math.min(best, Math.hypot(p.x - ax - vx * k, p.y - ay - vy * k));
    }
    return best;
  }

  /** Wading the river away from a ford: slow, and badly placed to fight. */
  inRiver(p: { x: number; y: number }): boolean {
    return this.rivers.length > 0 && this.riverDist(p) < this.rivers[0].w / 2 + 4 && !this.onFord(p);
  }

  inMarsh(p: { x: number; y: number }): boolean {
    return this.marshes.some((m) => dist(p, m) < m.r);
  }

  inVillage(p: { x: number; y: number }): boolean {
    return this.villages.some((v) => dist(p, v) < v.r);
  }

  /** Waypoints that take a march from `a` to `b` over the river by the nearest ford, if it has to cross. */
  fordRoute(a: { x: number; y: number }, b: { x: number; y: number }): [number, number][] {
    const r = this.rivers[0];
    if (!r) return [];
    const side = (p: { x: number; y: number }) => {
      const k = Math.max(0, Math.min(r.pts.length - 1, Math.round((p.x + 40) / 40)));
      return Math.sign(p.y - r.pts[k][1]);
    };
    if (side(a) === side(b)) return [];
    let best: Forest | null = null;
    let bd = Infinity;
    for (const f of r.fords) {
      const d = dist(a, f) + dist(f, b);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (!best) return [];
    const s = side(a);
    // Approach, cross, and climb out the far bank.
    return [[best.x, best.y + s * 55], [best.x, best.y], [best.x, best.y - s * 55]];
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
    const spots = this.opts.placement?.[side];
    if (spots) {
      cunits.forEach((u, i) => {
        const p = spots[i] ?? { x: FIELD_W / 2 + (i % 8 - 4) * 60, y: FIELD_H * (top ? 0.2 : 0.8) };
        this.addUnit(u, side, p.x, p.y, p.face ?? facing);
      });
      return;
    }
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
    const rank = vetRank(ref.xp);
    // Veterans and a good commander steady the ranks.
    const morale = st.morale * (1 + rank * 0.08) * this.leaders[side].morale * (this.opts.morale?.[side] ?? 1);
    // Garrisons on their own walls draw on the fort's magazines.
    const ammo = this.walls && side === this.defender ? Infinity : ammoFor(ref.type);
    this.units.push({
      id: this.nextId++, side, type: ref.type, ref, men: ref.men, maxMen: st.maxMen, startMen: ref.men,
      x, y, facing, morale, maxMorale: morale, order: { kind: 'hold' }, state: 'ok',
      contactTime: 0, chargeT: 0, movingT: 0, calm: 10, fighting: false, moving: false, aimId: -1,
      reload: st.reload * this.rng.range(0.3, 0.8), climbing: false, climbT: 0, blocked: false, rushing: false, disengageT: 0, lastDisengage: -99,
      rallies: 0, fatigue: 0, formation: 'normal', ammo, maxAmmo: ammo, panic: 0, amokT: 0, feignT: 0, luredT: 0, ambushT: 0,
      unseenT: 0, revealedAt: -99, ambushReady: false, rank, dealt: 0,
      dmgMelee: 0, dmgMissile: 0, moraleHit: 0, px: x, py: y,
    });
  }

  /** Deployment-phase zone for a side (y range). */
  deployZone(side: 0 | 1): [number, number] {
    if (side === 0 && this.opts.zone0) return this.opts.zone0;
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
    let m = this.opts.rain ? 0.86 : 1; // mud
    const big = st.cls === 'cavalry' || st.cls === 'elephant' || st.cls === 'artillery';
    const loose = u.formation === 'loose';
    if (this.inRiver(u)) m *= big ? 0.35 : 0.3;
    else if (this.inMarsh(u)) m *= big ? 0.35 : st.wild ? 0.8 : 0.55;
    else if (this.inForest(u)) m *= st.wild ? 0.95 : st.cls === 'cavalry' ? 0.45 : st.cls === 'artillery' ? 0.4 : loose ? 0.85 : 0.65;
    if (u.formation === 'tight') m *= 0.8;
    else if (loose) m *= 1.05;
    if (st.cls === 'cavalry') m *= this.leaders[u.side].horse;
    // Tired men march slower.
    m *= 1 - 0.32 * u.fatigue;
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
    // Small changes of course are wheeled, so drawn paths trace curves; a big change of
    // direction is an about-face: the ranks turn on the spot at once and march off.
    const want = Math.atan2(dy, dx);
    const away = u.disengageT > 0;
    if (Math.abs(angDiff(u.facing, want)) > SNAP_TURN) u.facing = want;
    const formTurn = u.formation === 'tight' ? 0.7 : u.formation === 'wedge' ? 0.8 : 1;
    turnToward(u, want, TURN_RATE[UNIT_STATS[u.type].cls] * (away ? 3 : formTurn) * dt);
    const off = Math.abs(angDiff(u.facing, want));
    const straight = d < 22 || off < 0.06;
    const vx = straight ? dx / d : Math.cos(u.facing);
    const vy = straight ? dy / d : Math.sin(u.facing);
    const nimble = away || UNIT_STATS[u.type].cls === 'infantry' || UNIT_STATS[u.type].cls === 'missile';
    let k = off > 1.6 ? (nimble ? 0.4 : 0.2) : Math.max(nimble ? 0.6 : 0.35, Math.cos(off));
    // Climbing slows a march; running downhill gathers speed, horse most of all.
    const climb = this.height({ x: u.x + vx * 12, y: u.y + vy * 12 }) - this.height(u);
    if (climb > 0) k *= Math.max(0.55, 1 - climb * 6);
    else if (climb < 0 && !away) k *= 1 + Math.min(0.3, -climb * (UNIT_STATS[u.type].cls === 'cavalry' ? 5 : 2.5));
    const s = Math.min(speed * k * dt, d - stop);
    u.x += vx * s;
    u.y += vy * s;
    return true;
  }

  /**
   * Speed-up for the final dash at an enemy: horse break into a gallop, foot
   * into a run. Rough ground (river, marsh) kills the momentum.
   */
  private rush(u: BUnit, t: BUnit): number {
    if (t.state === 'dead' || t.state === 'fled' || this.inRiver(u) || this.inMarsh(u)) return 1;
    const st = UNIT_STATS[u.type];
    const d = dist(u, t);
    let k = 1;
    if (st.cls === 'cavalry' && d < 220) k = 1.55;
    else if (st.cls === 'elephant' && d < 150) k = 1.3;
    else if (st.cls === 'infantry' && d < 120) k = st.wild ? 1.45 : 1.35;
    if (k > 1) u.rushing = true;
    return k;
  }

  private destOf(u: BUnit): { x: number; y: number } | null {
    const o = u.order;
    if (o.kind === 'move') return o;
    if (o.kind === 'attack') return this.get(o.target) ?? null;
    if (o.kind === 'path') {
      const p = o.pts[o.pts.length - 1];
      return p ? { x: p[0], y: p[1] } : null;
    }
    return null;
  }

  private nearestEnemy(u: BUnit, maxD: number, filter?: (e: BUnit) => boolean): BUnit | null {
    let best: BUnit | null = null;
    let bd = maxD;
    for (const e of this.units) {
      if (e.side === u.side || e.state !== 'ok' || !this.sees(u.side, e)) continue;
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
      u.rushing = false;
      u.px = u.x;
      u.py = u.y;
    }
    const live = us.filter((u) => u.state === 'ok');
    const hittable = us.filter((u) => u.state === 'ok' || u.state === 'routing');
    this.visT -= dt;
    if (this.visT <= 0) {
      this.visT = 0.25;
      this.updateVision();
    }
    this.rallyCd[0] = Math.max(0, this.rallyCd[0] - dt);
    this.rallyCd[1] = Math.max(0, this.rallyCd[1] - dt);
    for (const u of live) {
      u.luredT = Math.max(0, u.luredT - dt);
      u.ambushT = Math.max(0, u.ambushT - dt);
      if (u.feignT > 0) {
        u.feignT -= dt;
        if (u.feignT <= 0) {
          // The flight was a ruse: the riders wheel about on their strung-out pursuers.
          u.feignT = 0;
          u.order = { kind: 'hold' };
          const n = this.nearestEnemy(u, 400);
          if (n) u.facing = Math.atan2(n.y - u.y, n.x - u.x);
          u.morale = Math.min(u.maxMorale, u.morale + 10);
          this.float(u.x, u.y, 'Turn and fight!', '#ffe08a');
        }
      }
      // Anyone chasing a fleeing horseman runs out of order.
      if (u.order.kind === 'attack') {
        const t = this.get(u.order.target);
        if (t && t.feignT > 0 && dist(u, t) < 320) u.luredT = Math.max(u.luredT, 4);
      }
    }

    // 1. Melee: anything within reach of an enemy stops and fights.
    for (const u of live) {
      if (u.feignT > 0) continue; // fleeing (for now): not standing to fight
      if (u.disengageT > 0) {
        // Breaking away: it turns its back and takes blows, but isn't pinned in place.
        u.disengageT -= dt;
        u.contactTime = 0;
        u.chargeT = 0;
        if (u.disengageT > 0) continue;
        u.movingT = 0; // caught again straight away: no fresh charge
      }
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
        if (u.contactTime === 0 && u.movingT > 0.4 && (st.charge > 1.1 || st.cls === 'infantry') && !u.climbing) {
          u.chargeT = st.cls === 'infantry' ? 1.6 : 2.5;
          // Charging down a slope carries the impetus further.
          u.chargeT *= 1 + downhill(this.height(u) - this.height(contact)) * 0.5;
          const zone = this.attackZone(u, contact);
          const intoFoot = UNIT_STATS[contact.type].cls === 'infantry' && contact.state === 'ok';
          const label = zone === 'front' ? 'Charge!' : zone === 'flank' ? 'Flank charge!' : 'Charge from behind!';
          this.spring(u, contact);
          if (isLarge(u.type) && intoFoot && zone === 'front' && contact.formation !== 'loose' && this.caught(contact, u) === 0) {
            this.float(u.x, u.y, contact.formation === 'brace' ? 'Broken on the spears!' : 'Charge broken!', '#ff9a8a');
          } else {
            this.float(u.x, u.y, label, st.cls === 'infantry' ? '#ffd0a0' : '#ffe08a');
            // The shock of impact: the regiment struck wavers at once, worst from the side or behind.
            if (contact.state === 'ok') {
              const base = (st.cls === 'infantry' ? 5 : 9) * (u.formation === 'wedge' ? 1.4 : 1);
              contact.morale -= base * (zone === 'front' ? 1 : zone === 'flank' ? 1.8 : 2.4) * (contact.formation === 'tight' ? 0.6 : 1);
            }
          }
        }
        u.fighting = true;
        if (this.inRiver(u)) u.moraleHit += 3 * dt; // fighting waist-deep in a river
        u.contactTime += dt;
        u.chargeT = Math.max(0, u.chargeT - dt);
        if (!u.climbing) {
          // A regiment already fighting something to its front holds its facing; one struck only from
          // the side or rear wheels round slowly, and is cut up while it does.
          const c = contact;
          const engagedFront = hittable.some((e) => e.side !== u.side && dist(u, e) < CONTACT && this.attackZone(e, u) === 'front');
          if (!engagedFront) turnToward(u, Math.atan2(c.y - u.y, c.x - u.x), (cls(u) === 'cavalry' ? 1.2 : 0.55) * dt);
        }
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

    // Fatigue, fright and resupply.
    for (const u of live) {
      const c = cls(u);
      let tire: number;
      if (u.climbing) tire = 0.02;
      else if (u.fighting) tire = c === 'cavalry' ? 0.012 : 0.01;
      else if (u.moving) {
        tire = u.rushing ? 0.03 : c === 'cavalry' ? 0.005 : 0.004;
        if (this.inMarsh(u) || this.inRiver(u)) tire *= 1.8;
        if (this.height(u) > 0.3) tire *= 1.3;
        if (this.opts.rain) tire *= 1.2;
      } else tire = u.calm > 2 ? -0.035 : -0.02;
      if (tire > 0) tire *= this.leaders[u.side].fatigue * (1 - u.rank * 0.08) * (c === 'artillery' ? 0.3 : 1);
      u.fatigue = Math.max(this.opts.thirst?.[u.side] ?? 0, Math.min(1, u.fatigue + tire * dt));
      if (c === 'elephant') {
        u.panic = Math.max(0, u.panic - (u.calm > 2 ? 0.06 : 0.02) * dt);
        if (u.panic >= 1 && this.rng.chance(0.4 * dt)) {
          u.state = 'routing';
          u.amokT = 0;
          u.order = { kind: 'hold' };
          this.float(u.x, u.y, 'Amok!', '#ff6b5b');
          this.moraleShock(u, 6);
          this.checkGeneral(u);
        }
      }
      if (u.maxAmmo > 0 && u.ammo < u.maxAmmo && !u.fighting && this.atBaggage(u)) {
        const was = u.ammo;
        u.ammo = Math.min(u.maxAmmo, u.ammo + u.maxAmmo * 0.08 * dt);
        if (was <= 0 && u.ammo > 0) this.float(u.x, u.y, 'Resupplied', '#bfe39a');
      }
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
        u.amokT += dt;
        // In the end the mahout drives the spike home rather than let the beast trample his own side.
        if (u.amokT > 12 && this.rng.chance(0.12 * dt)) {
          u.state = 'dead';
          u.men = 0;
          this.float(u.x, u.y, 'The mahout slays his beast', '#e8d2b0');
          continue;
        }
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
      // The battle meter: men on the winning side fight better and hold their nerve; the losing side wavers.
      const edge = 1 - 0.36 * this.momentum(u.side);
      u.dmgMelee *= edge;
      u.dmgMissile *= edge;
      u.moraleHit *= edge;
      const total = u.dmgMelee + u.dmgMissile;
      // Tight ranks steady men; loose order, weariness and a ragged pursuit unnerve them.
      const nerve = (u.formation === 'tight' || u.formation === 'brace' ? 0.85 : u.formation === 'loose' ? 1.1 : 1)
        * (1 + 0.45 * u.fatigue) * (u.luredT > 0 ? 1.2 : 1);
      if (total > 0) {
        u.men = Math.max(0, u.men - total);
        u.morale -= ((u.dmgMelee * 110 + u.dmgMissile * 70) / u.maxMen) * nerve;
        u.calm = 0;
      } else {
        u.calm += dt;
      }
      u.morale -= u.moraleHit * nerve;
      if (u.men < Math.max(1, u.maxMen * 0.05)) {
        u.state = 'dead';
        u.men = 0;
        this.moraleShock(u, 9);
        this.checkGeneral(u);
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
          this.checkGeneral(u);
        } else if (!u.fighting && u.calm > 1) {
          u.morale = Math.min(u.maxMorale, u.morale + 3 * (1 - 0.5 * u.fatigue) * dt);
        }
      } else if (u.state === 'routing' && cls(u) !== 'elephant' && u.men > u.startMen * 0.25 && !(u.side === 1 && this.surrenderOffered)) {
        // Men rally sooner, and more than once, under the commander's standard.
        const g = this.get(this.generalIds[u.side]);
        const byStandard = !!g && g !== u && g.state === 'ok' && !g.fighting && dist(g, u) < 170;
        const ok = byStandard
          ? u.rallies < 2 && u.calm > 2 && !this.nearestEnemy(u, 110)
          : u.rallies < 1 && u.calm > 6 && !this.nearestEnemy(u, 220);
        if (ok) {
          u.state = 'ok';
          u.rallies++;
          u.morale = u.maxMorale * 0.4;
          this.float(u.x, u.y, byStandard ? 'Rallied to the standard' : 'Rallied', '#bfe39a');
        }
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

    if (this.winner < 0) {
      this.riskGeneral(dt);
      this.updateArrivals();
      this.updateRing();
      if (this.winner >= 0) return;
      this.updateBalance(dt);
      this.checkEnd();
    }
  }

  private act(u: BUnit, dt: number) {
    const st = UNIT_STATS[u.type];
    // A spear hedge cannot march: any order to go somewhere breaks it up.
    if (u.formation === 'brace' && u.order.kind !== 'hold') {
      u.formation = 'normal';
      this.float(u.x, u.y, 'Hedge broken up', '#e8d2b0');
    }
    const speed = st.speed * this.speedMod(u);
    const o = u.order;
    let moving = false;
    let breachSeg = -1;

    if (o.kind === 'move') {
      moving = this.travel(u, o.x, o.y, speed, dt, 0);
      if (!moving && Math.hypot(o.x - u.x, o.y - u.y) < 3) u.order = { kind: 'hold', face: o.face };
    } else if (o.kind === 'path') {
      const then = o.then !== undefined ? this.get(o.then) : undefined;
      if (then && then.state === 'ok' && dist(u, then) < 90) {
        u.order = { kind: 'attack', target: then.id }; // close enough: go in
      } else {
        const pt = o.pts[o.i];
        if (!pt) u.order = then && then.state === 'ok' ? { kind: 'attack', target: then.id } : { kind: 'hold' };
        else {
          moving = this.travel(u, pt[0], pt[1], speed, dt, 0);
          // Reached it, or stuck short of it against an obstacle or the field's edge: on to the next point.
          if (Math.hypot(pt[0] - u.x, pt[1] - u.y) < 14 || (!moving && u.blocked)) o.i++;
          else if (u.x <= 16 || u.y <= 16 || u.x >= FIELD_W - 16 || u.y >= FIELD_H - 16) {
            if (Math.hypot(pt[0] - u.x, pt[1] - u.y) < 60) o.i++;
          }
        }
      }
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
        moving = this.travel(u, t.x, t.y, speed * this.rush(u, t), dt, CONTACT - 6);
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

    if (st.range > 0 && (!moving || st.shootMoving) && (u.ammo > 0 || breachSeg >= 0)) this.shoot(u, dt, breachSeg);
    if (!moving && u.aimId < 0 && u.order.kind === 'hold') {
      // Hold the facing it was given; only an enemy close at hand makes it turn.
      const face = u.order.face;
      const n = this.nearestEnemy(u, face === undefined ? 300 : 130);
      if (n) turnToward(u, Math.atan2(n.y - u.y, n.x - u.x), (cls(u) === 'cavalry' ? 1.2 : 0.6) * dt);
      else if (face !== undefined) {
        if (Math.abs(angDiff(u.facing, face)) > SNAP_TURN) u.facing = face; // about-face at once
        const formTurn = u.formation === 'tight' ? 0.7 : u.formation === 'brace' ? 0.3 : 1;
        turnToward(u, face, TURN_RATE[cls(u)] * 0.8 * formTurn * dt);
      }
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
    if (this.height(u) > 0.4) m *= 1.2;
    if (this.opts.rain && weapon(u) === 'bow') m *= 0.8;
    m *= 1 - this.mist() * 0.2;
    m *= 0.75 + 0.25 * this.light();
    return m;
  }

  private missileMod(u: BUnit, t: BUnit): number {
    const tt = UNIT_STATS[t.type];
    const pierce = weapon(u) === 'gun' ? 0.25 : weapon(u) === 'cannon' ? 0 : 0.7;
    let m = (1 - tt.armor * pierce) / Math.max(1, tt.defense / 1.5);
    if (weapon(u) !== 'cannon' && this.inForest(t)) m *= 0.55;
    if (this.inVillage(t)) m *= 0.6;
    if (this.inRiver(t)) m *= 1.25;
    // Shooting down from high ground: up to twice as deadly.
    m *= heightEdge(this.height(u) - this.height(t));
    // A regiment standing still is an easy mark; one on the move is harder to hit.
    if (!t.moving && !t.climbing) m *= 1.3;
    if (this.walls && this.region(u.y) === 'out') {
      const rt = this.region(t.y);
      if (rt === 'band' && !t.climbing) m *= 0.5;
      else if (rt === 'in') m *= 0.75;
    }
    if (t.climbing) m *= 1.3;
    if (t.formation === 'tight' || t.formation === 'brace') m *= weapon(u) === 'cannon' || weapon(u) === 'rocket' ? 1.5 : 1.3;
    else if (t.formation === 'loose') m *= 0.65;
    if (t.luredT > 0) m *= 1.15;
    if (u.ambushT > 0) m *= 1.3;
    m *= 1 + u.rank * 0.06;
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
      if (c && c.state === 'ok' && dist(u, c) <= range && this.sees(u.side, c)) t = c;
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
      if (u.aimId < 0) this.spring(u, t);
      u.aimId = t.id;
      const dmg = u.men * st.missile * dt * this.missileMod(u, t);
      t.dmgMissile += dmg;
      u.dealt += dmg;
      if (cls(t) === 'elephant') t.panic += 0.03 * dt;
      this.useAmmo(u, dt);
      return;
    }

    u.reload -= dt;
    if (u.reload > 0) return;
    u.reload = st.reload * this.rng.range(0.9, 1.1);
    if (t) this.spring(u, t);
    this.useAmmo(u, 1);
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
    u.dealt += dmg;
    // Fire and thunder frighten elephants; rockets most of all.
    if (cls(victim) === 'elephant') victim.panic += weapon(u) === 'rocket' ? 0.45 : weapon(u) === 'cannon' ? 0.35 : 0.12;
    const shock = (dmg * 35) / victim.maxMen * (cls(victim) === 'elephant' ? 4 : isLarge(victim.type) ? 1.5 : 1);
    if (weapon(u) !== 'bow') victim.moraleHit += shock;
    this.shots.push({ kind: weapon(u) === 'cannon' ? 'cannon' : weapon(u) === 'rocket' ? 'rocket' : 'musket', x0: u.x, y0: u.y, x1: victim.x, y1: victim.y, t: 0 });
  }

  private useAmmo(u: BUnit, n: number) {
    if (!Number.isFinite(u.ammo)) return;
    u.ammo = Math.max(0, u.ammo - n);
    if (u.ammo <= 0) {
      const w = weapon(u);
      this.float(u.x, u.y, w === 'bow' ? 'Out of arrows!' : w === 'rocket' ? 'Out of rockets!' : 'Out of powder!', '#e8d2b0');
    }
  }

  /**
   * Pulls a regiment out of the melee it's locked in so it can follow new orders. For a few
   * seconds it won't strike back and the foe gets it from behind; cavalry slips away quickest.
   */
  disengage(u: BUnit): boolean {
    if (u.state !== 'ok' || !u.fighting || u.disengageT > 0) return false;
    const c = cls(u);
    u.disengageT = c === 'cavalry' ? 2.2 : c === 'elephant' ? 3 : 3.2;
    u.lastDisengage = this.time;
    u.fighting = false;
    u.contactTime = 0;
    u.chargeT = 0;
    u.morale -= c === 'cavalry' ? 3 : 6;
    this.float(u.x, u.y, 'Falling back!', '#cfe0ff');
    return true;
  }

  /**
   * How badly a regiment is caught out when horsemen fall on it (0 = formed and ready): on the
   * march or falling back (not standing to receive them), already locked in a fight with another
   * enemy, or softened (shaken, spent, or cut down to half its men). Each counts.
   */
  caught(t: BUnit, by: BUnit): number {
    let n = 0;
    if (t.disengageT > 0 || t.feignT > 0 || (t.moving && !t.fighting)) n++;
    if (this.units.some((e) => e !== by && e.side === by.side && e.state === 'ok' && dist(e, t) < CONTACT)) n++;
    if (t.morale < t.maxMorale * 0.45 || t.fatigue > 0.6 || t.men < t.startMen * 0.5) n++;
    if (this.inWater(t)) n++; // floundering through water: no order, no footing
    return n;
  }

  /** Wading a river or tank, or splashing over a ford. */
  inWater(p: { x: number; y: number }): boolean {
    return this.inRiver(p) || this.onFord(p);
  }

  /** Where a blow lands on the target: its front, a flank, or its rear. */
  attackZone(a: BUnit, t: BUnit): 'front' | 'flank' | 'rear' {
    if (t.state === 'routing') return 'rear';
    if (t.climbing) return 'front';
    const rel = Math.abs(angDiff(t.facing, Math.atan2(a.y - t.y, a.x - t.x)));
    return rel > 2.1 ? 'rear' : rel > 1.05 ? 'flank' : 'front';
  }

  /** When the commander's regiment breaks or is destroyed, the whole army's nerve goes with it. */
  /** A commander in the thick of it may be cut down or shot: the more his regiment suffers, the likelier. */
  private riskGeneral(dt: number) {
    for (const side of [0, 1] as const) {
      if (this.generalLost[side]) continue;
      const g = this.get(this.generalIds[side]);
      if (!g || g.state !== 'ok' || (!g.fighting && g.dmgMissile <= 0)) continue;
      // The player's own commander is you: wounded, perhaps, but not slain.
      if (side === 0) continue;
      const hurt = 1 - g.men / Math.max(1, g.startMen);
      if (this.rng.next() < dt * 0.006 * (1 + 4 * hurt) * (g.fighting ? 1 : 0.5)) {
        this.generalSlain[side] = true;
        this.float(g.x, g.y - 30, 'Their general is slain!', '#ffe08a');
        this.checkGeneral(g);
      }
    }
  }

  private checkGeneral(u: BUnit) {
    const side = u.side;
    if (this.generalIds[side] !== u.id || this.generalLost[side]) return;
    this.generalLost[side] = true;
    if (!this.generalSlain[side]) this.float(u.x, u.y - 24, 'The general has fallen!', '#ff6b5b');
    for (const v of this.units) {
      if (v.side !== side || v.state !== 'ok') continue;
      v.morale -= Math.max(25, v.maxMorale * 0.4);
      v.calm = 0;
    }
  }

  private melee(a: BUnit, t: BUnit, dt: number) {
    const sa = UNIT_STATS[a.type];
    const st = UNIT_STATS[t.type];
    let mult = 1;
    const zone = this.attackZone(a, t);
    const horse = sa.cls === 'cavalry';
    const tFoot = st.cls === 'infantry';
    const tShooters = st.cls === 'missile' || st.cls === 'artillery';
    // Caught on the march, falling back, tied up with another foe, or worn down: easy meat for horse.
    const caught = horse && t.state === 'ok' ? this.caught(t, a) : 0;
    if (caught) {
      mult *= 1.5 + 0.3 * (caught - 1);
      t.moraleHit += 4 * caught * dt;
    }

    // Blows from the side or behind. Infantry are ruinous to each other's flanks.
    if (t.state === 'routing') mult *= 1.5;
    else if (zone !== 'front') {
      const footOnFoot = sa.cls === 'infantry' && (tFoot || tShooters);
      mult *= zone === 'rear' ? (footOnFoot ? 2.0 : 1.5) : (footOnFoot ? 1.6 : 1.3);
      t.moraleHit += (zone === 'rear' ? 6 : 4) * dt;
      if (t.formation === 'wedge') mult *= 1.25; // a wedge's sides are thin
      if (t.formation === 'brace') mult *= 1.2; // a hedge faces one way only
    }

    // Men in the water cannot keep their ranks or footing: every blow tells, a charge most of all.
    if (this.inWater(t) && !this.inWater(a)) {
      mult *= 1.35;
      if (a.chargeT > 0) {
        mult *= horse ? 1.9 : 1.5;
        t.moraleHit += (horse ? 12 : 7) * dt;
      }
    }
    // The charge.
    if (a.chargeT > 0 && !this.inRiver(a) && !this.inMarsh(a)) {
      // Downhill: up to x2.2 for horse, x1.6 for foot, and the shock shakes the men struck.
      const down = downhill(this.height(a) - this.height(t));
      const slopeK = 1 + down * (horse ? 1.2 : sa.cls === 'infantry' ? 0.6 : 0.25);
      if (down > 0) t.moraleHit += down * (horse ? 10 : 5) * dt;
      const slope = slopeK
        * (a.formation === 'wedge' ? 1.3 : 1) * this.leaders[a.side].charge
        * (this.opts.rain && horse ? 0.8 : 1) * (1 - 0.4 * a.fatigue);
      if (horse && tFoot && zone === 'front' && t.state === 'ok' && (t.formation === 'loose' || caught)) {
        // Loose order cannot stop a charge: the riders ride straight through.
        mult *= 1 + (sa.charge - 1) * 0.6 * slope;
      } else if (horse && tFoot && zone === 'front' && t.state === 'ok') {
        // Head-on into a formed infantry line the charge breaks, and the riders pay for it:
        // spears and pikes most of all, a braced hedge worst of all.
        const k = t.formation === 'brace' ? 1.6 : t.formation === 'tight' ? 1.2 : 1;
        // Riders coming down a slope crash through: the line gives way before it can punish them.
        mult *= 1 + (slopeK - 1) * 0.8;
        const recoil = (MELEE_RATE * t.men * st.melee * (st.antiLarge > 1 ? 2.4 : 1.3) * k * dt) / (sa.defense * slopeK);
        a.dmgMelee += recoil;
        a.moraleHit += 3 * dt;
      } else if (st.antiLarge > 1 && isLarge(a.type) && zone === 'front' && t.state === 'ok') {
        // Elephants into braced spears: no impetus.
      } else if (horse && tShooters && zone === 'front') {
        mult *= 1 + (sa.charge - 1) * 0.7 * slope;
      } else {
        // Foot that run in hit harder too, though less than horse.
        mult *= (sa.cls === 'infantry' ? Math.max(1.35, sa.charge * 1.1) : sa.charge) * slope;
      }
    }
    // Once the charge is spent, horse still fight poorly against an unbroken infantry front.
    if (horse && tFoot && zone === 'front' && t.state === 'ok') {
      mult *= t.formation === 'loose' || caught ? 1.1 : 0.85;
      // Pressing on into a levelled hedge keeps costing riders.
      if (t.formation === 'brace') a.dmgMelee += (MELEE_RATE * t.men * st.melee * 0.5 * dt) / sa.defense;
    }
    if (cls(a) === 'elephant' && t.formation === 'brace' && zone === 'front') a.panic += 0.05 * dt; // goaded by a wall of spears
    if (cls(t) === 'elephant' && UNIT_STATS[a.type].antiLarge > 1) t.panic += 0.03 * dt; // jabbed by spears
    // Archers and gunners cannot stand against horse, least of all from the side.
    if (horse && tShooters) {
      mult *= zone === 'front' ? 1.5 : 2.0;
      t.moraleHit += (zone === 'front' ? 3 : 6) * dt;
    }

    if (isLarge(t.type)) mult *= sa.antiLarge * (a.formation === 'brace' ? 1.3 : 1);
    else if (a.formation === 'brace') mult *= 0.85;
    // Formations in rough country: blocks fall apart in woods, skirmishers come into their own.
    const woods = this.inForest(a);
    if (a.formation === 'loose') mult *= woods ? 1.15 : 0.85;
    else if (a.formation === 'tight' && woods) mult *= 0.8;
    if (a.formation === 'wedge' && a.chargeT <= 0) mult *= 0.9;
    if (a.ambushT > 0) mult *= 1.35;
    if (t.luredT > 0) mult *= 1.25;
    mult *= (1 - 0.3 * a.fatigue) * (1 + a.rank * 0.06) * this.leaders[a.side].melee * (horse ? this.leaders[a.side].horse : 1);
    if (sa.wild && (this.inForest(a) || this.height(a) > 0.35)) mult *= 1.25;
    if (horse && this.inForest(a)) mult *= 0.7;
    const dh = this.height(a) - this.height(t);
    if (dh > 0) mult *= heightEdge(dh); // striking down from the high ground: up to double
    else if (dh < -0.15) mult *= Math.max(0.7, 1 + dh * 0.6); // fighting uphill
    if (this.inRiver(a)) mult *= 0.6;
    if (isLarge(a.type) && this.inMarsh(a)) mult *= 0.7;
    if (this.walls) {
      if (a.climbing) mult *= 0.5;
      if (t.climbing && this.onWall(a)) mult *= 1.3;
    }
    const tWoods = this.inForest(t);
    const form = t.formation === 'tight' ? (tWoods ? 0.95 : 1.25) : t.formation === 'loose' ? (tWoods ? 1 : 0.8)
      : t.formation === 'brace' ? (zone === 'front' ? 1.4 : 0.8) : 1;
    const def = st.defense * (this.onWall(t) && !this.onWall(a) ? 1.5 : 1)
      * (this.inRiver(t) ? 0.65 : 1)
      * (this.inVillage(t) && st.cls !== 'cavalry' ? 1.25 : 1)
      * form * this.leaders[t.side].defense * (1 - 0.15 * t.fatigue);
    const dmg = (MELEE_RATE * a.men * sa.melee * mult * dt) / def;
    t.dmgMelee += dmg;
    a.dealt += dmg;
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

  /** Fighting strength a side still has: men, quality, nerve and freshness; broken men count for little. */
  private sideStrength(side: 0 | 1): number {
    let s = 0;
    for (const u of this.units) {
      if (u.side !== side) continue;
      const v = u.men * UNIT_STATS[u.type].value;
      // A starving army has no strength in it.
      const starving = this.opts.encircled?.side === side ? 1 - 0.55 * this.hunger : 1;
      if (u.state === 'ok') s += v * (0.5 + 0.5 * Math.max(0, u.morale) / Math.max(1, u.maxMorale)) * (1 - 0.3 * u.fatigue) * starving;
      else if (u.state === 'routing') s += v * 0.12;
    }
    return s;
  }

  /** How the battle is going for a side: +0.5 winning outright, -0.5 losing outright. */
  momentum(side: 0 | 1): number {
    return side === 0 ? this.balance - 0.5 : 0.5 - this.balance;
  }

  /** Below this share of the field's strength, the enemy army breaks and its commander asks for terms. */
  static readonly SURRENDER = 0.2;

  /** The next army still on its way, and the seconds until it arrives. */
  nextArrival(): { who: string; side: 0 | 1; inSec: number } | null {
    const a = this.opts.arrivals?.[this.arrived];
    return a ? { who: a.who, side: a.side, inSec: Math.max(0, a.at - this.time) } : null;
  }

  private updateArrivals() {
    const list = this.opts.arrivals;
    while (list && this.arrived < list.length && this.time >= list[this.arrived].at) {
      const a = list[this.arrived++];
      const facing = this.homeTop(a.side) ? Math.PI / 2 : -Math.PI / 2;
      a.units.forEach((u, i) => {
        const p = a.spots[i] ?? a.spots[a.spots.length - 1];
        this.addUnit(u, a.side, p.x, p.y, p.face ?? facing);
      });
      const p = a.spots[0];
      if (p) this.float(p.x, p.y - 30, `${a.who} comes up!`, a.side === 1 ? '#ff8a7a' : '#ffe08a');
    }
  }

  /** The ring: hunger saps the ringed army, its relief marches to it, and its commander may break out. */
  private updateRing() {
    const r = this.opts.encircled;
    if (!r) return;
    const side = r.side;
    this.hunger = Math.max(0, Math.min(1, (this.time - this.starveFrom) / r.starveSeconds));
    for (const u of this.units) {
      if (u.side !== side || u.state !== 'ok') continue;
      u.morale = Math.min(u.morale, u.maxMorale * (1 - 0.7 * this.hunger));
    }
    const g = this.get(this.generalIds[side]);
    if (!g || g.state !== 'ok') return;
    // The relief column marches on the commander's standard, whatever else is happening.
    const mine = this.units.filter((u) => u.side === side);
    const relief = (r.relief ?? []).map((i) => mine[i]).filter((u): u is BUnit => !!u && u.state === 'ok');
    if (!this.reliefCame) {
      for (const u of relief) if (!u.fighting) u.order = { kind: 'move', x: g.x, y: g.y };
      if (relief.some((u) => dist(u, g) < 230)) {
        this.reliefCame = true;
        // Food, powder and the great guns: the camp takes heart and the hunger is set back.
        this.starveFrom = Math.min(this.time, this.starveFrom + r.starveSeconds * 0.4);
        for (const u of this.units) if (u.side === side && u.state === 'ok') u.morale = Math.min(u.maxMorale, u.morale + 20);
        this.float(g.x, g.y - 30, 'The great guns have come up!', '#ffe08a');
      }
    }
    // Out of the ring: the commander's regiment reaches the edge of the field.
    if (this.time > 5 && (g.x < 30 || g.x > FIELD_W - 30 || g.y < 30 || g.y > FIELD_H - 30)) {
      this.brokeOut = true;
      this.winner = side;
      this.float(g.x, g.y - 30, 'He has broken out of the ring!', '#ff8a7a');
    }
  }

  private updateBalance(dt: number) {
    const a = this.sideStrength(0);
    const b = this.sideStrength(1);
    const raw = a + b > 0 ? a / (a + b) : 0.5;
    this.balance += (raw - this.balance) * Math.min(1, dt * 1.5);
    if (this.surrenderOffered || this.pursuit || this.time < 15 || this.walls) return;
    const starved = this.opts.encircled?.side === 1 && this.hunger >= 1;
    // Surrounded with the day going against it, an army's nerve breaks long before it is beaten.
    const ringed = this.balance >= 0.6 && this.surrounded(1);
    if (1 - this.balance < Battle.SURRENDER || starved || ringed) {
      this.ringed = this.surrounded(1);
      // The enemy's nerve is gone: every regiment breaks, and the commander sends to ask for terms.
      this.surrenderOffered = true;
      for (const u of this.units) {
        if (u.side !== 1 || u.state !== 'ok') continue;
        u.state = 'routing';
        u.morale = 0;
        u.climbing = false;
        u.order = { kind: 'hold' };
      }
      const g = this.get(this.generalIds[1]);
      if (g) this.float(g.x, g.y - 24, this.ringed ? 'Surrounded, the army breaks!' : 'The army breaks! Their commander asks for terms', '#ffe08a');
    }
  }

  /**
   * Is this side's army hemmed in? The other side's regiments stand round it on (nearly) every
   * side: no gap of more than about 120 degrees for it to get away through.
   */
  surrounded(side: 0 | 1): boolean {
    const mine = this.units.filter((u) => u.side === side && (u.state === 'ok' || u.state === 'routing'));
    const foes = this.units.filter((u) => u.side !== side && u.state === 'ok');
    if (!mine.length || foes.length < 3) return false;
    const cx = mine.reduce((s, u) => s + u.x, 0) / mine.length;
    const cy = mine.reduce((s, u) => s + u.y, 0) / mine.length;
    const ang = foes.filter((f) => Math.hypot(f.x - cx, f.y - cy) < 520).map((f) => Math.atan2(f.y - cy, f.x - cx)).sort((a, b) => a - b);
    if (ang.length < 3) return false;
    let gap = ang[0] + Math.PI * 2 - ang[ang.length - 1];
    for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
    return gap < (Math.PI * 2) / 3;
  }

  /**
   * The broken army is destroyed where it stands. Ringed in, it is cut down to the last man and its
   * commander most likely dies with it; in the open, most fall and a few escape. Killing costs a little.
   */
  destroyArmy() {
    const ringed = this.ringed;
    for (const u of this.units) {
      if (u.side === 0) {
        if (u.state === 'ok') u.men *= 0.97;
        continue;
      }
      if (u.state === 'dead' || u.state === 'fled') continue;
      if (ringed) {
        u.men = 0;
        u.state = 'dead';
      } else {
        u.men *= 0.5;
        u.state = 'fled';
      }
    }
    // The commander shares his army's fate: slain already, or killed or taken now.
    this.generalLost[1] = true;
    if (this.generalSlain[1]) this.enemyGeneralFate = 'killed';
    else {
      this.enemyGeneralFate = this.rng.next() < (ringed ? 0.7 : 0.4) ? 'killed' : 'captured';
      if (this.enemyGeneralFate === 'killed') this.generalSlain[1] = true;
    }
    this.destroyed = true;
    this.winner = 0;
  }

  /** The player rides the broken army down: the battle goes on until it has fled or for two minutes. */
  pursue() {
    this.pursuit = true;
    this.pursuitEnd = this.time + 120;
  }

  acceptSurrender() {
    this.surrenderAccepted = true;
    this.winner = 0;
  }

  private checkEnd() {
    // A broken army asking for terms: wait for the player's answer; a pursuit runs until they have gone.
    if (this.surrenderOffered && !this.pursuit) return;
    if (this.pursuit) {
      const left = this.units.some((u) => u.side === 1 && (u.state === 'ok' || u.state === 'routing'));
      if (!left || this.time >= this.pursuitEnd) this.winner = 0;
      return;
    }
    // Gun crews alone cannot hold a field.
    const alive = (s: number) => this.units.some((u) => u.side === s && u.state === 'ok' && cls(u) !== 'artillery');
    const a0 = alive(0);
    const a1 = alive(1);
    if (!a0 && !a1) this.winner = this.defender;
    else if (!a0) this.winner = 1;
    else if (!a1) this.winner = 0;
    else if (this.assaultSpent()) this.winner = this.defender;
    else if (this.time >= this.timeLimit) {
      // Night: in the field both armies draw off; a storming party that hasn't won by then has failed.
      this.winner = this.defender;
      if (!this.walls) this.draw = true;
    }
  }

  /** At the baggage train behind its own lines, where arrows and powder are handed out. */
  atBaggage(u: BUnit): boolean {
    return this.homeTop(u.side) ? u.y < 160 : u.y > FIELD_H - 160;
  }

  /** The commander rides along the line calling the men back to the colours. */
  rally(side: 0 | 1): boolean {
    const g = this.get(this.generalIds[side]);
    if (!g || g.state !== 'ok' || this.generalLost[side] || this.rallyCd[side] > 0) return false;
    this.rallyCd[side] = 45;
    this.float(g.x, g.y - 20, 'Rally to the standard!', '#ffe08a');
    for (const u of this.units) {
      if (u.side !== side || dist(u, g) > 260) continue;
      if (u.state === 'ok') {
        u.morale = Math.min(u.maxMorale, u.morale + 20);
        u.fatigue = Math.max(0, u.fatigue - 0.1);
      } else if (u.state === 'routing' && cls(u) !== 'elephant' && u.men > u.startMen * 0.2 && !this.nearestEnemy(u, 90)) {
        u.state = 'ok';
        u.rallies++;
        u.morale = u.maxMorale * 0.35;
        this.float(u.x, u.y, 'Rallied', '#bfe39a');
      }
    }
    return true;
  }

  /**
   * Feigned flight: the riders turn tail as if beaten, drawing pursuers out of their line, then
   * wheel about. Light horse do it best; heavy horse lose some nerve doing it.
   */
  feign(u: BUnit): boolean {
    if (u.state !== 'ok' || cls(u) !== 'cavalry' || u.feignT > 0) return false;
    const light = UNIT_STATS[u.type].role === 'raider' || UNIT_STATS[u.type].role === 'skirmish';
    if (u.fighting) {
      u.disengageT = 2.2;
      u.lastDisengage = this.time;
      u.fighting = false;
      u.contactTime = 0;
    }
    u.feignT = light ? 6 : 7;
    if (!light) u.morale -= 8;
    const n = this.nearestEnemy(u, 500);
    let vx = 0;
    let vy = this.homeTop(u.side) ? -1 : 1;
    if (n) {
      const d = Math.max(1, dist(u, n));
      vx = (u.x - n.x) / d;
      vy = (u.y - n.y) / d;
    }
    u.order = {
      kind: 'move',
      x: Math.max(30, Math.min(FIELD_W - 30, u.x + vx * 300)),
      y: Math.max(30, Math.min(FIELD_H - 30, u.y + vy * 300)),
    };
    this.float(u.x, u.y, 'Feigned flight!', '#cfe0ff');
    return true;
  }

  /** Changes a regiment's formation, if its kind can take it up. */
  setFormation(u: BUnit, f: Formation): boolean {
    if (u.state !== 'ok' || !formationsFor(u.type).includes(f) || u.formation === f) return false;
    u.formation = f;
    if (f === 'brace') u.order = { kind: 'hold', face: u.order.kind === 'hold' ? u.order.face : undefined };
    return true;
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
      else if (this.draw) m *= u.state === 'fled' ? 0.8 : 1; // nobody is cut down in a pursuit
      else if (u.state === 'fled') m *= u.side === winnerSide ? 0.85 : 0.5;
      else if (u.side !== winnerSide && this.surrenderAccepted) m *= 0.4; // disarmed and sent away; most go home
      else if (u.side !== winnerSide) m *= retreated ? 0.85 : 0.7;
      u.ref.men = Math.floor(m);
      // Survivors learn their trade: more for those who fought hard and won.
      if (u.ref.men > 0) {
        const fought = u.dealt > 0.5 || u.men < u.startMen;
        const gain = (fought ? 0.5 : 0.15) + Math.min(0.8, u.dealt / Math.max(1, u.startMen))
          + (u.side === winnerSide && !this.draw ? 0.3 : 0);
        u.ref.xp = (u.ref.xp ?? 0) + gain;
      }
    }
  }
}
