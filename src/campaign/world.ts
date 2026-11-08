import { UNIT_STATS } from '../data';
import { aiMonthly, thinkArmy } from './ai';
import {
  type Army, armyById, armySpeed, AT_TOWN, autoResolve, autoResolveSiege, capture, cleanupArmies, CONTACT_RANGE,
  type CUnit, dist, findRoute, type GameState, garrisonCap, hostile, IND, isMonsoon, liftSiege, log, makePeace,
  maxSupplies, MAX_UNITS, monthOf, netIncome, newUnit, PLAYER, type Province, provinceUnder, RAID_DAYS, raidSpoils,
  retreat, sack, setGoal, startSiege, townAt, unitsStrength, manpowerRatio, maxManpower, manpowerRegen, drawMen,
} from './state';

export type BattleResult = 'att' | 'def' | 'escaped';

/** Everyone fighting in one battle: the lead armies, any reinforcements nearby, and a garrison. */
export interface BattleInfo {
  mode: 'field' | 'siege';
  /** The army that started it, and the one it fell upon (null when attacking a town). */
  att: Army;
  def: Army | null;
  attArmies: Army[];
  defArmies: Army[];
  attUnits: CUnit[];
  defUnits: CUnit[];
  defOwner: number;
  /** The town fought over, or the province the battle happens in. */
  p: Province;
  /** The town's garrison fights on the defending side. */
  garrison: boolean;
}

/** Moments that need the player. The world clock stops until each one resolves. */
export interface Hooks {
  battle(b: BattleInfo): Promise<BattleResult>;
  arrival(army: Army, p: Province): Promise<'siege' | 'raid' | 'leave'>;
  chooseSack(p: Province): Promise<boolean>;
  /** An exhausted AI realm sues the player for peace, offering tribute. */
  peaceOffer(f: number, tribute: number): Promise<boolean>;
  changed(): void;
}

/** Auto-resolves everything: for headless tests. */
export const autoHooks = (s: GameState): Hooks => ({
  battle: async (b) =>
    (b.mode === 'siege' ? autoResolveSiege(s, b.attUnits, b.p, b.defUnits) : autoResolve(s, b.attUnits, b.defUnits)) ? 'att' : 'def',
  arrival: async () => 'siege',
  chooseSack: async (p) => p.wealth >= 8,
  peaceOffer: async () => true,
  changed: () => {},
});

/** An AI-versus-AI battle being fought out on the map. */
export interface Clash {
  att: number[];
  def: number[];
  /** Province whose garrison fights for the defenders, or -1. */
  garrison: number;
  x: number;
  y: number;
  until: number;
}

/** Armies within this distance of a battle march to the sound of the guns. */
export const REINFORCE_RANGE = 60;

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
  private lastOffer = new Map<number, number>();
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
    const b = this.townBattle('field', a, p);
    if (b.defUnits.length) {
      const won = this.involvesPlayer(b)
        ? (await this.hooks.battle(b)) === 'att'
        : autoResolve(s, b.attUnits, b.defUnits);
      cleanupArmies(s);
      this.settle(b, won);
      if (!won || !this.alive(a)) {
        this.hooks.changed();
        return;
      }
    }
    await this.take(a.owner, p);
  }

  /** Storm the walls of the settlement this army is besieging. */
  assault(a: Army) {
    const s = this.state;
    const p = s.provinces[a.siegeOf];
    if (!p?.siege || s.day - p.siege.lastAssault < 2) return;
    p.siege.lastAssault = s.day;
    const b = this.townBattle('siege', a, p);
    const after = (won: boolean) => {
      if (!this.involvesPlayer(b)) {
        log(s, won ? `The ${s.factions[a.owner].short} storm ${p.town}.` : `An assault on ${p.town} is thrown back.`);
      }
      cleanupArmies(s);
      this.settle(b, won);
      if (!this.alive(a)) {
        liftSiege(s, p);
        this.hooks.changed();
        return Promise.resolve();
      }
      this.hooks.changed();
      return won ? this.take(a.owner, p) : Promise.resolve();
    };
    if (this.involvesPlayer(b)) this.run(async () => after((await this.hooks.battle(b)) === 'att'));
    else void after(autoResolveSiege(s, b.attUnits, p, b.defUnits));
  }

  // ---------------------------------------------------------------- who fights

  /** Armies of `lead`'s side close enough to join a battle at `at` against `foe`. */
  private reinforcements(lead: Army, foe: number, at: { x: number; y: number }, taken: Set<Army>): Army[] {
    const s = this.state;
    return s.armies.filter((x) => !taken.has(x)
      && (x.owner === lead.owner || s.ally[x.owner][lead.owner])
      // The player's armies only join battles the player is already in.
      && (x.owner !== PLAYER || lead.owner === PLAYER)
      && hostile(s, x.owner, foe)
      && dist(x, at) < REINFORCE_RANGE
      && s.day >= x.busyUntil && x.raidUntil <= s.day
      && (x.siegeOf < 0 || dist(x, s.provinces[x.siegeOf]) < REINFORCE_RANGE));
  }

  /** A field battle between two armies, with everyone nearby piling in. */
  private fieldBattle(att: Army, def: Army): BattleInfo {
    const s = this.state;
    const at = { x: (att.x + def.x) / 2, y: (att.y + def.y) / 2 };
    const taken = new Set([att, def]);
    const attArmies = [att, ...this.reinforcements(att, def.owner, at, taken)];
    attArmies.forEach((x) => taken.add(x));
    const defArmies = [def, ...this.reinforcements(def, att.owner, at, taken)];
    // An army caught at its own town fights with the garrison beside it.
    const town = townAt(s, def);
    const tp = town >= 0 ? s.provinces[town] : null;
    const garrison = !!tp && (tp.owner === def.owner || s.ally[tp.owner][def.owner]) && !tp.siege && tp.garrison.length > 0;
    return {
      mode: 'field', att, def, attArmies, defArmies,
      attUnits: attArmies.flatMap((x) => x.units),
      defUnits: [...defArmies.flatMap((x) => x.units), ...(garrison ? tp!.garrison : [])],
      defOwner: def.owner, p: tp ?? s.provinces[provinceUnder(s, def, def.node)], garrison,
    };
  }

  /** An attack on a town: the garrison plus any of the owner's armies standing in it. */
  private townBattle(mode: 'field' | 'siege', a: Army, p: Province): BattleInfo {
    const s = this.state;
    const defArmies = s.armies.filter((x) => (x.owner === p.owner || s.ally[x.owner][p.owner]) && townAt(s, x) === p.id
      && s.day >= x.busyUntil);
    const taken = new Set([a, ...defArmies]);
    const attArmies = [a, ...this.reinforcements(a, p.owner, p, taken)];
    return {
      mode, att: a, def: null, attArmies, defArmies,
      attUnits: attArmies.flatMap((x) => x.units),
      defUnits: [...p.garrison, ...defArmies.flatMap((x) => x.units)],
      defOwner: p.owner, p, garrison: true,
    };
  }

  private involvesPlayer(b: BattleInfo): boolean {
    return [...b.attArmies, ...b.defArmies].some((x) => x.owner === PLAYER) || (b.garrison && b.p.owner === PLAYER);
  }

  /** After the fighting: the beaten side falls back, the victors stop chasing. */
  private settle(b: BattleInfo, attWon: boolean) {
    const s = this.state;
    const [winners, losers] = attWon ? [b.attArmies, b.defArmies] : [b.defArmies, b.attArmies];
    const threat = winners.find((x) => this.alive(x)) ?? (attWon ? b.att : b.p);
    for (const x of losers) {
      // A failed assault leaves the besiegers in their lines; any other defeat sends an army packing.
      if (!this.alive(x) || (b.mode === 'siege' && x.siegeOf === b.p.id)) continue;
      retreat(s, x, threat);
    }
    for (const x of winners) {
      if (!this.alive(x)) continue;
      x.busyUntil = 0;
      if (x.goal?.kind === 'chase') x.goal = null;
    }
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
        const battle = this.fieldBattle(att, def);
        if (this.involvesPlayer(battle)) {
          this.playerClash(battle);
          return;
        }
        // Bigger battles take longer to fight out.
        const until = s.day + 0.5 + 0.05 * (battle.attArmies.length + battle.defArmies.length);
        for (const x of [...battle.attArmies, ...battle.defArmies]) x.busyUntil = until;
        this.clashes.push({
          att: battle.attArmies.map((x) => x.id), def: battle.defArmies.map((x) => x.id),
          garrison: battle.garrison ? battle.p.id : -1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, until,
        });
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

  private playerClash(b: BattleInfo) {
    const s = this.state;
    this.run(async () => {
      const r = await this.hooks.battle(b);
      cleanupArmies(s);
      if (r === 'escaped') {
        const playerAttacked = b.attArmies.some((x) => x.owner === PLAYER);
        const mine = [...b.attArmies, ...b.defArmies].filter((x) => x.owner === PLAYER && this.alive(x));
        const foe = playerAttacked ? (b.def ?? b.p) : b.att;
        for (const x of mine) {
          if (playerAttacked) {
            // We chose not to attack: stop the pursuit and let them be.
            setGoal(s, x, null);
            x.safeUntil = s.day + 1;
          } else {
            retreat(s, x, foe);
            x.safeUntil = s.day + 3;
          }
        }
        return;
      }
      this.settle(b, r === 'att');
    });
  }

  private resolveClashes() {
    const s = this.state;
    for (const c of this.clashes.filter((x) => s.day >= x.until)) {
      const attArmies = c.att.map((id) => armyById(s, id)).filter((x): x is Army => !!x);
      const defArmies = c.def.map((id) => armyById(s, id)).filter((x): x is Army => !!x);
      if (!attArmies.length || !defArmies.length) continue;
      const tp = c.garrison >= 0 ? s.provinces[c.garrison] : null;
      const b: BattleInfo = {
        mode: 'field', att: attArmies[0], def: defArmies[0], attArmies, defArmies,
        attUnits: attArmies.flatMap((x) => x.units),
        defUnits: [...defArmies.flatMap((x) => x.units), ...(tp && tp.owner === defArmies[0].owner ? tp.garrison : [])],
        defOwner: defArmies[0].owner, p: tp ?? s.provinces[provinceUnder(s, defArmies[0], defArmies[0].node)], garrison: !!tp,
      };
      const won = autoResolve(s, b.attUnits, b.defUnits);
      const f = s.factions;
      const size = attArmies.length + defArmies.length > 2 ? 'great battle' : 'battle';
      log(s, won ? `The ${f[b.att.owner].short} rout the ${f[b.defOwner].short} in a ${size} near ${b.p.name}.`
        : `The ${f[b.defOwner].short} beat off the ${f[b.att.owner].short} in a ${size} near ${b.p.name}.`);
      cleanupArmies(s);
      this.settle(b, won);
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
      // A realm with no men left to send has no relief coming: its garrisons lose heart.
      const ex = manpowerRatio(s, p.owner);
      const despair = (ex < 0.35 ? (0.35 - ex) * 0.05 : 0) + (p.supplies <= 5 ? 0.01 : 0);
      if (p.owner !== IND && s.rng.chance(despair)) {
        log(s, `Seeing no relief coming, the garrison of ${p.town} opens its gates to the ${s.factions[besieger.owner].short}.`,
          besieger.owner === PLAYER || p.owner === PLAYER);
        if (besieger.owner === PLAYER) this.run(() => this.take(PLAYER, p));
        else void this.take(besieger.owner, p);
        continue;
      }
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
        // Resting armies fill their ranks from the realm's pool of fighting men.
        for (const u of a.units) {
          const max = UNIT_STATS[u.type].maxMen;
          u.men += drawMen(s, a.owner, Math.min(max * 0.004, max - u.men));
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
      if (!f.alive) continue;
      s.manpower[f.id] = Math.min(maxManpower(s, f.id), s.manpower[f.id] + manpowerRegen(s, f.id));
      if (f.ai === 'none') continue;
      s.gold[f.id] = Math.max(0, s.gold[f.id] + netIncome(s, f.id));
    }
    for (const p of s.provinces) {
      if (p.siege) continue;
      const f = s.factions[p.owner];
      for (const u of p.garrison) {
        const max = UNIT_STATS[u.type].maxMen;
        u.men += drawMen(s, p.owner, Math.min(Math.ceil(max * 0.1), max - u.men));
      }
      if (p.garrison.length < garrisonCap(p) && m % 2 === 0) {
        const type = f.garrison[p.garrison.length % f.garrison.length];
        const men = drawMen(s, p.owner, Math.round(UNIT_STATS[type].maxMen * 0.4));
        if (men >= 5) p.garrison.push({ type, men });
      }
    }
    for (const f of s.factions) if (f.alive && f.id !== PLAYER) aiMonthly(s, f.id);
    cleanupArmies(s);
    const n = s.factions.length;
    for (let a = 1; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (!s.war[a][b]) continue;
        const exhausted = Math.min(manpowerRatio(s, a), manpowerRatio(s, b)) < 0.25;
        if ((exhausted && s.rng.chance(0.25)) || (s.day - s.warSince[a][b] > 360 && s.rng.chance(0.03))) makePeace(s, a, b);
      }
    }
    // Exhausted enemies of the player sue for peace and offer tribute.
    for (const f of s.factions) {
      if (!f.alive || f.id === PLAYER || f.id === IND || !s.war[PLAYER][f.id]) continue;
      if (manpowerRatio(s, f.id) >= 0.25 || s.day - s.warSince[PLAYER][f.id] < 180) continue;
      if (s.day - (this.lastOffer.get(f.id) ?? -999) < 90 || !s.rng.chance(0.4)) continue;
      this.lastOffer.set(f.id, s.day);
      const tribute = Math.round(s.gold[f.id] * 0.3 + 40);
      this.run(async () => {
        if (!s.war[PLAYER][f.id]) return;
        if (await this.hooks.peaceOffer(f.id, tribute)) {
          const paid = Math.min(tribute, s.gold[f.id]);
          s.gold[f.id] -= paid;
          s.gold[PLAYER] += paid;
          makePeace(s, PLAYER, f.id);
          log(s, `The ${f.name} pays ${paid} gold in tribute.`, true);
        } else log(s, `You send the ${f.name}'s envoys away. The war goes on.`, true);
      });
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
