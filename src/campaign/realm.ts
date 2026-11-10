import { UNIT_STATS } from '../data';
import type { LeaderMods } from '../battle/battle';
import { chronicle } from './chronicle';
import {
  type Army, armyById, armyStrength, capture, courtFaith, declareWar, dist, faithGap, factionStrength, type Fleet,
  type GameState, type General, generalRank, hostile, IND, isCoastal, isMonsoon, keyFort, log, makePeace, manpowerRatio,
  maxFood, newUnit, PLAYER, type Province, isYours, provinceIncome, provinceUnder, provincesOf, releaseGeneral, seaOf,
  siegeEquipment, townAt, unitsMen, unitsStrength, wallFactor, makeGeneral, maxManpower, monthOf, yearOf,
  spawnArmy, netIncome, setGoal, RANK_NAMES, TRAITS,
} from './state';

/**
 * The life of the realm beyond the battlefield: supply and hunger, unrest and
 * revolt, chauth, commanders and their loyalty, diplomacy, fleets, spies and
 * the events of the age.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mine = (s: GameState, ...owners: number[]) => owners.includes(PLAYER);

// ---------------------------------------------------------------- intelligence

/** Are this army's exact numbers known to the player? */
export function intelOn(s: GameState, a: Army): boolean {
  if (a.owner === PLAYER || s.day < a.scoutedUntil) return true;
  if (s.armies.some((x) => x.owner === PLAYER && dist(x, a) < 90)) return true;
  return s.provinces.some((p) => p.owner === PLAYER && dist(p, a) < 60);
}

/**
 * The men who would fight where this army stands: its own regiments, plus the garrison if it is
 * encamped at one of its own (or an ally's) towns, and the men of nearby friendly armies that
 * would march in to join a battle.
 */
export function fightingMen(s: GameState, a: Army, reach = 60): { army: number; garrison: number; town: string; nearby: number } {
  // A host counts as one: the leader's men and those marching under his banner.
  const host = s.armies.filter((o) => o.follows === a.id);
  const army = Math.round(unitsMen(a.units) + host.reduce((n, o) => n + unitsMen(o.units), 0));
  const t = townAt(s, a);
  const p = t >= 0 ? s.provinces[t] : null;
  const ownTown = !!p && !p.siege && (p.owner === a.owner || s.ally[p.owner]?.[a.owner]);
  const garrison = ownTown ? Math.round(unitsMen(p!.garrison)) : 0;
  const nearby = Math.round(s.armies.filter((o) => o !== a && o.follows !== a.id && (o.owner === a.owner || s.ally[o.owner]?.[a.owner])
    && dist(o, a) < reach && s.day >= o.busyUntil && o.raidUntil <= s.day).reduce((n, o) => n + unitsMen(o.units), 0));
  return { army, garrison, town: ownTown ? p!.town : '', nearby };
}

/** A number as the spies would report it: rounded, with a tilde. */
export function roughNumber(n: number): string {
  const r = n < 1000 ? Math.round(n / 100) * 100 : Math.round(n / 500) * 500;
  return `~${r >= 1000 ? `${(r / 1000).toFixed(1)}k` : Math.max(100, r)}`;
}

/** What the player's spies report of an army they haven't seen up close. */
export function roughMen(a: Army): string {
  const n = unitsMen(a.units);
  const r = n < 1000 ? Math.round(n / 100) * 100 : Math.round(n / 500) * 500;
  return `~${r >= 1000 ? `${(r / 1000).toFixed(1)}k` : Math.max(100, r)}`;
}

// ---------------------------------------------------------------- supply (daily)

/** Is the army inside friendly country, or under the guns of one of its own forts? */
export function supplied(s: GameState, a: Army): 'fort' | 'home' | 'none' {
  if (s.provinces.some((p) => p.owner === a.owner && p.kind === 'fort' && !p.siege && dist(a, p) < 70)) return 'fort';
  const here = s.provinces[provinceUnder(s, a, a.node)];
  return here.owner === a.owner || s.ally[here.owner]?.[a.owner] ? 'home' : 'none';
}

export function supplyDaily(s: GameState) {
  const monsoon = isMonsoon(s.day);
  for (const a of s.armies) {
    const qm = a.general.trait === 'quartermaster';
    const max = maxFood(a);
    const was = a.food;
    const sup = supplied(s, a);
    if (sup !== 'none') {
      a.food = Math.min(max, a.food + (sup === 'fort' || townAt(s, a) >= 0 ? 10 : 5));
      const town = townAt(s, a);
      if (town >= 0 && s.provinces[town].buildings.granary) a.food = max;
    } else {
      const here = s.provinces[provinceUnder(s, a, a.node)];
      // Living off the country: rich, untouched land feeds an army; ravaged land feeds no one.
      let forage = here.devastated > 0 ? 0 : (here.wealth / 10) * (monsoon ? 0.5 : 1) * Math.max(0.3, 1 - a.units.length / 30);
      if (a.siegeOf >= 0) forage *= 0.7;
      if (a.raidUntil > s.day) forage += 6;
      a.food = clamp(a.food - (qm ? 0.5 : 1) + forage, 0, max);
    }
    if (a.food <= 0) {
      const loss = (monsoon ? 0.02 : 0.012) * (qm ? 0.5 : 1);
      for (const u of a.units) u.men *= 1 - loss;
      if (was > 0) log(s, `${a.general.name}'s army has run out of food and is starving.`, a.owner === PLAYER);
    } else if (was > 5 && a.food <= 5 && a.owner === PLAYER) {
      log(s, `${a.general.name}'s army has food for only a few more days.`, true);
    }
    // Fort guns harass anyone who camps beneath them without laying siege.
    for (const p of s.provinces) {
      if (p.kind === 'fort' && p.walls >= 2 && p.garrison.length && hostile(s, a.owner, p.owner) && a.siegeOf !== p.id && dist(a, p) < 25) {
        for (const u of a.units) u.men *= 0.997;
      }
    }
  }
}

// ---------------------------------------------------------------- night sorties

/** The garrison slips out by night to burn the besiegers' ladders and rams. Returns a report. */
export function sortie(s: GameState, p: Province): string {
  const sg = p.siege;
  const a = sg ? armyById(s, sg.army) : undefined;
  if (!sg || !a) return 'No one is besieging the town.';
  p.lastSortie = s.day;
  const G = unitsStrength(p.garrison) + 5;
  const B = armyStrength(a) * (a.general.trait === 'cautious' ? 1.3 : 1);
  const win = s.rng.next() < Math.min(0.75, (G / (G + B)) * 1.8);
  let text: string;
  if (win) {
    const burnt = s.rng.range(4, 8);
    sg.work = Math.max(0, sg.work - burnt);
    for (const u of a.units) u.men *= 1 - s.rng.range(0.03, 0.06);
    for (const u of p.garrison) u.men *= 1 - s.rng.range(0.02, 0.04);
    text = `A night sortie from ${p.town} burns the ${s.factions[a.owner].short} siege works (${Math.round(burnt)} days of work lost).`;
  } else {
    for (const u of p.garrison) u.men *= 1 - s.rng.range(0.06, 0.1);
    for (const u of a.units) u.men *= 0.99;
    text = `A night sortie from ${p.town} is caught and driven back with loss.`;
  }
  log(s, text, mine(s, p.owner, a.owner));
  return text;
}

export function sortiesDaily(s: GameState) {
  for (const p of s.provinces) {
    if (!p.siege || p.owner === PLAYER || p.owner === IND || s.day - p.lastSortie < 6) continue;
    const a = armyById(s, p.siege.army);
    if (!a || unitsStrength(p.garrison) < armyStrength(a) * 0.25) continue;
    if (s.rng.chance(0.05)) sortie(s, p);
  }
}

// ---------------------------------------------------------------- chauth

/** Ask a province to buy off our army with a quarter of its revenue. Returns [accepted, report]. */
export function demandChauth(s: GameState, a: Army, p: Province): [boolean, string] {
  if (!hostile(s, a.owner, p.owner)) return [false, 'You are at peace with them.'];
  if (p.tribute && p.tribute.until >= s.day && p.tribute.to === a.owner) return [false, `${p.name} already pays you chauth.`];
  if (s.day - p.lastIntrigue < 30) return [false, 'They gave their answer only lately.'];
  p.lastIntrigue = s.day;
  const nearby = s.armies.filter((x) => x.owner === p.owner && dist(x, p) < 60).reduce((n, x) => n + armyStrength(x), 0);
  const D = (unitsStrength(p.garrison) + 10) * wallFactor(p, a.units, 0) + nearby;
  const ratio = armyStrength(a) / Math.max(1, D);
  const fear = (p.devastated > 0 ? 0.2 : 0) + (manpowerRatio(s, p.owner) < 0.35 ? 0.15 : 0) + (p.unrest > 50 ? 0.1 : 0);
  const odds = clamp((ratio - 0.9) / 1.2 + fear, 0, 0.95);
  const f = s.factions;
  if (!s.rng.chance(odds)) {
    const t = `The ${f[p.owner].short} of ${p.name} refuse to pay chauth to the ${f[a.owner].short}.`;
    log(s, t, mine(s, a.owner, p.owner));
    return [false, t];
  }
  p.tribute = { to: a.owner, until: s.day + 360 };
  const now = Math.round(p.wealth * 4);
  s.gold[a.owner] += now;
  if (a.siegeOf === p.id) setGoal(s, a, null);
  const t = `${p.name} agrees to pay chauth to the ${f[a.owner].short} for a year: ${now} gold now and a quarter of its revenue each month.`;
  if (isYours(s, a)) chronicle(s, 'diplomacy', `Before ${p.town}, you made ${p.name} pay chauth to Swarajya: ${now} gold at once and a quarter of its revenue for a year.`);
  log(s, t, mine(s, a.owner, p.owner));
  return [true, t];
}

/** Pay a demand for chauth from someone else's army (decided by the province's owner). */
export function grantChauth(s: GameState, a: Army, p: Province) {
  p.tribute = { to: a.owner, until: s.day + 360 };
  const now = Math.min(s.gold[p.owner], Math.round(p.wealth * 4));
  s.gold[p.owner] -= now;
  s.gold[a.owner] += now;
  setGoal(s, a, null);
  a.aiNext = s.day + 10;
  log(s, `${p.name} buys off the ${s.factions[a.owner].short} with chauth.`, mine(s, a.owner, p.owner));
}

// ---------------------------------------------------------------- unrest (monthly)

export interface UnrestNote { label: string; v: number }

/** Why a province is as restless as it is: each pressure, signed. */
export function unrestCauses(s: GameState, p: Province): UnrestNote[] {
  const out: UnrestNote[] = [{ label: 'Settling down', v: -2 }];
  if (p.owner === IND) return out;
  const pol = s.policy[p.owner];
  if (p.culture !== p.owner) out.push({ label: 'Foreign rule', v: 1.5 });
  const gap = faithGap(s, p);
  if (gap > 0) out.push({ label: 'Rulers of another faith', v: 2 * gap * (pol.faith === 'tolerant' ? 0.25 : 2) });
  if (pol.tax === 'heavy') out.push({ label: 'Heavy taxes', v: 3 });
  else if (pol.tax === 'light') out.push({ label: 'Light taxes', v: -2 });
  if (p.garrison.length) out.push({ label: 'Garrison', v: -Math.min(3, p.garrison.length) });
  if (p.buildings.temple) out.push({ label: 'Temple', v: -3 });
  if (p.devastated > 0) out.push({ label: 'Plundered', v: 3 });
  if (s.day < p.famineUntil) out.push({ label: 'Famine', v: 3 });
  if (p.siege) out.push({ label: 'Besieged', v: 2 });
  if (s.day - p.takenDay < 360) out.push({ label: 'Newly conquered', v: 2 });
  const key = keyFort(s, p.region);
  if (key && key !== p && hostile(s, key.owner, p.owner)) out.push({ label: `${key.town} in enemy hands`, v: 1 });
  if (p.jagir) out.push({ label: 'Jagirdar keeps order', v: -1 });
  return out;
}

export function unrestMonthly(s: GameState) {
  for (const p of s.provinces) {
    if (p.owner === IND) {
      p.unrest = Math.max(0, p.unrest - 3);
      continue;
    }
    p.unrest = clamp(p.unrest + unrestCauses(s, p).reduce((n, c) => n + c.v, 0), 0, 100);
    if (p.owner === PLAYER && p.unrest > 65 && p.unrest < 80) log(s, `${p.name} is restless (unrest ${Math.round(p.unrest)}). It may rise in revolt.`, true);
    if (p.unrest < 80 || p.siege || !s.rng.chance(0.2)) continue;
    // Revolt: the deshmukhs declare for their own people's realm if it can take them, else for themselves.
    const prev = p.owner;
    const home = p.culture;
    const to = home !== prev && s.factions[home]?.alive && home !== IND && hostile(s, home, prev) ? home : IND;
    capture(s, p, to);
    p.garrison = [newUnit('spear', 0.7), newUnit('paik', 0.9), newUnit('archer', 0.6)];
    p.unrest = 30;
    log(s, to === IND
      ? `${p.name} rises in revolt against the ${s.factions[prev].short} and throws off their rule!`
      : `The deshmukhs of ${p.name} rise against the ${s.factions[prev].short} and declare for the ${s.factions[to].short}!`, mine(s, prev, to));
  }
}

// ---------------------------------------------------------------- commanders

/** After a defeat, or when his regiment falls: is the commander killed, taken, or does he get away? */
/** `surrendered`: he gave himself up on the field, so he is taken alive. */
export function generalFate(s: GameState, a: Army, captor: number, chance = 1, surrendered = false): string | null {
  if (!surrendered && !s.rng.chance(chance)) return null;
  const g = a.general;
  // You always live to fight another day (your army may not).
  if (g.isPlayer) {
    log(s, 'You are wounded in the rout, but your men carry you clear.', true);
    return null;
  }
  const r = surrendered ? 0.5 : s.rng.next();
  const f = s.factions;
  let text: string;
  if (r < 0.35) {
    text = `${g.name} has been killed in battle.`;
  } else if (r < 0.7 && captor !== IND) {
    s.captives.push({ gen: g, owner: a.owner, by: captor, day: s.day });
    text = `${g.name} has been taken prisoner by the ${f[captor].short}.`;
  } else {
    log(s, `${g.name} escapes the rout, wounded.`, a.owner === PLAYER || captor === PLAYER);
    return null;
  }
  // A new commander takes up the standard.
  const pool = s.officers[a.owner];
  a.general = pool.length ? pool.shift()! : makeGeneral(s.rng, `Sardar ${s.nextArmyId}`, f[a.owner].short);
  log(s, `${text} ${a.general.name} takes command of the army.`, a.owner === PLAYER || captor === PLAYER);
  return text;
}

export const ransomPrice = (g: General) => 60 + generalRank(g) * 40;

/** The player's commanders, in the field and at court. */
export function playerGenerals(s: GameState): { g: General; army: Army | null }[] {
  return [
    ...s.armies.filter((a) => a.owner === PLAYER).map((a) => ({ g: a.general, army: a as Army | null })),
    ...s.officers[PLAYER].map((g) => ({ g, army: null as Army | null })),
  ];
}

export function giftGeneral(s: GameState, g: General): string | null {
  const cost = 50 + generalRank(g) * 25;
  if (s.gold[PLAYER] < cost) return 'Not enough gold.';
  s.gold[PLAYER] -= cost;
  g.loyalty = Math.min(100, g.loyalty + 15);
  return null;
}

/** A commander who turns his coat takes his army with him. */
function defect(s: GameState, a: Army) {
  const foes = s.factions.filter((f) => f.alive && f.id !== PLAYER && f.id !== IND && s.war[PLAYER][f.id]);
  const to = foes.sort((x, y) => factionStrength(s, y.id) - factionStrength(s, x.id))[0]?.id ?? IND;
  log(s, `${a.general.name} has gone over to the ${s.factions[to].short}, taking his army of ${Math.round(unitsMen(a.units))} with him!`, true);
  if (a.siegeOf >= 0) setGoal(s, a, null);
  a.owner = to;
  a.goal = null;
  a.route = [];
  a.general.loyalty = 70;
  a.aiNext = s.day + 1;
}

export interface Request { gen: General; army: Army | null; prov: Province }

/** Monthly: commanders' loyalty drifts; the discontented ask for land or defect. */
export function loyaltyMonthly(s: GameState): Request[] {
  const unpaid = s.gold[PLAYER] <= 0 && netIncome(s, PLAYER) < 0;
  const asks: Request[] = [];
  for (const { g, army } of playerGenerals(s)) {
    if (g.isPlayer) continue;
    g.loyalty += g.loyalty < 60 ? 2 : -1;
    if (unpaid) g.loyalty -= 8;
    if (g.landed) g.loyalty += 1;
    g.loyalty = clamp(g.loyalty, 0, 100);
    if (army && g.loyalty < 15 && s.rng.chance(0.35)) {
      defect(s, army);
      continue;
    }
    if (!g.landed && generalRank(g) >= 1 && g.loyalty < 60 && s.rng.chance(0.12)) {
      const prov = provincesOf(s, PLAYER).filter((p) => !p.jagir && p.capitalOf !== PLAYER).sort((a, b) => b.wealth - a.wealth)[0];
      if (prov) asks.push({ gen: g, army, prov });
    }
  }
  return asks;
}

export function grantJagir(s: GameState, g: General, p: Province) {
  p.jagir = true;
  g.landed = true;
  g.loyalty = Math.min(100, g.loyalty + 35);
  log(s, `${g.name} is granted the jagir of ${p.name}. Half its revenue is now his.`, true);
}

export function captivesMonthly(s: GameState) {
  for (const c of [...s.captives]) {
    const free = () => {
      s.captives = s.captives.filter((x) => x !== c);
      if (s.factions[c.owner].alive) s.officers[c.owner].push(c.gen);
    };
    if (s.day - c.day > 1080) {
      free();
      log(s, `${c.gen.name} is released after three years in captivity.`, mine(s, c.owner, c.by));
      continue;
    }
    // AI realms ransom their own back from each other now and then.
    if (c.by !== PLAYER && c.owner !== PLAYER && s.rng.chance(0.25)) {
      const price = ransomPrice(c.gen);
      if (s.gold[c.owner] >= price) {
        s.gold[c.owner] -= price;
        s.gold[c.by] += price;
        free();
      }
    }
  }
}

/** The player pays to bring a captured commander home. */
export function payRansom(s: GameState, i: number): string | null {
  const c = s.captives[i];
  if (!c || c.owner !== PLAYER) return 'No such captive.';
  const price = ransomPrice(c.gen);
  if (s.gold[PLAYER] < price) return 'Not enough gold.';
  s.gold[PLAYER] -= price;
  s.gold[c.by] += price;
  s.captives.splice(i, 1);
  c.gen.loyalty = Math.min(100, c.gen.loyalty + 20);
  s.officers[PLAYER].push(c.gen);
  log(s, `${c.gen.name} is ransomed and returns to your court.`, true);
  return null;
}

/** The player offers a captive back to his own realm for ransom. */
export function sellCaptive(s: GameState, i: number): string | null {
  const c = s.captives[i];
  if (!c || c.by !== PLAYER) return 'No such captive.';
  const price = ransomPrice(c.gen);
  if (!s.factions[c.owner].alive || s.gold[c.owner] < price) return `The ${s.factions[c.owner].short} cannot pay ${price} gold.`;
  s.gold[c.owner] -= price;
  s.gold[PLAYER] += price;
  s.captives.splice(i, 1);
  s.officers[c.owner].push(c.gen);
  s.relations[c.owner][PLAYER] += 10;
  log(s, `The ${s.factions[c.owner].short} pay ${price} gold for ${c.gen.name}.`, true);
  return null;
}

// ---------------------------------------------------------------- diplomacy

const atWarWith = (s: GameState, f: number) => s.factions.filter((o) => o.alive && o.id !== f && o.id !== IND && s.war[f][o.id]).map((o) => o.id);
const commonEnemy = (s: GameState, a: number, b: number) => atWarWith(s, a).some((x) => s.war[b][x]);

export type DiploAction = 'alliance' | 'marriage' | 'hostages' | 'gift';

/** The player proposes something to another court. Returns a report. */
export function propose(s: GameState, f: number, what: DiploAction): string {
  const fac = s.factions[f];
  const rel = s.relations[f][PLAYER];
  const war = s.war[PLAYER][f];
  if (what === 'gift') {
    if (s.gold[PLAYER] < 80) return 'Not enough gold.';
    s.gold[PLAYER] -= 80;
    s.relations[f][PLAYER] = Math.min(100, rel + 15);
    return `The ${fac.short} receive your gifts graciously.`;
  }
  if (war) return `You are at war with the ${fac.short}.`;
  if (what === 'alliance') {
    if (s.ally[PLAYER][f]) return 'You are already allies.';
    const score = rel + (commonEnemy(s, PLAYER, f) ? 35 : 0) + (factionStrength(s, PLAYER) > factionStrength(s, f) ? 10 : 0) - (fac.key === 'mug' ? 30 : 0);
    if (score < 30) {
      s.relations[f][PLAYER] -= 3;
      return `The ${fac.short} decline an alliance.`;
    }
    s.ally[PLAYER][f] = s.ally[f][PLAYER] = true;
    s.relations[f][PLAYER] += 10;
    log(s, `Alliance sealed with the ${fac.name}.`, true);
    return `The ${fac.short} agree to an alliance. They will join wars against those who attack you, and may march to your aid.`;
  }
  if (what === 'marriage') {
    if (s.marriage[PLAYER][f]) return 'Your houses are already joined by marriage.';
    if (rel < (fac.key === 'mug' ? 40 : 10)) return `The ${fac.short} court will not hear of a match (relations ${Math.round(rel)}).`;
    s.marriage[PLAYER][f] = s.marriage[f][PLAYER] = true;
    s.relations[f][PLAYER] += 30;
    s.relations[PLAYER][f] += 30;
    log(s, `A marriage joins the house of Bhonsle with the ${fac.name}.`, true);
    return `A marriage alliance with the ${fac.short}. They will not lightly make war on kin.`;
  }
  if (rel < -10) return `The ${fac.short} do not trust you enough to exchange hostages.`;
  s.truceUntil[PLAYER][f] = s.truceUntil[f][PLAYER] = s.day + 720;
  log(s, `Hostages exchanged with the ${fac.name}: two years of peace are sworn.`, true);
  return `Hostages exchanged. Neither side may make war for two years. Breaking the oath costs the hostages' lives and your good name.`;
}

export const SUBSIDY = 150;

/** Pay one realm to make war on another. */
export function subsidise(s: GameState, f: number, target: number): string {
  if (s.gold[PLAYER] < SUBSIDY) return 'Not enough gold.';
  const A = s.factions[f];
  const B = s.factions[target];
  if (s.war[f][target]) return `The ${A.short} are already at war with the ${B.short}.`;
  if (s.ally[f][target] || s.marriage[f][target] || s.truceUntil[f][target] > s.day) return `The ${A.short} are bound to the ${B.short} and refuse.`;
  const willing = s.relations[f][PLAYER] >= -5 && (factionStrength(s, f) >= factionStrength(s, target) * 0.6 || s.relations[f][target] < -20);
  if (!willing) return `The ${A.short} take no interest in a war with the ${B.short}.`;
  s.gold[PLAYER] -= SUBSIDY;
  s.relations[f][PLAYER] += 10;
  declareWar(s, f, target);
  return `Your gold buys a war: the ${A.short} march against the ${B.short}.`;
}

/** Peace on the player's terms. Returns [made, report]. */
export function peaceTerms(s: GameState, f: number, demand: 'white' | 'tribute' | 'province', willing: boolean): [boolean, string] {
  const fac = s.factions[f];
  const ex = manpowerRatio(s, f);
  const ratio = (factionStrength(s, PLAYER) + 1) / (factionStrength(s, f) + 1);
  if (!willing) return [false, `The ${fac.name} sends your envoys away.`];
  if (demand === 'tribute') {
    if (!(ex < 0.35 || ratio > 1.3)) return [false, `The ${fac.short} would make peace, but will pay nothing for it.`];
    const gold = Math.round(s.gold[f] * 0.3 + 30);
    s.gold[f] -= Math.min(gold, s.gold[f]);
    s.gold[PLAYER] += gold;
    makePeace(s, PLAYER, f);
    return [true, `Peace, and the ${fac.short} pay ${gold} gold.`];
  }
  if (demand === 'province') {
    const p = cessionFor(s, f);
    if (!p) return [false, 'There is no province of theirs worth demanding.'];
    if (!(ex < 0.25 || ratio > 1.8)) return [false, `The ${fac.short} will not give up ${p.name}.`];
    makePeace(s, PLAYER, f);
    capture(s, p, PLAYER);
    log(s, `By the treaty, the ${fac.short} cede ${p.name} to Swarajya.`, true);
    return [true, `Peace, and ${p.name} is ceded to you.`];
  }
  makePeace(s, PLAYER, f);
  return [true, `Peace with the ${fac.name}.`];
}

/** The province a beaten realm would hand over: one we besiege, else a rich one on our border. */
export function cessionFor(s: GameState, f: number): Province | null {
  const theirs = provincesOf(s, f).filter((p) => p.capitalOf !== f);
  const besieged = theirs.find((p) => p.siege && armyById(s, p.siege.army)?.owner === PLAYER);
  if (besieged) return besieged;
  const border = theirs.filter((p) => p.neighbors.some((n) => s.provinces[n].owner === PLAYER));
  return border.sort((a, b) => b.wealth - a.wealth)[0] ?? null;
}

/** AI courts: goodwill drifts, allies are drawn into wars, alliances form and break. */
export function diplomacyMonthly(s: GameState) {
  const F = s.factions;
  const n = F.length;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const r = s.relations[a][b];
      const rest = s.ally[a][b] ? 30 : s.war[a][b] ? -30 : 0;
      s.relations[a][b] = clamp(r + Math.sign(rest - r), -100, 100);
    }
  }
  for (let x = 1; x < n - 1; x++) {
    if (!F[x].alive || F[x].ai === 'none') continue;
    for (let y = 0; y < n - 1; y++) {
      if (y === x || !F[y].alive) continue;
      // An ally at war calls on us: we may join against its enemies.
      if (s.ally[x][y]) {
        for (const z of atWarWith(s, y)) {
          if (z === x || s.war[x][z] || s.ally[x][z] || s.marriage[x][z] || s.truceUntil[x][z] > s.day) continue;
          if (s.rng.chance(y === PLAYER ? 0.15 : 0.1)) declareWar(s, x, z);
        }
        if (s.relations[x][y] < -20 && y !== PLAYER) {
          s.ally[x][y] = s.ally[y][x] = false;
          log(s, `The alliance between the ${F[x].short} and the ${F[y].short} breaks down.`);
        }
      } else if (y !== PLAYER && y > x && F[y].ai !== 'none' && !s.war[x][y] && commonEnemy(s, x, y)
        && s.relations[x][y] > -10 && s.rng.chance(0.03)) {
        s.ally[x][y] = s.ally[y][x] = true;
        s.relations[x][y] += 20;
        s.relations[y][x] += 20;
        log(s, `The ${F[x].short} and the ${F[y].short} join in alliance.`, commonEnemy(s, x, PLAYER) || commonEnemy(s, y, PLAYER));
      }
    }
  }
}

/** Would an AI court go to war with `other` (beyond its own appetite)? */
export function warBlocked(s: GameState, f: number, other: number): boolean {
  return s.truceUntil[f][other] > s.day || (s.marriage[f][other] && s.relations[f][other] > -20) || s.ally[f][other];
}

// ---------------------------------------------------------------- spies

export const SPY_COST = { scout: 20, sabotage: 40, incite: 50 };

export function scout(s: GameState, a: Army): string {
  if (s.gold[PLAYER] < SPY_COST.scout) return 'Not enough gold.';
  s.gold[PLAYER] -= SPY_COST.scout;
  a.scoutedUntil = s.day + 30;
  return `Your harkaras shadow ${a.general.name}'s army: its numbers will be known for a month.`;
}

export function sabotage(s: GameState, a: Army): string {
  const p = a.siegeOf >= 0 ? s.provinces[a.siegeOf] : null;
  if (!p?.siege) return 'That army is not besieging anything.';
  if (s.gold[PLAYER] < SPY_COST.sabotage) return 'Not enough gold.';
  s.gold[PLAYER] -= SPY_COST.sabotage;
  if (s.rng.chance(0.65)) {
    p.siege.work = Math.max(0, p.siege.work - 8);
    log(s, `Your agents fire the siege works before ${p.town}. The ${s.factions[a.owner].short} must start again.`, true);
    return 'Success: their ladders and ram go up in flames.';
  }
  log(s, `Your saboteurs are caught in the ${s.factions[a.owner].short} camp before ${p.town}.`, true);
  return 'Your agents were caught.';
}

export const bribeCost = (p: Province) => Math.round(30 + unitsMen(p.garrison) * 0.4 + p.walls * 40);

/** Gold for the qiledar to open the gates. Returns 'taken' on success. */
export function bribe(s: GameState, p: Province): 'taken' | string {
  if (!hostile(s, PLAYER, p.owner)) return 'You are at peace with them.';
  if (!s.armies.some((a) => a.owner === PLAYER && (a.siegeOf === p.id || townAt(s, a) === p.id))) return 'You need an army before the gates.';
  if (s.day - p.lastIntrigue < 30) return 'The garrison is on its guard; try again later.';
  const cost = bribeCost(p);
  if (s.gold[PLAYER] < cost) return 'Not enough gold.';
  s.gold[PLAYER] -= cost;
  p.lastIntrigue = s.day;
  const odds = clamp(0.25 + p.unrest / 200 + (1 - manpowerRatio(s, p.owner)) * 0.25 - p.walls * 0.03 + (p.supplies < 8 ? 0.15 : 0), 0.05, 0.8);
  if (s.rng.chance(odds)) {
    log(s, `Bought with your gold, the qiledar of ${p.town} opens the gates at night.`, true);
    return 'taken';
  }
  log(s, `The qiledar of ${p.town} takes your gold and hangs your messenger.`, true);
  return 'The bribe failed.';
}

export function incite(s: GameState, p: Province): string {
  if (s.gold[PLAYER] < SPY_COST.incite) return 'Not enough gold.';
  s.gold[PLAYER] -= SPY_COST.incite;
  if (s.rng.chance(0.7)) {
    p.unrest = Math.min(100, p.unrest + 25);
    return `Your agents stir up the people of ${p.name} (unrest ${Math.round(p.unrest)}).`;
  }
  return 'Your agents were found out.';
}

/** Enemy spies at work against the player's sieges. */
export function aiSpiesMonthly(s: GameState) {
  for (const p of s.provinces) {
    const a = p.siege ? armyById(s, p.siege.army) : undefined;
    if (!a || a.owner !== PLAYER || p.owner === IND || !s.rng.chance(0.12)) continue;
    p.siege!.work = Math.max(0, p.siege!.work - 4);
    log(s, `Enemy agents slip into your camp before ${p.town} and fire the siege works.`, true);
  }
}

// ---------------------------------------------------------------- buildings

export type Building = 'temple' | 'stables' | 'granary' | 'shipyard';
export const BUILDINGS: Record<Building, { name: string; icon: string; cost: number; help: string }> = {
  temple: { name: 'Temple', icon: '🛕', cost: 60, help: 'Calms the province: unrest falls each month.' },
  stables: { name: 'Stables', icon: '🐎', cost: 80, help: 'Cavalry raised here cost less and come already seasoned.' },
  granary: { name: 'Granary', icon: '🌾', cost: 50, help: 'Half as much again in siege stores; armies here fill their wagons; no famine.' },
  shipyard: { name: 'Shipyard', icon: '⚓', cost: 90, help: 'Build ships here (coast only).' },
};

export function build(s: GameState, p: Province, b: Building, err: string | null): string | null {
  if (err) return err;
  if (p.buildings[b]) return 'Already built.';
  if (b === 'shipyard' && !isCoastal(p)) return 'Shipyards need a harbour.';
  const cost = BUILDINGS[b].cost;
  if (s.gold[PLAYER] < cost) return 'Not enough gold.';
  s.gold[PLAYER] -= cost;
  p.buildings[b] = true;
  p.builtDay = s.day;
  if (b === 'granary') p.supplies = Math.max(p.supplies, 0);
  log(s, `A ${BUILDINGS[b].name.toLowerCase()} is built at ${p.town}.`, true);
  return null;
}

// ---------------------------------------------------------------- navy

export const SHIP_COST = 40;
export const MAX_SHIPS = 15;
const FLEET_SPEED = 40;
const SEA_RANGE = 520;
const QUALITY: Record<string, number> = { por: 1.3, eng: 1.3, sid: 1.15, mar: 1, mug: 0.8 };
const quality = (s: GameState, f: number) => QUALITY[s.factions[f].key] ?? 0.9;

export function fleetAt(s: GameState, p: Province, owner: number): Fleet | undefined {
  return s.fleets.find((f) => f.owner === owner && f.home === p.id);
}

export function buildShip(s: GameState, p: Province, owner = PLAYER): string | null {
  if (p.owner !== owner || !p.buildings.shipyard) return 'Ships are built only at your own shipyards.';
  if (p.siege) return 'The port is under siege.';
  if (s.gold[owner] < SHIP_COST) return 'Not enough gold.';
  let f = fleetAt(s, p, owner);
  if (f && f.ships >= MAX_SHIPS) return `A squadron holds at most ${MAX_SHIPS} ships.`;
  s.gold[owner] -= SHIP_COST;
  if (!f) {
    f = { id: s.nextFleetId++, owner, ships: 0, home: p.id, mission: 'port', target: -1, x: p.x, y: p.y, returning: false };
    s.fleets.push(f);
  }
  f.ships++;
  return null;
}

/** Hostile coastal provinces a fleet can reach on its own sea. */
export function fleetTargets(s: GameState, f: Fleet): Province[] {
  const home = s.provinces[f.home];
  return s.provinces.filter((p) => isCoastal(p) && hostile(s, f.owner, p.owner) && seaOf(p) === seaOf(home) && dist(p, home) < SEA_RANGE);
}

export function orderFleet(s: GameState, f: Fleet, mission: Fleet['mission'], target = -1) {
  f.mission = mission;
  f.target = target;
  f.returning = mission === 'port' || mission === 'patrol';
}

/** Two squadrons meet. Returns the winner. */
function seaFight(s: GameState, a: Fleet, b: Fleet): Fleet {
  const A = a.ships * quality(s, a.owner) * s.rng.range(0.8, 1.2);
  const B = b.ships * quality(s, b.owner) * s.rng.range(0.8, 1.2) * 1.1;
  const [w, l] = s.rng.next() < (A * A) / (A * A + B * B) ? [a, b] : [b, a];
  w.ships = Math.max(1, Math.round(w.ships * s.rng.range(0.7, 0.9)));
  l.ships = Math.floor(l.ships * s.rng.range(0.3, 0.6));
  log(s, `Sea fight off ${s.provinces[a.target >= 0 ? a.target : a.home].name}: the ${s.factions[w.owner].short} squadron wins; the ${s.factions[l.owner].short} lose ${l.ships ? 'half their ships' : 'every ship'}.`,
    mine(s, a.owner, b.owner));
  if (l.ships <= 0) s.fleets = s.fleets.filter((x) => x !== l);
  else orderFleet(s, l, 'port');
  return w;
}

/** Fleets sail; raids land, blockades close in, patrols intercept. */
export function fleetsMove(s: GameState, dt: number) {
  for (const f of [...s.fleets]) {
    if (!s.fleets.includes(f)) continue;
    const home = s.provinces[f.home];
    if (home.owner !== f.owner) {
      // Lost its home port: make for the nearest port of its own.
      const alt = s.provinces.filter((p) => p.owner === f.owner && isCoastal(p)).sort((p, q) => dist(p, f) - dist(q, f))[0];
      if (!alt) {
        s.fleets = s.fleets.filter((x) => x !== f);
        continue;
      }
      f.home = alt.id;
    }
    const tgt = f.returning || f.mission === 'port' || f.mission === 'patrol' || f.target < 0 ? s.provinces[f.home] : s.provinces[f.target];
    const d = dist(f, tgt);
    const step = FLEET_SPEED * dt;
    if (d > step) {
      f.x += ((tgt.x - f.x) / d) * step;
      f.y += ((tgt.y - f.y) / d) * step;
      continue;
    }
    f.x = tgt.x;
    f.y = tgt.y;
    if (f.returning) {
      f.returning = false;
      if (f.mission === 'raid') f.mission = 'port';
      continue;
    }
    if (f.mission !== 'raid' || f.target < 0) continue;
    // A raid lands: unless a defending squadron is on hand to stop it.
    const p = s.provinces[f.target];
    if (!hostile(s, f.owner, p.owner)) {
      orderFleet(s, f, 'port');
      continue;
    }
    const guard = s.fleets.filter((g) => g !== f && hostile(s, g.owner, f.owner) && (g.owner === p.owner || s.ally[g.owner][p.owner])
      && (g.mission === 'patrol' || g.mission === 'port') && dist(g, p) < 300).sort((x, y) => y.ships - x.ships)[0];
    if (guard && seaFight(s, f, guard) !== f) continue;
    const gold = Math.round(p.wealth * 3 * Math.min(1, f.ships / 6) * (p.devastated > 0 ? 0.3 : 1));
    s.gold[f.owner] += gold;
    s.gold[p.owner] = Math.max(0, s.gold[p.owner] - Math.round(gold / 2));
    p.devastated = Math.max(p.devastated, 30);
    p.unrest = Math.min(100, p.unrest + 5);
    log(s, `A ${s.factions[f.owner].short} squadron raids the coast of ${p.name} and carries off ${gold} gold.`, mine(s, f.owner, p.owner));
    f.returning = true;
  }
}

/** AI admirals: raid, blockade, patrol, build; defenders attack blockaders. */
export function navyMonthly(s: GameState) {
  for (const f of [...s.fleets]) {
    if (!s.fleets.includes(f)) continue;
    // A blockade is challenged by the port's own ships.
    if (f.mission === 'blockade' && f.target >= 0) {
      const p = s.provinces[f.target];
      const def = s.fleets.find((g) => g.owner === p.owner && g.ships >= 3 && dist(g, p) < 300 && g.mission !== 'raid');
      if (def && def.owner !== PLAYER && s.rng.chance(0.5)) seaFight(s, def, f);
    }
    if (f.owner === PLAYER || !s.fleets.includes(f)) continue;
    if (f.mission === 'blockade' && s.rng.chance(0.15)) orderFleet(s, f, 'port');
    if (f.mission === 'raid' || f.mission === 'blockade' || f.ships < 3) continue;
    const targets = fleetTargets(s, f).filter((p) => p.owner !== IND);
    if (!targets.length) {
      orderFleet(s, f, 'patrol');
      continue;
    }
    // Close the sea to a port our army besieges; otherwise raid now and then.
    const besieged = targets.find((p) => p.siege && armyById(s, p.siege.army)?.owner === f.owner);
    if (besieged) orderFleet(s, f, 'blockade', besieged.id);
    else if (s.rng.chance(0.3)) orderFleet(s, f, 'raid', s.rng.pick(targets).id);
    else orderFleet(s, f, 'patrol');
  }
  for (const fac of s.factions) {
    if (!fac.alive || fac.id === PLAYER || fac.ai === 'none' || s.gold[fac.id] < 200) continue;
    const yard = provincesOf(s, fac.id).find((p) => p.buildings.shipyard && !p.siege);
    if (yard && s.rng.chance(0.4)) buildShip(s, yard, fac.id);
  }
}

// ---------------------------------------------------------------- events

export interface GameEvent {
  key: string;
  title: string;
  text: string;
  choices: string[];
  apply(choice: number): void;
}

const hinduRealm = (s: GameState, f: number) => courtFaith(s, f) === 'hindu' && f !== IND;

/** Picks this month's event for the player, if any. */
export function pickEvent(s: GameState): GameEvent | null {
  const F = s.factions;
  const mar = PLAYER;
  const once = (k: string) => !s.eventsDone.includes(k);
  const done = (k: string) => s.eventsDone.push(k);
  const year = yearOf(s.day);
  const month = monthOf(s.day);
  const mug = F.findIndex((f) => f.key === 'mug');
  const myArmies = s.armies.filter((a) => a.owner === PLAYER);
  const candidates: (() => GameEvent | null)[] = [
    // The coronation at Raigad (June 1674).
    () => {
      const raigad = s.provinces.find((p) => p.key === 'raigad')!;
      if (!once('coronation') || year < 1674 || month !== 5 || raigad.owner !== mar) return null;
      return {
        key: 'coronation', title: 'The coronation at Raigad',
        text: 'Gaga Bhatt has come from Benares. The Brahmins say the time has come for Shivaji to be crowned Chhatrapati, sovereign of a free Hindu realm.',
        choices: [`A grand coronation (${Math.min(300, s.gold[PLAYER])} gold)`, 'A simple ceremony'],
        apply: (c) => {
          done('coronation');
          if (c === 0) {
            s.gold[PLAYER] -= Math.min(300, s.gold[PLAYER]);
            for (const { g } of playerGenerals(s)) g.loyalty = Math.min(100, g.loyalty + 20);
            s.manpower[PLAYER] += Math.round(maxManpower(s, PLAYER) * 0.15);
            for (const f of F) if (hinduRealm(s, f.id) && f.id !== PLAYER) s.relations[f.id][PLAYER] += 25;
            for (const p of provincesOf(s, PLAYER)) if (p.faith !== 'muslim') p.unrest = Math.max(0, p.unrest - 15);
            log(s, 'Shivaji is crowned Chhatrapati at Raigad. The realm takes heart, and Hindu courts look on with respect.', true);
          } else log(s, 'A quiet ceremony at Raigad. Shivaji takes the throne without fanfare.', true);
        },
      };
    },
    // Summons to the Emperor's court.
    () => {
      if (!once('agra') || year < 1671 || mug < 0 || !F[mug].alive || !s.rng.chance(0.15)) return null;
      return {
        key: 'agra', title: 'Summons to the Mughal court',
        text: 'A farman arrives from the Emperor, inviting the Maratha raja to court with promises of honour and a mansab. It may be a trap, as it was at Agra.',
        choices: ['Go to court (peace with the Mughals for a year)', 'Refuse the summons'],
        apply: (c) => {
          done('agra');
          if (c === 0) {
            if (s.war[PLAYER][mug]) makePeace(s, PLAYER, mug);
            s.truceUntil[PLAYER][mug] = s.truceUntil[mug][PLAYER] = s.day + 360;
            if (s.rng.chance(0.5)) {
              s.gold[PLAYER] = Math.max(0, s.gold[PLAYER] - 150);
              log(s, 'Held under guard at court, the raja escapes hidden in a basket of sweets. The bribes cost a fortune, but the truce holds.', true);
            } else log(s, 'The visit to court passes with honour. The Mughals swear a year of peace.', true);
          } else {
            s.relations[mug][PLAYER] -= 20;
            log(s, 'You send the Emperor\'s envoys back empty-handed.', true);
          }
        },
      };
    },
    // Famine after a failed monsoon.
    () => {
      if ((month !== 9 && month !== 10) || !s.rng.chance(0.15)) return null;
      const regions = [...new Set(provincesOf(s, PLAYER).map((p) => p.region))];
      if (!regions.length) return null;
      const region = s.rng.pick(regions);
      const hit = provincesOf(s, PLAYER).filter((p) => p.region === region && !p.buildings.granary);
      if (!hit.length) return null;
      const cost = 25 * hit.length;
      return {
        key: 'famine', title: `Famine in ${region}`,
        text: `The rains failed in ${region}. Wells are dry and the villages are starving. ${hit.length} of your provinces are stricken (granaries protect the rest).`,
        choices: [`Open the treasury and buy grain (${cost} gold)`, 'Let the markets sort it out'],
        apply: (c) => {
          const paid = c === 0 && s.gold[PLAYER] >= cost;
          if (paid) s.gold[PLAYER] -= cost;
          for (const p of hit) {
            p.famineUntil = s.day + (paid ? 60 : 120);
            p.unrest = clamp(p.unrest + (paid ? -10 : 15), 0, 100);
          }
          log(s, paid ? `Grain carts reach ${region}. The famine eases.` : `Famine stalks ${region}. The people remember who left them to starve.`, true);
        },
      };
    },
    // Sickness in camp.
    () => {
      const a = myArmies.filter((x) => x.units.length >= 8 && x.siegeOf < 0)[0];
      if (!a || !s.rng.chance(0.06)) return null;
      return {
        key: 'plague', title: `Sickness in ${a.general.name}'s camp`,
        text: 'Fever is spreading through the tents. The vaidyas urge you to keep the men in camp until it passes.',
        choices: ['Quarantine the camp for 15 days', 'March on regardless'],
        apply: (c) => {
          if (c === 0) {
            a.quarantineUntil = s.day + 15;
            setGoal(s, a, null);
            log(s, `${a.general.name}'s army waits out the fever in camp.`, true);
          } else {
            for (const u of a.units) u.men *= 0.85;
            log(s, `${a.general.name}'s army marches on, leaving its sick by the road.`, true);
          }
        },
      };
    },
    // European traders.
    () => {
      const port = provincesOf(s, PLAYER).find((p) => p.kind === 'port' && !p.siege);
      const who = ['eng', 'por'].map((k) => F.findIndex((f) => f.key === k)).find((i) => i >= 0 && F[i].alive && once(`trade-${F[i].key}`) && !s.war[PLAYER][i]);
      if (!port || who === undefined || !s.rng.chance(0.1)) return null;
      const f = F[who];
      return {
        key: `trade-${f.key}`, title: `${f.short} factors at ${port.town}`,
        text: `Merchants of the ${f.name} ask leave to open a trading house at ${port.town}, buying pepper, cloth and saltpetre.`,
        choices: ['Grant a factory (+2 wealth there)', 'Demand a present first (+100 gold)', 'Send them away'],
        apply: (c) => {
          done(`trade-${f.key}`);
          if (c === 0) {
            port.wealth += 2;
            s.relations[who][PLAYER] += 20;
            log(s, `The ${f.short} open a factory at ${port.town}. Trade flourishes.`, true);
          } else if (c === 1) {
            s.gold[PLAYER] += 100;
            s.relations[who][PLAYER] -= 20;
            log(s, `The ${f.short} pay 100 gold, grumbling, and sail away.`, true);
          }
        },
      };
    },
    // A saint's blessing.
    () => {
      if (!once('ramdas') || year < 1672 || !s.rng.chance(0.08)) return null;
      return {
        key: 'ramdas', title: 'Samarth Ramdas',
        text: 'The saint Ramdas of Sajjangad sends his blessing to the cause of Swarajya and asks that a math be founded for his disciples.',
        choices: ['Endow a math (80 gold)', 'Thank him with words'],
        apply: (c) => {
          done('ramdas');
          for (const { g } of playerGenerals(s)) g.loyalty = Math.min(100, g.loyalty + 10);
          for (const p of provincesOf(s, PLAYER)) if (p.faith !== 'muslim') p.unrest = Math.max(0, p.unrest - (c === 0 ? 15 : 5));
          if (c === 0) {
            s.gold[PLAYER] = Math.max(0, s.gold[PLAYER] - 80);
            s.manpower[PLAYER] += 300;
          }
          log(s, 'The blessing of Ramdas is read out in every fort. Men come forward to serve.', true);
        },
      };
    },
    // A Mughal noble offers his sword.
    () => {
      if (mug < 0 || !s.war[PLAYER][mug] || !s.rng.chance(0.06)) return null;
      const border = provincesOf(s, PLAYER).find((p) => p.neighbors.some((n) => s.provinces[n].owner === mug) && !p.siege);
      if (!border) return null;
      return {
        key: 'defector', title: 'A mansabdar offers his sword',
        text: `A Mughal mansabdar, passed over for promotion, offers to bring his horsemen over to you at ${border.town} for 120 gold.`,
        choices: ['Accept (120 gold)', 'Turn him away'],
        apply: (c) => {
          if (c !== 0 || s.gold[PLAYER] < 120) return;
          s.gold[PLAYER] -= 120;
          const g = makeGeneral(s.rng, s.rng.pick(['Mirza Raja', 'Sidi Hilal', 'Jadhavrao', 'Ranmast Khan']), 'Mansabdar', 3);
          g.loyalty = 45;
          spawnArmy(s, PLAYER, border.id, [newUnit('heavycav', 0.8), newUnit('heavycav', 0.7), newUnit('horsearcher', 0.8)], g);
          s.relations[mug][PLAYER] -= 10;
          log(s, `${g.name} rides into ${border.town} with his horsemen and swears to serve Swarajya.`, true);
        },
      };
    },
    // Buried treasure.
    () => {
      const fort = provincesOf(s, PLAYER).find((p) => p.kind === 'fort');
      if (!fort || !s.rng.chance(0.025)) return null;
      return {
        key: 'treasure', title: `Treasure at ${fort.town}`,
        text: `Workmen repairing the walls of ${fort.town} have found a buried hoard of gold pagodas.`,
        choices: ['Into the treasury (+150 gold)', 'Give it to the temples (calms the realm)'],
        apply: (c) => {
          if (c === 0) s.gold[PLAYER] += 150;
          else for (const p of provincesOf(s, PLAYER)) p.unrest = Math.max(0, p.unrest - 12);
          log(s, c === 0 ? `The hoard of ${fort.town} fills the treasury.` : `The hoard of ${fort.town} is given to the temples. The people bless the raja.`, true);
        },
      };
    },
  ];
  for (const k of s.rng.shuffle([...candidates.keys()])) {
    const ev = candidates[k]();
    if (ev) return ev;
  }
  return null;
}

/** A commander asks for land: an event with a choice. */
export function landEvent(s: GameState, r: Request): GameEvent {
  return {
    key: 'jagir', title: `${r.gen.name} asks for land`,
    text: `${r.gen.name} (${r.gen.house}) reminds you of his long service and asks for the jagir of ${r.prov.name}: half its revenue would be his. Refuse, and his loyalty (${Math.round(r.gen.loyalty)}) will suffer.`,
    choices: [`Grant ${r.prov.name}`, 'Give him 100 gold instead', 'Refuse'],
    apply: (c) => {
      if (c === 0) grantJagir(s, r.gen, r.prov);
      else if (c === 1 && s.gold[PLAYER] >= 100) {
        s.gold[PLAYER] -= 100;
        r.gen.loyalty = Math.min(100, r.gen.loyalty + 10);
      } else {
        r.gen.loyalty -= 20;
        log(s, `${r.gen.name} leaves your presence in silence.`, true);
      }
    },
  };
}

/** Commanders win renown (and the player's, loyalty) from battle. */
export function battleRenown(s: GameState, winners: Army[], losers: Army[]) {
  for (const a of winners) {
    a.general.xp += 1.5;
    if (a.owner === PLAYER) a.general.loyalty = Math.min(100, a.general.loyalty + 5);
  }
  for (const a of losers) {
    a.general.xp += 0.6;
    if (a.owner === PLAYER) a.general.loyalty = Math.max(0, a.general.loyalty - 4);
  }
}

/** Siege work goes faster under a siege master. */
export const siegeRate = (a: Army | undefined) => (a?.general.trait === 'sapper' ? 1.6 : 1);

/** How an army's commander shapes the battle it fights. */
export function leaderMods(a: Army | null | undefined): LeaderMods {
  const m: LeaderMods = { morale: 1, melee: 1, charge: 1, horse: 1, defense: 1, fatigue: 1 };
  if (!a) return m;
  const g = a.general;
  const r = generalRank(g);
  m.morale *= 1 + r * 0.04;
  m.melee *= 1 + r * 0.03;
  if (g.trait === 'bold') { m.morale *= 1.08; m.charge *= 1.15; m.defense *= 0.95; }
  if (g.trait === 'cautious') { m.defense *= 1.1; m.fatigue *= 0.9; m.charge *= 0.95; }
  if (g.trait === 'horseman') m.horse *= 1.1;
  if (g.trait === 'quartermaster') m.fatigue *= 0.9;
  if (g.trait === 'raider') m.horse *= 1.04;
  return m;
}

/** One line on a commander, for panels. */
export function generalLine(g: General): string {
  return `${RANK_NAMES[generalRank(g)]} · ${TRAITS[g.trait].name}`;
}
