import { UNIT_STATS } from '../data';
import { aiMonthly, realmRecruit, thinkArmy } from './ai';
import {
  type Army, armyById, armySpeed, AT_TOWN, autoResolve, autoResolveSiege, capture, cleanupArmies, CONTACT_RANGE,
  type CUnit, dist, findRoute, type GameState, garrisonCap, hostile, IND, isMonsoon, liftSiege, log, makePeace,
  maxSupplies, MAX_UNITS, monthOf, netIncome, newUnit, PLAYER, type Province, provinceUnder, RAID_DAYS, raidSpoils,
  retreat, sack, setGoal, startSiege, townAt, unitsStrength, manpowerRatio, maxManpower, manpowerRegen, drawMen,
  generalK, releaseGeneral, blockaded, capture as captureProv, isYours, yourArmy, spawnArmy, leaveBanner, armySpeed as baseSpeedOf,
  type Village, villageOwner, villageBurnt, maxFood,
} from './state';
import {
  aiSpiesMonthly, battleRenown, captivesMonthly, cessionFor, demandChauth, diplomacyMonthly, fleetsMove, type GameEvent,
  generalFate, grantChauth, landEvent, loyaltyMonthly, navyMonthly, pickEvent, siegeRate, sortiesDaily, supplyDaily, unrestMonthly,
} from './realm';
import { chronicle } from './chronicle';
import { RANK_NAMES, generalRank, unitsMen } from './state';

/** 'parley': the player talked the encounter out (the deal struck already took effect). */
export type BattleResult = 'att' | 'def' | 'escaped' | 'draw' | 'parley';

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
  /** An exhausted AI realm sues the player for peace, offering tribute (and perhaps a province, or -1). */
  peaceOffer(f: number, tribute: number, cede: number): Promise<boolean>;
  /** Something happens in the realm: the player picks one of its choices. */
  event(ev: GameEvent): Promise<number>;
  /** An enemy army before one of the player's towns demands chauth. True = pay. */
  chauthDemand(a: Army, p: Province): Promise<boolean>;
  changed(): void;
}

/** Auto-resolves everything: for headless tests. */
export const autoHooks = (s: GameState): Hooks => ({
  battle: async (b) =>
    (b.mode === 'siege' ? autoResolveSiege(s, b.attUnits, b.p, b.defUnits, generalK(b.att, true)) : autoResolve(s, b.attUnits, b.defUnits, generalK(b.att), generalK(b.def))) ? 'att' : 'def',
  arrival: async () => 'siege',
  chooseSack: async (p) => p.wealth >= 8,
  peaceOffer: async () => true,
  event: async () => 0,
  chauthDemand: async () => false,
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
/** A battle lost within this distance of one of your forts empties it. */
export const ABANDON_RANGE = 25;

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

  /**
   * If your army is destroyed you live on: you slip away and gather a handful of men at the
   * nearest town of the realm, as a nobody does.
   */
  private ensureYourArmy() {
    const s = this.state;
    if (yourArmy(s) || !s.factions[PLAYER].alive) return;
    // The capital if it stands, else any town of the realm not under siege.
    const town = s.provinces.filter((p) => p.owner === PLAYER && !p.siege).sort((p, q) => (q.capitalOf === PLAYER ? 1 : 0) - (p.capitalOf === PLAYER ? 1 : 0))[0];
    if (!town) return;
    const a = spawnArmy(s, PLAYER, town.id, [newUnit('mavala', 0.5), newUnit('mavala', 0.4)], s.player.gen);
    a.safeUntil = s.day + 5;
    s.player.armyId = a.id;
    log(s, `You escape the rout and gather a few men at ${town.town}. The road back begins again.`, true);
    chronicle(s, 'escape', `Your army was destroyed. You escaped with your life and gathered a few men at ${town.town} to begin again.`);
    this.hooks.changed();
  }

  /** Puts an event in front of the player; the clock holds until they choose. */
  private ask(ev: GameEvent) {
    this.run(async () => {
      const c = await this.hooks.event(ev);
      ev.apply(c);
      chronicle(this.state, 'event', `${ev.title}: ${ev.choices[c] ?? ''}.`);
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
      if (!this.alive(a) || isYours(s, a) || a.follows !== undefined || s.day < a.aiNext || s.day < a.busyUntil) continue;
      thinkArmy(this, a);
    }
    this.ensureYourArmy();
    this.move(dt);
    fleetsMove(s, dt);
    if (!this.waiting) this.detect();
  }

  // ---------------------------------------------------------------- movement

  private move(dt: number) {
    const s = this.state;
    for (const a of [...s.armies]) {
      if (!this.alive(a)) continue;
      // Under another's banner: march with the leader (catching up first), until the time is up.
      if (a.follows !== undefined) {
        const lead = armyById(s, a.follows);
        if (!lead || lead.owner !== a.owner || s.day >= (a.followUntil ?? 0)) {
          if (lead && isYours(s, lead)) log(s, `${a.general.name} takes his men back to their own war.`, true);
          leaveBanner(s, a);
        } else {
          const d = dist(a, lead);
          const step = baseSpeedOf(s, a) * dt * 1.5;
          if (d <= Math.max(step, 1)) {
            a.x = lead.x;
            a.y = lead.y;
            a.node = lead.node;
          } else {
            a.x += ((lead.x - a.x) / d) * step;
            a.y += ((lead.y - a.y) / d) * step;
            a.node = provinceUnder(s, a, a.node);
          }
          continue;
        }
      }
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
          a.route = findRoute(s, a, target) ?? [];
        }
      }
      let budget = armySpeed(s, a) * dt;
      while (budget > 1e-6) {
        let tx: number;
        let ty: number;
        if (a.route.length) {
          tx = a.route[0].x;
          ty = a.route[0].y;
        } else if (target && dist(a, target) < 20) {
          tx = target.x;
          ty = target.y;
        } else break;
        const d = Math.hypot(tx - a.x, ty - a.y);
        if (d <= budget) {
          a.x = tx;
          a.y = ty;
          budget -= d;
          if (a.route.length) a.route.shift();
          else break;
        } else {
          a.x += ((tx - a.x) / d) * budget;
          a.y += ((ty - a.y) / d) * budget;
          budget = 0;
        }
      }
      a.node = provinceUnder(s, a, a.node);
      const g = a.goal;
      if (g?.kind === 'point' && !a.route.length) a.goal = null;
      if (g?.kind === 'sack' && !a.route.length) {
        const v = s.villages[g.village];
        a.goal = null;
        if (v && dist(a, v) <= 4) this.sackVillage(a, v);
      }
      if (g && !a.route.length && (g.kind === 'go' || g.kind === 'siege' || g.kind === 'raid')) {
        const p = s.provinces[g.prov];
        if (dist(a, p) <= AT_TOWN) {
          // Standing at the town: it's the army's own province now (for townAt).
          a.node = p.id;
          this.arrive(a);
          if (this.waiting) return;
        } else setGoal(s, a, g); // knocked off its march (a battle): head on again
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
      if (!isYours(s, a)) return;
      this.run(async () => {
        const choice = await this.hooks.arrival(a, p);
        if (!this.alive(a) || !hostile(s, a.owner, p.owner) || townAt(s, a) !== p.id) return;
        if (choice === 'siege') await this.attackTown(a, p);
        else if (choice === 'raid') this.startRaid(a, p);
      });
      return;
    }
    if (g.kind === 'raid') {
      // Before burning the villages, an AI raider may offer to spare them for chauth.
      if (a.owner !== PLAYER && p.owner === PLAYER && s.rng.chance(0.35)) {
        this.run(async () => {
          if (!this.alive(a) || !hostile(s, a.owner, p.owner)) return;
          if (await this.hooks.chauthDemand(a, p)) grantChauth(s, a, p);
          else this.startRaid(a, p);
        });
        return;
      }
      if (!isYours(s, a) && p.owner !== IND && s.rng.chance(0.3) && demandChauth(s, a, p)[0]) return;
      this.startRaid(a, p);
    } else if (isYours(s, a) || p.owner === PLAYER) this.run(() => this.attackTown(a, p));
    else void this.attackTown(a, p);
  }

  // ---------------------------------------------------------------- orders (player and AI)

  startRaid(a: Army, p: Province) {
    const s = this.state;
    if (!hostile(s, a.owner, p.owner)) return;
    a.goal = null;
    a.route = [];
    a.raidUntil = s.day + RAID_DAYS * (a.general.trait === 'raider' ? 0.65 : 1);
    a.raidProv = p.id;
    log(s, `The ${s.factions[a.owner].short} begin plundering the villages of ${p.name}.`, a.owner === PLAYER || p.owner === PLAYER);
    this.hooks.changed();
  }

  /**
   * Sack a village: a day of plunder, and word of it spreads. The owner's armies nearby, and any
   * Mughal army within reach that is at war with the raiders, ride out to catch them.
   */
  sackVillage(a: Army, v: Village) {
    const s = this.state;
    const owner = villageOwner(s, v);
    if (villageBurnt(s, v) || !hostile(s, a.owner, owner)) return;
    a.goal = null;
    a.route = [];
    a.raidUntil = s.day + 1;
    a.raidProv = -1 - v.id; // negative: a village, not a whole province
    const f = s.factions;
    log(s, `The ${f[a.owner].short} fall on the village of ${v.name} in ${s.provinces[v.prov].name}.`, isYours(s, a) || owner === PLAYER);
    const mug = f.findIndex((x) => x.key === 'mug');
    const hunters = s.armies.filter((o) => o !== a && !isYours(s, o) && o.follows === undefined && o.siegeOf < 0 && s.day >= o.busyUntil
      && hostile(s, o.owner, a.owner) && o.owner !== IND
      && ((o.owner === owner || s.ally[o.owner][owner]) && dist(o, v) < 260 || (o.owner === mug && dist(o, v) < 340)));
    for (const o of hunters) {
      setGoal(s, o, { kind: 'chase', army: a.id });
      o.aiNext = s.day + 8; // they stay on the trail a while
    }
    if (hunters.length) {
      const who = [...new Set(hunters.map((o) => f[o.owner].short))].join(' and the ');
      log(s, `Word of the raid on ${v.name} spreads: the ${who} ride out after the raiders (${hunters.map((o) => o.general.name).join(', ')}).`, isYours(s, a) || owner === PLAYER);
    }
    this.hooks.changed();
  }

  private finishRaid(a: Army) {
    const s = this.state;
    if (a.raidProv < 0) {
      // A village sacked: gold, food, and a burnt village that will take months to recover.
      const v = s.villages[-1 - a.raidProv];
      a.raidUntil = 0;
      a.raidProv = -1;
      a.aiNext = s.day;
      if (!v || !hostile(s, a.owner, villageOwner(s, v))) return;
      const gold = Math.round(v.wealth * (a.general.trait === 'raider' ? 1.5 : 1));
      s.gold[a.owner] += gold;
      a.food = Math.min(maxFood(a), a.food + 8);
      v.burnedUntil = s.day + 150;
      const p = s.provinces[v.prov];
      p.unrest = Math.min(100, p.unrest + 4);
      log(s, `${v.name} is sacked and burnt: the ${s.factions[a.owner].short} carry off ${gold} gold.`, isYours(s, a) || p.owner === PLAYER);
      if (isYours(s, a)) chronicle(s, 'raid', `You sacked the village of ${v.name} in ${p.name} (${s.factions[p.owner].short}) and carried off ${gold} gold and a week's food.`);
      this.hooks.changed();
      return;
    }
    const p = s.provinces[a.raidProv];
    a.raidUntil = 0;
    a.raidProv = -1;
    if (p && hostile(s, a.owner, p.owner)) {
      const before = s.gold[a.owner];
      raidSpoils(s, a, p);
      if (a.general.trait === 'raider') s.gold[a.owner] += Math.round((s.gold[a.owner] - before) * 0.5);
      if (isYours(s, a)) chronicle(s, 'raid', `You plundered the villages of ${p.name}, a province of the ${s.factions[p.owner].short}, and carried off ${s.gold[a.owner] - before} gold.`);
      // Burning villages that pay you chauth ends the arrangement.
      if (p.tribute?.to === a.owner) {
        p.tribute = null;
        log(s, `${p.name} stops paying chauth after being plundered.`, a.owner === PLAYER || p.owner === PLAYER);
      }
    }
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
      if (isYours(s, a)) chronicle(s, 'siege', `You laid siege to ${p.town} (${p.name}), held by the ${s.factions[p.owner].short} with ${Math.round(unitsMen(p.garrison))} men.`);
      this.hooks.changed();
      return;
    }
    const b = this.townBattle('field', a, p);
    if (b.defUnits.length) {
      const r = this.involvesPlayer(b) ? await this.hooks.battle(b) : null;
      if (r === 'draw' || r === 'escaped' || r === 'parley') {
        cleanupArmies(s);
        if (this.alive(a)) a.safeUntil = s.day + 1;
        this.hooks.changed();
        return;
      }
      const won = r ? r === 'att' : autoResolve(s, b.attUnits, b.defUnits, generalK(a));
      cleanupArmies(s);
      this.settle(b, won);
      if (!won || !this.alive(a)) {
        this.hooks.changed();
        return;
      }
    }
    await this.take(a.owner, p, isYours(s, a));
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
      return won ? this.take(a.owner, p, isYours(s, a)) : Promise.resolve();
    };
    if (this.involvesPlayer(b)) this.run(async () => after((await this.hooks.battle(b)) === 'att'));
    else void after(autoResolveSiege(s, b.attUnits, p, b.defUnits, generalK(a, true)));
  }

  // ---------------------------------------------------------------- who fights

  /** Armies of `lead`'s side close enough to join a battle at `at` against `foe`. */
  private reinforcements(lead: Army, foe: number, at: { x: number; y: number }, taken: Set<Army>): Army[] {
    const s = this.state;
    return s.armies.filter((x) => !taken.has(x)
      && (x.owner === lead.owner || s.ally[x.owner][lead.owner])
      // The player's armies only join battles the player is already in.
      // Your own army joins only battles you are already in (or one your host is in).
      && (!isYours(s, x) || isYours(s, lead) || lead.follows === x.id)
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
    // Only battles your own army fights in stop the clock; the Raje's other commanders fight their own.
    return [...b.attArmies, ...b.defArmies].some((x) => isYours(this.state, x));
  }

  /** After the fighting: the beaten side falls back, the victors stop chasing. */
  private settle(b: BattleInfo, attWon: boolean) {
    const s = this.state;
    const [winners, losers] = attWon ? [b.attArmies, b.defArmies] : [b.defArmies, b.attArmies];
    const threat = winners.find((x) => this.alive(x)) ?? (attWon ? b.att : b.p);
    const rankBefore = generalRank(s.player.gen);
    battleRenown(s, winners.filter((x) => this.alive(x)), losers.filter((x) => this.alive(x)));
    if (generalRank(s.player.gen) > rankBefore) chronicle(s, 'rank', `Your name grew with your victories: men now call you a ${RANK_NAMES[generalRank(s.player.gen)].toLowerCase()}.`);
    if (b.mode === 'field') this.abandonForts(b, attWon);
    const captor = attWon ? b.att.owner : b.defOwner;
    // Auto-resolved defeats: the commander may fall. (Fought battles decide that on the field.)
    if (!this.involvesPlayer(b)) for (const x of losers) if (this.alive(x)) generalFate(s, x, captor, 0.12);
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

  /**
   * A beaten army near one of its own forts takes the garrison with it as it flees: the fort is
   * left standing empty, and the victors can walk in before a new garrison is found.
   */
  private abandonForts(b: BattleInfo, attWon: boolean) {
    const s = this.state;
    const lead = attWon ? b.def : b.att;
    const loser = attWon ? b.defOwner : b.att.owner;
    const winner = attWon ? b.att.owner : b.defOwner;
    if (!lead || loser === IND) return;
    const flee = (attWon ? b.defArmies : b.attArmies).find((x) => this.alive(x));
    // Only the nearest fort to the battlefield; a royal capital's household guard never abandons it.
    const p = s.provinces
      .filter((q) => q.walls > 0 && !q.siege && q.garrison.length && q.capitalOf < 0 && dist(lead, q) <= ABANDON_RANGE
        && (q.owner === loser || s.ally[q.owner][loser]) && hostile(s, winner, q.owner))
      .sort((x, y) => dist(lead, x) - dist(lead, y))[0];
    // Great forts (hill forts, sea forts) hold even so; lesser walls are often given up.
    if (p && !s.rng.chance([1, 1, 0.6, 0][p.walls] ?? 0)) return;
    if (p) {
      // The garrison marches out with the beaten army (as many as it can take); the rest scatter.
      if (flee) {
        for (const u of p.garrison) if (flee.units.length < MAX_UNITS) flee.units.push(u);
      }
      p.garrison = [];
      p.unguardedUntil = s.day + 20;
      log(s, `Seeing the battle lost, the garrison of ${p.town} abandons the fort. ${p.town} stands empty!`,
        p.owner === PLAYER || winner === PLAYER);
      // AI victors make straight for the empty fort.
      const taker = (attWon ? b.attArmies : b.defArmies).find((x) => this.alive(x) && !isYours(s, x) && x.owner === winner);
      if (taker && taker.siegeOf < 0) {
        setGoal(s, taker, { kind: 'siege', prov: p.id });
        taker.aiNext = s.day + 3;
      }
    }
  }

  /** `you`: your own army took it (you choose whether to sack). */
  async take(owner: number, p: Province, you = false): Promise<void> {
    const s = this.state;
    if (p.owner === owner) return;
    if (owner === PLAYER && you) {
      const sackIt = await this.hooks.chooseSack(p);
      const from = s.factions[p.owner].short;
      capture(s, p, owner);
      const loot = sackIt ? sack(s, p, owner) : 0;
      chronicle(s, 'conquest', `You took ${p.town} (${p.name}) from the ${from} for Swarajya${sackIt ? `, and sacked it for ${loot} gold` : ''}.`);
    } else {
      const sackIt = owner !== IND && owner !== PLAYER && p.owner === PLAYER && s.rng.chance(0.3);
      capture(s, p, owner);
      if (sackIt) sack(s, p, owner);
      // The victors garrison the place and rest before the next campaign.
      for (const a of s.armies) if (a.owner === owner && dist(a, p) < 12) a.aiNext = s.day + 8 + s.rng.next() * 8;
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
    if (isYours(this.state, x) || x.follows !== undefined || x.siegeOf >= 0 || x.raidUntil > this.state.day) return false;
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
    releaseGeneral(this.state, from);
    this.hooks.changed();
  }

  private playerClash(b: BattleInfo) {
    const s = this.state;
    this.run(async () => {
      const r = await this.hooks.battle(b);
      cleanupArmies(s);
      if (r === 'parley') {
        for (const x of [...b.attArmies, ...b.defArmies]) if (this.alive(x)) x.busyUntil = 0;
        return;
      }
      if (r === 'draw') {
        for (const x of [...b.attArmies, ...b.defArmies]) {
          if (!this.alive(x)) continue;
          x.busyUntil = 0;
          x.safeUntil = s.day + 1.5;
          if (x.goal?.kind === 'chase') x.goal = null;
        }
        return;
      }
      if (r === 'escaped') {
        const playerAttacked = b.attArmies.some((x) => isYours(s, x));
        const mine = [...b.attArmies, ...b.defArmies].filter((x) => isYours(s, x) && this.alive(x));
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
      const won = autoResolve(s, b.attUnits, b.defUnits, generalK(b.att), generalK(b.def));
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
      p.siege.work += (monsoon ? 0.4 : 1) * siegeRate(besieger);
      // Sea forts are fed by boat, unless a hostile squadron closes the sea.
      p.supplies -= p.sea && !blockaded(s, p) ? 0.5 : 1;
      // A realm with no men left to send has no relief coming: its garrisons lose heart.
      const ex = manpowerRatio(s, p.owner);
      const despair = (ex < 0.35 ? (0.35 - ex) * 0.05 : 0) + (p.supplies <= 5 ? 0.01 : 0);
      if (p.owner !== IND && s.rng.chance(despair)) {
        log(s, `Seeing no relief coming, the garrison of ${p.town} opens its gates to the ${s.factions[besieger.owner].short}.`,
          besieger.owner === PLAYER || p.owner === PLAYER);
        if (isYours(s, besieger)) this.run(() => this.take(PLAYER, p, true));
        else void this.take(besieger.owner, p);
        continue;
      }
      if (p.supplies <= 0) {
        for (const u of p.garrison) u.men = Math.floor(u.men * 0.96);
        p.garrison = p.garrison.filter((u) => u.men >= 5);
        if (p.garrison.length === 0) {
          log(s, `Starving, ${p.town} surrenders to the ${s.factions[besieger.owner].short}.`,
            besieger.owner === PLAYER || p.owner === PLAYER);
          if (isYours(s, besieger)) this.run(() => this.take(PLAYER, p, true));
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
        // Hill forts are recruiting grounds: ranks fill twice as fast there.
        const k = here.kind === 'fort' ? 2 : 1;
        for (const u of a.units) {
          const max = UNIT_STATS[u.type].maxMen;
          const add = drawMen(s, a.owner, Math.min(max * 0.004 * k, max - u.men));
          // Raw recruits dilute a veteran regiment's experience.
          if (add > 0 && u.xp) u.xp *= u.men / (u.men + add);
          u.men += add;
        }
      } else if (monsoon && here.owner !== a.owner) {
        for (const u of a.units) u.men *= 0.9985;
      }
    }
    supplyDaily(s);
    sortiesDaily(s);
    cleanupArmies(s);
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
      if (p.siege || p.unguardedUntil > s.day) continue;
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
    if (s.factions[PLAYER].alive) realmRecruit(s);
    unrestMonthly(s);
    captivesMonthly(s);
    diplomacyMonthly(s);
    navyMonthly(s);
    aiSpiesMonthly(s);
    for (const p of s.provinces) if (p.tribute && p.tribute.until < s.day) {
      log(s, `${p.name}'s year of chauth to the ${s.factions[p.tribute.to].short} has run out.`, p.tribute.to === PLAYER || p.owner === PLAYER);
      p.tribute = null;
    }
    // The player's commanders and the events of the age.
    for (const r of loyaltyMonthly(s)) this.ask(landEvent(s, r));
    const ev = pickEvent(s);
    if (ev) this.ask(ev);
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
      // Bled white, they offer land as well.
      const cede = manpowerRatio(s, f.id) < 0.15 ? cessionFor(s, f.id)?.id ?? -1 : -1;
      this.run(async () => {
        if (!s.war[PLAYER][f.id]) return;
        if (await this.hooks.peaceOffer(f.id, tribute, cede)) {
          const paid = Math.min(tribute, s.gold[f.id]);
          s.gold[f.id] -= paid;
          s.gold[PLAYER] += paid;
          makePeace(s, PLAYER, f.id);
          if (cede >= 0 && s.provinces[cede].owner === f.id) captureProv(s, s.provinces[cede], PLAYER);
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
