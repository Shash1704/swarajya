import { ELITE_CAP, isBreaker, UNIT_STATS, type UnitType } from '../data';
import {
  type Army, armyById, armyStrength, declareWar, dist, eliteCount, factionStrength, type GameState, type Goal,
  hostile, IND, isMonsoon, MAX_UNITS, nearestOwned, newUnit, PLAYER, provinceUnder, provincesOf, setGoal,
  siegeEquipment, spawnArmy, townAt, unitsStrength, wallFactor, manpowerRatio, levyFraction,
} from './state';
import { supplied, warBlocked } from './realm';
import { FRONT_RANGE, isYours, type Province, villageBurnt, villageOwner } from './state';

/** Is this point on the army's own front (armies without a front go anywhere)? */
const onFront = (s: GameState, a: Army, p: { x: number; y: number }) => a.front === undefined || dist(s.provinces[a.front], p) < FRONT_RANGE;

/** Is this army already busy against the player's realm? */
function againstPlayer(s: GameState, o: Army): boolean {
  const g = o.goal;
  if (o.siegeOf >= 0 && s.provinces[o.siegeOf].owner === PLAYER) return true;
  if (!g) return false;
  if (g.kind === 'chase') return armyById(s, g.army)?.owner === PLAYER;
  if (g.kind === 'siege' || g.kind === 'raid') return s.provinces[g.prov].owner === PLAYER;
  return false;
}

/**
 * May another of this realm's armies go after the player? A realm sends no more armies against
 * the Marathas than about half as many as the Marathas field, so no one front is swamped.
 */
function pressureOk(s: GameState, a: Army): boolean {
  if (a.owner === PLAYER) return true;
  const theirs = s.armies.filter((o) => o.owner === PLAYER);
  const already = s.armies.filter((o) => o !== a && o.owner === a.owner && againstPlayer(s, o));
  // By number: about one army for every two the Marathas field (at least one).
  if (already.length >= Math.max(1, Math.ceil(theirs.length / 2))) return false;
  // By weight: no more than somewhat over the Marathas' own strength (field armies and garrisons),
  // so a young Swarajya faces a fight it can win, and the full weight of the empire only as it grows.
  const sent = already.reduce((n, o) => n + armyStrength(o), 0);
  const garrisons = provincesOf(s, PLAYER).reduce((n, p) => n + unitsStrength(p.garrison), 0);
  return sent + armyStrength(a) <= (theirs.reduce((n, o) => n + armyStrength(o), 0) + garrisons * 0.5) * 1.4 + 400;
}

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
    // Starving before the walls: storm now or give it up.
    if (a.food < 3) {
      const p = s.provinces[a.siegeOf];
      const D = (unitsStrength(p.garrison) + 10) * wallFactor(p, a.units, p.siege ? siegeEquipment(p.siege) : 0);
      if (armyStrength(a) > D * 1.05) w.assault(a);
      else {
        const home = nearestOwned(s, a);
        if (home >= 0) setGoal(s, a, { kind: 'go', prov: home });
      }
      return;
    }
    considerAssault(w, a);
    return;
  }
  // Wagons nearly empty in enemy country: fall back to our own lands to eat.
  if (a.food < 6 && supplied(s, a) === 'none') {
    const home = nearestOwned(s, a);
    if (home >= 0 && !(a.goal?.kind === 'go' && a.goal.prov === home)) setGoal(s, a, { kind: 'go', prov: home });
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
  const exhausted = manpowerRatio(s, a.owner) < 0.2;

  // Small armies close together join up instead of being beaten one at a time.
  if (a.units.length < 12) {
    const friend = s.armies
      .filter((o) => o !== a && o.owner === a.owner && o.siegeOf < 0 && dist(a, o) < 90
        && o.units.length >= a.units.length && o.units.length + a.units.length <= MAX_UNITS)
      .sort((x, y) => dist(a, x) - dist(a, y))[0];
    if (friend) {
      setGoal(s, a, { kind: 'join', army: friend.id });
      return;
    }
  }

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
  const mayHitPlayer = pressureOk(s, a);
  // The Raje's commanders fight the Maratha way: they pick their fights and raid rather than storm.
  const maratha = a.owner === PLAYER;
  const odds = maratha ? 1.8 : 1.4;
  const prey = enemies
    .filter((e) => dist(a, e) < reach && str > armyStrength(e) * odds && s.day >= e.safeUntil && onFront(s, a, e)
      && (e.owner !== PLAYER || mayHitPlayer)
      && (fac.ai === 'major' || s.provinces[provinceUnder(s, e, e.node)].owner === a.owner))
    .sort((x, y) => dist(a, x) - dist(a, y))[0];
  if (prey && !exhausted) {
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

  // Sack a village: quick plunder in enemy country (the Marathas' favourite war, but everyone does it).
  // It brings the owner's armies down on the raiders, so only where none stronger is close by.
  const village = s.rng.chance(maratha ? 0.5 : 0.3) && !isMonsoon(s.day) ? s.villages
    .filter((v) => !villageBurnt(s, v) && hostile(s, a.owner, villageOwner(s, v)) && dist(a, v) < 200 && onFront(s, a, v)
      && (villageOwner(s, v) !== PLAYER || mayHitPlayer)
      && !s.armies.some((e) => hostile(s, e.owner, a.owner) && dist(e, v) < 80 && armyStrength(e) > str * 0.7))
    .sort((x, y) => (dist(a, x) - x.wealth * 6) - (dist(a, y) - y.wealth * 6))[0] : undefined;
  if (village) {
    setGoal(s, a, { kind: 'sack', village: village.id });
    return;
  }

  // Ganimi kava: Maratha armies raid enemy country more often than they lay sieges.
  if (maratha && !isMonsoon(s.day) && s.rng.chance(0.55)) {
    const loot = s.provinces
      .filter((p) => p.owner !== IND && hostile(s, a.owner, p.owner) && p.devastated <= 0 && dist(a, p) < 220)
      .filter((p) => !s.armies.some((e) => e.owner === p.owner && dist(e, p) < 60 && armyStrength(e) > str * 0.8))
      .sort((x, y) => y.wealth - x.wealth)[0];
    if (loot) {
      setGoal(s, a, { kind: 'raid', prov: loot.id });
      return;
    }
  }

  // Conquest: pick a town worth taking that we can actually take.
  if (fac.ai === 'major' && !isMonsoon(s.day) && !exhausted) {
    let best = -1;
    let bestScore = -Infinity;
    for (const p of s.provinces) {
      if (!hostile(s, a.owner, p.owner) || p.siege) continue;
      const d = dist(a, p);
      if (d > 480 || !onFront(s, a, p) || (p.owner === PLAYER && !mayHitPlayer)) continue;
      const G = (unitsStrength(p.garrison) + 10) * wallFactor(p, a.units, 0);
      if (str < G * (maratha ? 1.7 : 1.3)) continue;
      let score = (p.owner === IND ? 45 : 60) + p.wealth * 3 + (p.capitalOf >= 0 ? 30 : 0) + (p.owner === PLAYER ? 12 : 0) - p.walls * 4 - d / 12 + s.rng.next() * 10;
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

  // No town worth a siege: plunder an enemy province nearby instead.
  if (fac.ai === 'major' && !isMonsoon(s.day) && !exhausted && s.rng.chance(0.5)) {
    const loot = s.provinces
      .filter((p) => p.owner !== IND && hostile(s, a.owner, p.owner) && p.devastated <= 0 && dist(a, p) < 160
        && onFront(s, a, p) && (p.owner !== PLAYER || mayHitPlayer))
      .sort((x, y) => y.wealth - x.wealth)[0];
    if (loot) {
      setGoal(s, a, { kind: 'raid', prov: loot.id });
      return;
    }
  }

  // Far from its own front: march back to it.
  if (a.front !== undefined && !onFront(s, a, a)) {
    const base = s.provinces.filter((p: Province) => p.owner === a.owner && !p.siege)
      .sort((p, q) => dist(p, s.provinces[a.front!]) - dist(q, s.provinces[a.front!]))[0];
    if (base && townAt(s, a) !== base.id) {
      setGoal(s, a, { kind: 'go', prov: base.id });
      return;
    }
  }

  // Nothing worth taking in reach: no army sits still. Move up towards the nearest enemy
  // ground on its front, or else ride a circuit of its own towns, showing the flag.
  const enemyGround = s.provinces
    .filter((p) => hostile(s, a.owner, p.owner) && (p.owner !== PLAYER || mayHitPlayer) && onFront(s, a, p))
    .sort((x, y) => dist(a, x) - dist(a, y))[0];
  if (enemyGround && dist(a, enemyGround) > 60) {
    const base = s.provinces.filter((p) => p.owner === a.owner && !p.siege)
      .sort((x, y) => dist(x, enemyGround) - dist(y, enemyGround))[0];
    if (base && townAt(s, a) !== base.id) {
      setGoal(s, a, { kind: 'go', prov: base.id });
      return;
    }
  }
  const circuit = s.provinces.filter((p) => p.owner === a.owner && !p.siege && townAt(s, a) !== p.id && onFront(s, a, p) && dist(a, p) < 260);
  if (circuit.length) {
    setGoal(s, a, { kind: 'go', prov: s.rng.pick(circuit).id });
    return;
  }
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
  if (g.kind === 'sack') {
    const v = s.villages[g.village];
    return !!v && !villageBurnt(s, v) && hostile(s, a.owner, villageOwner(s, v));
  }
  return (g.kind === 'go' || g.kind === 'point') && a.route.length > 0;
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

/** The Raje's own monthly recruiting for his commanders' armies (the player's realm runs no other AI). */
export function realmRecruit(s: GameState) {
  recruit(s, PLAYER);
}

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
    && !warBlocked(s, f, o) && factionStrength(s, o) < mine * (s.relations[f][o] < -30 ? 0.9 : 0.7));
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
  // The Raje's treasury pays for his commanders' armies, but leaves a reserve for you.
  const reserve = f === PLAYER ? 220 : 0;
  if (!own.length) return;
  const maxArmies = fac.ai === 'major' ? Math.min(7, 1 + Math.floor(own.length / 6)) : Math.min(2, 1 + Math.floor(own.length / 4));
  for (let guard = 0; guard < 30; guard++) {
    const type = pickType(s, f);
    const cost = UNIT_STATS[type].cost;
    if (s.gold[f] < cost + 10 + reserve) break;
    // Recruits join armies resting in friendly towns.
    const resting = s.armies.filter((a) => a.owner === f && !isYours(s, a) && a.siegeOf < 0 && townAt(s, a) >= 0
      && s.provinces[townAt(s, a)].owner === f && a.units.length < MAX_UNITS);
    let target = resting.sort((a, b) => a.units.length - b.units.length)[0];
    const total = s.armies.filter((a) => a.owner === f && !isYours(s, a)).length;
    if ((!target || target.units.length >= 6) && total < maxArmies) {
      const spot = own.find((p) => p.capitalOf === f) ?? s.rng.pick(own);
      target = spawnArmy(s, f, spot.id, []);
    }
    if (!target) break;
    const town = townAt(s, target);
    if (UNIT_STATS[type].elite && (town < 0 || s.provinces[town].capitalOf !== f || eliteCount(s, f, type) >= ELITE_CAP)) continue;
    // Raised from the realm's manpower, at whatever strength it can still muster.
    const levy = levyFraction(s, f, type);
    if (levy <= 0) break;
    const u = newUnit(type, Math.max(0.3, levy * s.rng.range(0.75, 1)));
    target.units.push(u);
    s.manpower[f] -= u.men;
    s.gold[f] -= cost;
  }
}
