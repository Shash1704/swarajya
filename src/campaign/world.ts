import { UNIT_STATS } from '../data';
import { aiMonthly, thinkArmy } from './ai';
import {
  type Army, armyById, armySpeed, AT_TOWN, autoResolve, autoResolveSiege, capture, cleanupArmies, CONTACT_RANGE,
  type CUnit, dist, findRoute, type GameState, garrisonCap, hostile, IND, isMonsoon, liftSiege, log, makePeace,
  maxSupplies, MAX_UNITS, monthOf, netIncome, newUnit, PLAYER, type Province, provinceUnder, RAID_DAYS, raidSpoils,
  retreat, sack, setGoal, startSiege, townAt, unitsStrength,
} from './state';

export type BattleResult = 'att' | 'def' | 'escaped';

/** Moments that need the player. The world clock stops until each one resolves. */
export interface Hooks {
  battle(att: Army, defUnits: CUnit[], defOwner: number, defArmy: Army | null, p: Province, mode: 'field' | 'siege'): Promise<BattleResult>;
  arrival(army: Army, p: Province): Promise<'siege' | 'raid' | 'leave'>;
  chooseSack(p: Province): Promise<boolean>;
  changed(): void;
}

/** Auto-resolves everything: for headless tests. */
export const autoHooks = (s: GameState): Hooks => ({
  battle: async (att, defUnits, _o, _a, p, mode) =>
    (mode === 'siege' ? autoResolveSiege(s, att.units, p) : autoResolve(s, att.units, defUnits)) ? 'att' : 'def',
  arrival: async () => 'siege',
  chooseSack: async (p) => p.wealth >= 8,
  changed: () => {},
});

/** An AI-versus-AI battle being fought out on the map. */
export interface Clash {
  att: number;
  def: number;
  x: number;
  y: number;
  until: number;
}

const STEP = 0.1; // days per simulation step

/**
 * The living campaign: every army marches, fights, besieges and plunders at
 * the same time. The scene calls tick() with elapsed game days.
 */
export class World {
  state: GameState;
  hooks: Hooks;
  clashes: Clash[] = [];
  private pending = 0;
  private replanAt = new Map<number, number>();

  constructor(state: GameState, hooks: Hooks) {
    this.state = state;
    this.hooks = hooks;
  }

  /** True while waiting on the player (a battle, a capture...). */
  get waiting(): boolean {
    return this.pending > 0;
  }

  /** Runs a player-facing interaction; the clock holds until it finishes. */
  private run(task: () => Promise<void>) {
    this.pending++;
    task()
      .catch((e) => console.error(e))
      .finally(() => {
        this.pending--;
        this.hooks.changed();
      });
  }

  private alive(a: Army) {
    return this.state.armies.includes(a);
  }

  tick(days: number) {
    while (days > 1e-9 && !this.waiting && !this.state.over) {
      const dt = Math.min(STEP, days);
      days -= dt;
      this.step(dt);
    }
  }

  private step(dt: number) {
    const s = this.state;
    const before = s.day;
    s.day += dt;
    if (Math.floor(s.day) > Math.floor(before)) this.daily();
    if (Math.floor(s.day / 30) > Math.floor(before / 30)) this.monthly();
    if (this.waiting) return;
    this.resolveClashes();
    for (const a of [...s.armies]) {
      if (this.waiting) return;
      if (!this.alive(a) || a.owner === PLAYER || s.day < a.aiNext || s.day < a.busyUntil) continue;
      thinkArmy(this, a);
    }
    this.move(dt);
    if (!this.waiting) this.detect();
  }

  // ---------------------------------------------------------------- movement

  private move(dt: number) {
    const s = this.state;
    for (const a of [...s.armies]) {
      if (!this.alive(a)) continue;
      if (a.raidUntil > 0) {
        if (s.day >= a.raidUntil) this.finishRaid(a);
        continue;
      }
      if (a.siegeOf >= 0 || s.day < a.busyUntil) continue;
      let target: Army | undefined;
      if (a.goal && (a.goal.kind === 'chase' || a.goal.kind === 'join')) {
        target = armyById(s, a.goal.army);
        if (!target) {
          a.goal = null;
          a.route = [];
        } else if (dist(a, target) < 20) {
          a.route = []; // close enough to make straight for them
        } else if ((this.replanAt.get(a.id) ?? 0) <= s.day) {
          this.replanAt.set(a.id, s.day + 0.5);
          a.route = findRoute(s, a, provinceUnder(s, target, target.node)) ?? [];
        }
      }
      let budget = armySpeed(s, a) * dt;
      while (budget > 1e-6) {
        let tx: number;
        let ty: number;
        if (a.route.length) {
          const p = s.provinces[a.route[0]];
          tx = p.x;
          ty = p.y;
        } else if (target && dist(a, target) < 20) {
          tx = target.x;
          ty = target.y;
        } else break;
        const d = Math.hypot(tx - a.x, ty - a.y);
        if (d <= budget) {
          a.x = tx;
          a.y = ty;
          budget -= d;
          if (a.route.length) a.node = a.route.shift()!;
          else break;
        } else {
          a.x += ((tx - a.x) / d) * budget;
          a.y += ((ty - a.y) / d) * budget;
          budget = 0;
        }
      }
      const g = a.goal;
      if (g && !a.route.length && (g.kind === 'go' || g.kind === 'siege' || g.kind === 'raid')
        && dist(a, s.provinces[g.prov]) <= AT_TOWN) {
        this.arrive(a);
        if (this.waiting) return;
      }
    }
  }

  private arrive(a: Army) {
    const s = this.state;
    const g = a.goal!;
    a.goal = null;
    if (g.kind !== 'go' && g.kind !== 'siege' && g.kind !== 'raid') return;
    const p = s.provinces[g.prov];
    if (!hostile(s, a.owner, p.owner)) return;
    if (g.kind === 'go') {
      if (a.owner !== PLAYER) return;
      this.run(async () => {
        const choice = await this.hooks.arrival(a, p);
        if (!this.alive(a) || !hostile(s, a.owner, p.owner) || townAt(s, a) !== p.id) return;
        if (choice === 'siege') await this.attackTown(a, p);
        else if (choice === 'raid') this.startRaid(a, p);
      });
      return;
    }
    if (g.kind === 'raid') this.startRaid(a, p);
    else if (a.owner === PLAYER || p.owner === PLAYER) this.run(() => this.attackTown(a, p));
    else void this.attackTown(a, p);
  }

  // ---------------------------------------------------------------- orders (player and AI)

  startRaid(a: Army, p: Province) {
    const s = this.state;
    if (!hostile(s, a.owner, p.owner)) return;
    a.goal = null;
    a.route = [];
    a.raidUntil = s.day + RAID_DAYS;
    a.raidProv = p.id;
    log(s, `The ${s.factions[a.owner].short} begin plundering the villages of ${p.name}.`, a.owner === PLAYER || p.owner === PLAYER);
    this.hooks.changed();
  }

  private finishRaid(a: Army) {
    const s = this.state;
    const p = s.provinces[a.raidProv];
    a.raidUntil = 0;
    a.raidProv = -1;
    if (p && hostile(s, a.owner, p.owner)) raidSpoils(s, a, p);
    a.aiNext = s.day;
    this.hooks.changed();
  }

  /** Arriving at an enemy settlement: lay siege to walls, or storm an open town. */
  async attackTown(a: Army, p: Province): Promise<void> {
    const s = this.state;
    if (!hostile(s, a.owner, p.owner)) return;
    if (p.siege && p.siege.army !== a.id) return; // someone else is already besieging it
    if (p.walls > 0 && p.garrison.length) {
      startSiege(s, a, p);
      this.hooks.changed();
      return;
    }
    if (p.garrison.length) {
      const won = a.owner === PLAYER || p.owner === PLAYER
        ? (await this.hooks.battle(a, p.garrison, p.owner, null, p, 'field')) === 'att'
        : autoResolve(s, a.units, p.garrison);
      cleanupArmies(s);
      if (!won) {
        if (this.alive(a)) retreat(s, a);
        this.hooks.changed();
        return;
      }
      if (!this.alive(a)) return;
    }
    await this.take(a.owner, p);
  }

  /** Storm the walls of the settlement this army is besieging. */
  assault(a: Army) {
    const s = this.state;
    const p = s.provinces[a.siegeOf];
    if (!p?.siege || s.day - p.siege.lastAssault < 2) return;
    p.siege.lastAssault = s.day;
    const after = (won: boolean) => {
      if (a.owner !== PLAYER && p.owner !== PLAYER) {
        log(s, won ? `The ${s.factions[a.owner].short} storm ${p.town}.` : `An assault on ${p.town} is thrown back.`);
      }
      cleanupArmies(s);
      if (!this.alive(a)) {
        liftSiege(s, p);
        this.hooks.changed();
        return Promise.resolve();
      }
      this.hooks.changed();
      return won ? this.take(a.owner, p) : Promise.resolve();
    };
    if (a.owner === PLAYER || p.owner === PLAYER) {
      this.run(async () => after((await this.hooks.battle(a, p.garrison, p.owner, null, p, 'siege')) === 'att'));
    } else void after(autoResolveSiege(s, a.units, p));
  }

  async take(owner: number, p: Province): Promise<void> {
    const s = this.state;
    if (p.owner === owner) return;
    if (owner === PLAYER) {
      const sackIt = await this.hooks.chooseSack(p);
      capture(s, p, owner);
      if (sackIt) sack(s, p, owner);
    } else {
      const sackIt = owner !== IND && p.owner === PLAYER && s.rng.chance(0.3);
      capture(s, p, owner);
      if (sackIt) sack(s, p, owner);
      // The victors garrison the place and rest before the next campaign.
      for (const a of s.armies) if (a.owner === owner && dist(a, p) < 12) a.aiNext = s.day + 25 + s.rng.next() * 20;
    }
    this.hooks.changed();
  }

  // ---------------------------------------------------------------- encounters

  private detect() {
    const s = this.state;
    const arr = s.armies;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        const d = dist(a, b);
        if (d > CONTACT_RANGE) continue;
        if (a.owner === b.owner) {
          const joiner = a.goal?.kind === 'join' && a.goal.army === b.id ? a : b.goal?.kind === 'join' && b.goal.army === a.id ? b : null;
          if (joiner) this.merge(joiner, joiner === a ? b : a);
          continue;
        }
        if (!hostile(s, a.owner, b.owner)) continue;
        if (s.day < a.safeUntil || s.day < b.safeUntil || s.day < a.busyUntil || s.day < b.busyUntil) continue;
        const aWants = this.wantsFight(a, b);
        const bWants = this.wantsFight(b, a);
        if (!aWants && !bWants) continue; // they pass each other by
        const [att, def] = aWants && bWants ? this.whoAttacks(a, b) : aWants ? [a, b] : [b, a];
        if (att.owner === PLAYER || def.owner === PLAYER) {
          this.playerClash(att, def);
          return;
        }
        att.busyUntil = def.busyUntil = s.day + 0.6;
        this.clashes.push({ att: att.id, def: def.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, until: s.day + 0.6 });
      }
    }
  }

  /**
   * Does x mean to fight y on meeting? Anyone hunting y does; the player's
   * armies fight only when ordered to; AI armies attack when they like the
   * odds; besiegers hold their siege lines.
   */
  private wantsFight(x: Army, y: Army): boolean {
    if (x.goal?.kind === 'chase' && x.goal.army === y.id) return true;
    if (x.owner === PLAYER || x.siegeOf >= 0 || x.raidUntil > this.state.day) return false;
    return unitsStrength(x.units) >= unitsStrength(y.units) * 0.8;
  }

  private whoAttacks(a: Army, b: Army): [Army, Army] {
    const chasing = (x: Army, y: Army) => x.goal?.kind === 'chase' && x.goal.army === y.id;
    if (chasing(a, b)) return [a, b];
    if (chasing(b, a)) return [b, a];
    if (a.route.length && !b.route.length) return [a, b];
    if (b.route.length && !a.route.length) return [b, a];
    return [a, b];
  }

  private merge(from: Army, into: Army) {
    if (into.units.length + from.units.length > MAX_UNITS) {
      from.goal = null;
      if (from.owner === PLAYER) log(this.state, `Can't merge: an army holds at most ${MAX_UNITS} regiments.`, true);
      return;
    }
    into.units.push(...from.units);
    this.state.armies = this.state.armies.filter((x) => x !== from);
    this.hooks.changed();
  }

  private playerClash(att: Army, def: Army) {
    const s = this.state;
    const p = s.provinces[provinceUnder(s, def, def.node)];
    this.run(async () => {
      const r = await this.hooks.battle(att, def.units, def.owner, def, p, 'field');
      cleanupArmies(s);
      if (r === 'escaped') {
        const [mine, foe] = att.owner === PLAYER ? [att, def] : [def, att];
        if (!this.alive(mine)) return;
        if (mine === att) {
          // We chose not to attack: stop the pursuit and let them be.
          setGoal(s, mine, null);
          mine.safeUntil = s.day + 1;
        } else {
          retreat(s, mine, foe);
          mine.safeUntil = s.day + 3;
        }
        return;
      }
      const [winner, loser] = r === 'att' ? [att, def] : [def, att];
      if (this.alive(loser)) retreat(s, loser, winner);
      if (winner.goal?.kind === 'chase') winner.goal = null;
    });
  }

  private resolveClashes() {
    const s = this.state;
    for (const c of this.clashes.filter((x) => s.day >= x.until)) {
      const att = armyById(s, c.att);
      const def = armyById(s, c.def);
      if (att && def) {
        const won = autoResolve(s, att.units, def.units);
        const f = s.factions;
        log(s, won ? `The ${f[att.owner].short} rout the ${f[def.owner].short} near ${s.provinces[provinceUnder(s, def, def.node)].name}.`
          : `The ${f[def.owner].short} beat off the ${f[att.owner].short} near ${s.provinces[provinceUnder(s, def, def.node)].name}.`);
        cleanupArmies(s);
        const [winner, loser] = won ? [att, def] : [def, att];
        if (this.alive(loser)) retreat(s, loser, winner);
        if (this.alive(winner)) {
          winner.busyUntil = 0;
          if (winner.goal?.kind === 'chase') winner.goal = null;
        }
      }
    }
    this.clashes = this.clashes.filter((x) => s.day < x.until);
  }

  // ---------------------------------------------------------------- the calendar

  private daily() {
    const s = this.state;
    const monsoon = isMonsoon(s.day);
    for (const p of s.provinces) {
      if (p.devastated > 0) p.devastated = Math.max(0, p.devastated - 1);
      if (!p.siege) {
        p.supplies = Math.min(maxSupplies(p), p.supplies + 1);
        continue;
      }
      const besieger = armyById(s, p.siege.army);
      if (!besieger || besieger.siegeOf !== p.id) {
        liftSiege(s, p);
        continue;
      }
      p.siege.work += monsoon ? 0.4 : 1;
      p.supplies -= p.sea ? 0.5 : 1;
      if (p.supplies <= 0) {
        for (const u of p.garrison) u.men = Math.floor(u.men * 0.96);
        p.garrison = p.garrison.filter((u) => u.men >= 5);
        if (p.garrison.length === 0) {
          log(s, `Starving, ${p.town} surrenders to the ${s.factions[besieger.owner].short}.`,
            besieger.owner === PLAYER || p.owner === PLAYER);
          if (besieger.owner === PLAYER) this.run(() => this.take(PLAYER, p));
          else void this.take(besieger.owner, p);
        } else if (Math.floor(s.day) % 5 === 0) {
          log(s, `The garrison of ${p.town} is starving.`, besieger.owner === PLAYER || p.owner === PLAYER);
        }
      }
    }
    for (const a of s.armies) {
      const here = s.provinces[provinceUnder(s, a, a.node)];
      if (townAt(s, a) >= 0 && here.owner === a.owner && !monsoon) {
        for (const u of a.units) {
          const max = UNIT_STATS[u.type].maxMen;
          u.men = Math.min(max, u.men + max * 0.004);
        }
      } else if (monsoon && here.owner !== a.owner) {
        for (const u of a.units) u.men *= 0.9985;
      }
    }
  }

  private monthly() {
    const s = this.state;
    const m = monthOf(s.day);
    for (const f of s.factions) {
      if (!f.alive || f.ai === 'none') continue;
      s.gold[f.id] = Math.max(0, s.gold[f.id] + netIncome(s, f.id));
    }
    for (const p of s.provinces) {
      if (p.siege) continue;
      const f = s.factions[p.owner];
      for (const u of p.garrison) u.men = Math.min(UNIT_STATS[u.type].maxMen, u.men + Math.ceil(UNIT_STATS[u.type].maxMen * 0.1));
      if (p.garrison.length < garrisonCap(p) && m % 2 === 0) {
        p.garrison.push(newUnit(f.garrison[p.garrison.length % f.garrison.length], 0.4));
      }
    }
    for (const f of s.factions) if (f.alive && f.id !== PLAYER) aiMonthly(s, f.id);
    cleanupArmies(s);
    const n = s.factions.length;
    for (let a = 1; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (s.war[a][b] && s.day - s.warSince[a][b] > 360 && s.rng.chance(0.03)) makePeace(s, a, b);
      }
    }
    if (m === 5) log(s, 'The monsoon breaks. Roads turn to mud, siege works stall and powder grows damp.', true);
    if (m === 9) log(s, 'The rains end. The campaigning season begins.', true);
    this.hooks.changed();
  }
}

/** Siege defence strength the AI weighs before storming. */
export function garrisonStrength(p: Province) {
  return unitsStrength(p.garrison) + 10;
}
