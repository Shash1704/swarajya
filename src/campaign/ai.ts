import { ELITE_CAP, isBreaker, UNIT_STATS, type UnitType } from '../data';
import {
  type Army, armyById, armyStrength, declareWar, dist, eliteCount, factionStrength, type GameState, type Goal,
  hostile, IND, isMonsoon, MAX_UNITS, nearestOwned, newUnit, PLAYER, provinceUnder, provincesOf, setGoal,
  siegeEquipment, spawnArmy, townAt, unitsStrength, wallFactor,
} from './state';

export interface WorldLike {
  state: GameState;
  assault(a: Army): void;
}

/** Re-plans one AI army. Called every day or two of game time. */
export function thinkArmy(w: WorldLike, a: Army) {
  const s = w.state;
  const fac = s.factions[a.owner];
  a.aiNext = s.day + (a.siegeOf >= 0 ? 1 : 1.2 + s.rng.next());
  if (fac.ai === 'none' || a.raidUntil > s.day) return;
  if (a.siegeOf >= 0) {
    considerAssault(w, a);
    return;
  }
  const str = armyStrength(a);
  const enemies = s.armies.filter((e) => e.owner !== IND && hostile(s, a.owner, e.owner));

  // Run from anything much stronger that is close.
  const threat = enemies.find((e) => dist(a, e) < 110 && armyStrength(e) > str * 1.25);
  if (threat) {
    const home = nearestOwned(s, a);
    if (home >= 0 && townAt(s, a) !== home && !(a.goal?.kind === 'go' && a.goal.prov === home)) {
      setGoal(s, a, { kind: 'go', prov: home });
    }
    return;
  }

  if (a.goal && stillValid(s, a, a.goal)) return;

  // Drive besiegers off our own towns.
  for (const p of provincesOf(s, a.owner)) {
    if (!p.siege) continue;
    const besieger = armyById(s, p.siege.army);
    if (besieger && dist(a, p) < 450 && str > armyStrength(besieger) * 1.2) {
      setGoal(s, a, { kind: 'chase', army: besieger.id });
      return;
    }
  }

  // Hunt weaker enemy armies nearby (minor realms only inside their own lands).
  const reach = fac.ai === 'major' ? 260 : 150;
  const prey = enemies
    .filter((e) => dist(a, e) < reach && str > armyStrength(e) * 1.4 && s.day >= e.safeUntil
      && (fac.ai === 'major' || s.provinces[provinceUnder(s, e, e.node)].owner === a.owner))
    .sort((x, y) => dist(a, x) - dist(a, y))[0];
  if (prey) {
    setGoal(s, a, { kind: 'chase', army: prey.id });
    return;
  }

  // Too weak to campaign: go home and wait for recruits.
  if (str < 160 || a.units.length < 4) {
    const cap = s.provinces.find((p) => p.capitalOf === a.owner && p.owner === a.owner && !p.siege);
    const home = cap ? cap.id : nearestOwned(s, a);
    if (home >= 0 && townAt(s, a) !== home) setGoal(s, a, { kind: 'go', prov: home });
    return;
  }

  // Conquest: pick a town worth taking that we can actually take.
  if (fac.ai === 'major' && !isMonsoon(s.day)) {
    let best = -1;
    let bestScore = -Infinity;
    for (const p of s.provinces) {
      if (!hostile(s, a.owner, p.owner) || p.siege) continue;
      const d = dist(a, p);
      if (d > 350) continue;
      if (p.owner === IND && !s.rng.chance(0.25 + fac.aggression * 0.3)) continue;
      const G = (unitsStrength(p.garrison) + 10) * wallFactor(p, a.units, 0);
      if (str < G * 1.3) continue;
      let score = 60 + p.wealth * 3 + (p.capitalOf >= 0 ? 30 : 0) + (p.owner === PLAYER ? 12 : 0) - p.walls * 4 - d / 12 + s.rng.next() * 10;
      if (s.armies.some((o) => o !== a && o.owner === a.owner && o.goal?.kind === 'siege' && o.goal.prov === p.id)) score -= 30;
      if (score > bestScore) {
        bestScore = score;
        best = p.id;
      }
    }
    if (best >= 0) {
      setGoal(s, a, { kind: 'siege', prov: best });
      return;
    }
  }

  // Nothing to do: stand at the nearest friendly town.
  if (townAt(s, a) < 0 && !a.goal) {
    const home = nearestOwned(s, a);
    if (home >= 0) setGoal(s, a, { kind: 'go', prov: home });
  }
}

function stillValid(s: GameState, a: Army, g: Goal): boolean {
  if (g.kind === 'chase') {
    const t = armyById(s, g.army);
    return !!t && hostile(s, a.owner, t.owner) && dist(a, t) < 500 && s.day >= t.safeUntil;
  }
  if (g.kind === 'siege' || g.kind === 'raid') {
    const p = s.provinces[g.prov];
    return hostile(s, a.owner, p.owner) && (!p.siege || p.siege.army === a.id);
  }
  return g.kind === 'go' && a.route.length > 0;
}

function considerAssault(w: WorldLike, a: Army) {
  const s = w.state;
  const p = s.provinces[a.siegeOf];
  if (!p.siege) return;
  const eq = siegeEquipment(p.siege);
  const hasBreaker = a.units.some((u) => isBreaker(u.type));
  const D = (unitsStrength(p.garrison) + 10) * wallFactor(p, a.units, eq);
  const ratio = armyStrength(a) / D;
  const ready = eq >= 1 || hasBreaker;
  const days = s.day - p.siege.start;
  // Starving them out is cheaper; storm only with a clear edge or when the siege drags on.
  if (p.garrison.length === 0 || (ready && ratio > 1.6) || (ready && days >= 20 && ratio > 1.1)) w.assault(a);
}

// ---------------------------------------------------------------- monthly: war and recruiting

export function aiMonthly(s: GameState, f: number) {
  const fac = s.factions[f];
  if (!fac.alive || fac.ai === 'none') return;
  maybeDeclareWar(s, f);
  recruit(s, f);
}

function maybeDeclareWar(s: GameState, f: number) {
  const fac = s.factions[f];
  if (fac.ai !== 'major' || !s.rng.chance(0.015 * fac.aggression)) return;
  const atWar = s.factions.some((o) => o.alive && o.id !== IND && s.war[f][o.id]);
  if (atWar && !s.rng.chance(0.3)) return;
  const mine = factionStrength(s, f);
  const neighbours = new Set<number>();
  for (const p of provincesOf(s, f)) for (const n of p.neighbors) neighbours.add(s.provinces[n].owner);
  const victims = [...neighbours].filter((o) => o !== f && o !== IND && s.factions[o].alive && !s.war[f][o]
    && factionStrength(s, o) < mine * 0.7);
  if (victims.length) declareWar(s, f, s.rng.pick(victims));
}

function pickType(s: GameState, f: number): UnitType {
  const roster = s.factions[f].roster;
  // Mostly line troops; the expensive specialists turn up now and then.
  const cheap = roster.filter((t) => UNIT_STATS[t].cost <= 20);
  return s.rng.chance(0.8) && cheap.length ? s.rng.pick(cheap) : s.rng.pick(roster);
}

function recruit(s: GameState, f: number) {
  const fac = s.factions[f];
  const own = provincesOf(s, f).filter((p) => !p.siege);
  if (!own.length) return;
  const maxArmies = fac.ai === 'major' ? Math.min(7, 1 + Math.floor(own.length / 6)) : Math.min(2, 1 + Math.floor(own.length / 4));
  for (let guard = 0; guard < 30; guard++) {
    const type = pickType(s, f);
    const cost = UNIT_STATS[type].cost;
    if (s.gold[f] < cost + 10) break;
    // Recruits join armies resting in friendly towns.
    const resting = s.armies.filter((a) => a.owner === f && a.siegeOf < 0 && townAt(s, a) >= 0
      && s.provinces[townAt(s, a)].owner === f && a.units.length < MAX_UNITS);
    let target = resting.sort((a, b) => a.units.length - b.units.length)[0];
    const total = s.armies.filter((a) => a.owner === f).length;
    if ((!target || target.units.length >= 6) && total < maxArmies) {
      const spot = own.find((p) => p.capitalOf === f) ?? s.rng.pick(own);
      target = spawnArmy(s, f, spot.id, []);
    }
    if (!target) break;
    const town = townAt(s, target);
    if (UNIT_STATS[type].elite && (town < 0 || s.provinces[town].capitalOf !== f || eliteCount(s, f, type) >= ELITE_CAP)) continue;
    target.units.push(newUnit(type));
    s.gold[f] -= cost;
  }
}
