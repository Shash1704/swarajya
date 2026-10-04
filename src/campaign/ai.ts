import { UNIT_STATS, type UnitType } from '../data';
import { type Army, armyAt, armyStrength, type GameState, MAX_UNITS, NEUTRAL, newUnit, spawnArmy } from './state';

export interface Mover {
  state: GameState;
  attemptMove(army: Army, target: number): Promise<void>;
}

export async function runAiTurn(m: Mover, f: number) {
  const s = m.state;
  if (!s.factions[f].alive) return;
  aiRecruit(s, f);
  for (const army of s.armies.filter((a) => a.owner === f)) {
    if (s.over) return;
    if (!s.armies.includes(army) || army.moved) continue;
    const target = chooseTarget(s, army);
    if (target >= 0) await m.attemptMove(army, target);
  }
}

function chooseTarget(s: GameState, army: Army): number {
  const here = s.provinces[army.province];
  const myStr = armyStrength(army);
  let best = -1;
  let bestScore = 0;
  for (const n of here.neighbors) {
    const p = s.provinces[n];
    const occ = armyAt(s, n);
    let score: number;
    if (occ && occ.owner === army.owner) continue;
    if (occ) {
      const ratio = myStr / Math.max(1, armyStrength(occ) * 1.15);
      if (ratio < 1.25) continue;
      score = 40 + ratio * 5;
    } else if (p.owner !== army.owner) {
      score = 50;
    } else {
      continue;
    }
    score += p.income * 3 + (p.capitalOf >= 0 ? 25 : 0) + (p.owner === NEUTRAL ? 0 : 8) + s.rng.next() * 10;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  if (best >= 0) return best;
  if (myStr < 80) return -1; // too weak to go anywhere; wait for reinforcements
  return stepTowardFrontier(s, army);
}

/** BFS through own territory to the nearest foreign province; returns the first step, or -1. */
function stepTowardFrontier(s: GameState, army: Army): number {
  const prev = new Map<number, number>([[army.province, -1]]);
  const queue = [army.province];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of s.provinces[cur].neighbors) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (s.provinces[n].owner !== army.owner) {
        let step = cur;
        if (step === army.province) return -1; // frontier is adjacent but we chose not to attack
        while (prev.get(step) !== army.province) step = prev.get(step)!;
        const occ = armyAt(s, step);
        if (occ && occ.units.length + army.units.length > MAX_UNITS) return -1;
        return step;
      }
      queue.push(n);
    }
  }
  return -1;
}

function pickType(s: GameState): UnitType {
  const r = s.rng.next();
  return r < 0.45 ? 'spear' : r < 0.75 ? 'archer' : 'knight';
}

function aiRecruit(s: GameState, f: number) {
  const own = s.provinces.filter((p) => p.owner === f);
  for (let guard = 0; guard < 40; guard++) {
    const type = pickType(s);
    const cost = UNIT_STATS[type].cost;
    if (s.gold[f] < cost + 4) break;
    const mine = s.armies.filter((a) => a.owner === f);
    const allFull = mine.every((a) => a.units.length >= MAX_UNITS);
    const wantNewArmy = mine.length < 1 + Math.floor(own.length / 4) || (allFull && s.gold[f] >= 60);
    let target: Army | undefined;
    if (wantNewArmy) {
      const spot = own.find((p) => p.capitalOf === f && !armyAt(s, p.id)) ?? own.find((p) => !armyAt(s, p.id));
      if (spot) target = spawnArmy(s, f, spot.id, []);
    }
    if (!target) {
      target = mine.filter((a) => a.units.length < MAX_UNITS).sort((a, b) => a.units.length - b.units.length)[0];
    }
    if (!target) break;
    target.units.push(newUnit(type));
    s.gold[f] -= cost;
  }
}
