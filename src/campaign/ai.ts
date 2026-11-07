import { UNIT_STATS, type UnitType } from '../data';
import {
  type Army, armyAt, armyStrength, declareWar, factionStrength, type GameState, hostile, IND, isMonsoon,
  MAX_UNITS, newUnit, PLAYER, type Province, provincesOf, spawnArmy, unitsStrength, wallFactor,
} from './state';

export interface Controller {
  state: GameState;
  moveArmy(army: Army, target: number): Promise<void>;
  assault(army: Army, p: Province): Promise<void>;
}

export async function runAiTurn(c: Controller, f: number) {
  const s = c.state;
  const fac = s.factions[f];
  if (!fac.alive || fac.ai === 'none') return;
  maybeDeclareWar(s, f);
  aiRecruit(s, f);
  for (const army of s.armies.filter((a) => a.owner === f)) {
    if (s.over) return;
    if (!s.armies.includes(army)) continue;
    if (army.siegeOf >= 0) {
      await considerAssault(c, army);
      continue;
    }
    for (let guard = 0; guard < 3 && army.mp > 0 && army.siegeOf < 0 && s.armies.includes(army); guard++) {
      const t = chooseTarget(s, army);
      if (t < 0) break;
      const mp = army.mp;
      await c.moveArmy(army, t);
      if (army.mp >= mp) break;
    }
  }
}

async function considerAssault(c: Controller, army: Army) {
  const s = c.state;
  const p = s.provinces[army.siegeOf];
  if (!p.siege) return;
  const hasBreaker = army.units.some((u) => u.type === 'cannon' || u.type === 'elephant');
  const D = (unitsStrength(p.garrison) + 10) * wallFactor(p, army.units, p.siege.equipment);
  const ratio = armyStrength(army) / D;
  const ready = p.siege.equipment >= 1 || hasBreaker;
  // Starving them out is cheaper; storm only with a clear edge or when the siege drags on.
  if (p.garrison.length === 0 || (ready && ratio > 1.6) || (ready && p.siege.turns >= 4 && ratio > 1.1)) {
    await c.assault(army, p);
  }
}

function chooseTarget(s: GameState, army: Army): number {
  const fac = s.factions[army.owner];
  const here = s.provinces[army.province];
  const myStr = armyStrength(army);
  const monsoon = isMonsoon(s.turn);
  let best = -1;
  let bestScore = 0;
  for (const n of here.neighbors) {
    const p = s.provinces[n];
    const occ = armyAt(s, n);
    let score = 0;
    if (occ) {
      if (occ.owner === army.owner || !hostile(s, army.owner, occ.owner)) continue;
      const ratio = myStr / Math.max(1, armyStrength(occ) * 1.1);
      if (ratio < 1.3) continue;
      score = 60 + ratio * 5 + (p.owner === army.owner ? 40 : 0); // driving off besiegers matters most
    } else {
      if (p.owner === army.owner || !hostile(s, army.owner, p.owner)) continue;
      if (monsoon) continue; // nobody starts a siege in the rains
      if (fac.ai === 'minor' && !s.rng.chance(fac.aggression)) continue;
      if (p.owner === IND && !s.rng.chance(0.2 + fac.aggression * 0.3)) continue;
      const G = (unitsStrength(p.garrison) + 10) * wallFactor(p, army.units, 0);
      if (myStr < G * 0.8) continue;
      score = 45 + p.wealth * 3 + (p.capitalOf >= 0 ? 30 : 0) + (p.owner === PLAYER ? 12 : 0) - p.walls * 4;
    }
    score += s.rng.next() * 10;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  if (best >= 0) return best;
  if (fac.ai !== 'major' || myStr < 150) return -1;
  return stepTowardFront(s, army);
}

/** First step (through own land) toward the nearest province of an enemy at war. */
function stepTowardFront(s: GameState, army: Army): number {
  const prev = new Map<number, number>([[army.province, -1]]);
  const queue = [army.province];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of s.provinces[cur].neighbors) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      const owner = s.provinces[n].owner;
      if (owner !== army.owner && owner !== IND && hostile(s, army.owner, owner)) {
        let step = cur;
        if (step === army.province) return -1;
        while (prev.get(step) !== army.province) step = prev.get(step)!;
        const occ = armyAt(s, step);
        if (occ && (occ.owner !== army.owner || occ.units.length + army.units.length > MAX_UNITS)) return -1;
        return step;
      }
      if (owner === army.owner) queue.push(n);
    }
  }
  return -1;
}

function maybeDeclareWar(s: GameState, f: number) {
  const fac = s.factions[f];
  if (fac.ai !== 'major' || !s.rng.chance(0.04 * fac.aggression)) return;
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

function aiRecruit(s: GameState, f: number) {
  const fac = s.factions[f];
  const own = provincesOf(s, f).filter((p) => !p.siege);
  if (!own.length) return;
  const maxArmies = fac.ai === 'major' ? Math.min(7, 1 + Math.floor(own.length / 6)) : Math.min(2, 1 + Math.floor(own.length / 4));
  for (let guard = 0; guard < 30; guard++) {
    const type = pickType(s, f);
    const cost = UNIT_STATS[type].cost;
    if (s.gold[f] < cost + 10) break;
    const mine = s.armies.filter((a) => a.owner === f && s.provinces[a.province].owner === f && a.siegeOf < 0);
    let target = mine.filter((a) => a.units.length < MAX_UNITS).sort((a, b) => a.units.length - b.units.length)[0];
    const total = s.armies.filter((a) => a.owner === f).length;
    if ((!target || target.units.length >= 6) && total < maxArmies) {
      const spot = own.find((p) => p.capitalOf === f && !armyAt(s, p.id)) ?? own.find((p) => !armyAt(s, p.id));
      if (spot) {
        target = spawnArmy(s, f, spot.id, []);
        target.mp = 0;
      }
    }
    if (!target) break;
    target.units.push(newUnit(type));
    s.gold[f] -= cost;
  }
}
