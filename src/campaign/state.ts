import { RNG } from '../rng';
import { CELL, generateMap, type MapData } from './mapgen';
import { FACTION_DEFS, PROVINCE_NAMES, UNIT_STATS, type UnitType } from '../data';

export const PLAYER = 0;
export const NEUTRAL = 4;
export const MAX_UNITS = 10;

export interface CUnit {
  type: UnitType;
  men: number;
}

export interface Army {
  id: number;
  owner: number;
  province: number;
  units: CUnit[];
  moved: boolean;
}

export interface Province {
  id: number;
  name: string;
  /** Label anchor in screen pixels. */
  lx: number;
  ly: number;
  cells: number;
  neighbors: number[];
  income: number;
  owner: number;
  /** Faction id whose capital this is, or -1. */
  capitalOf: number;
}

export interface Faction {
  id: number;
  name: string;
  color: string;
  rgb: [number, number, number];
  isMajor: boolean;
  alive: boolean;
}

export interface GameState {
  seed: number;
  turn: number;
  map: MapData;
  provinces: Province[];
  armies: Army[];
  factions: Faction[];
  gold: number[];
  nextArmyId: number;
  log: string[];
  rng: RNG;
  over: null | 'won' | 'lost';
}

export function newUnit(type: UnitType, frac = 1): CUnit {
  return { type, men: Math.round(UNIT_STATS[type].maxMen * frac) };
}

export function newGame(seed: number): GameState {
  const rng = new RNG(seed);
  const { map, shapes } = generateMap(seed);
  const names = rng.shuffle(PROVINCE_NAMES.slice());
  const provinces: Province[] = shapes.map((s, i) => ({
    id: i,
    name: names[i % names.length],
    lx: s.lx * CELL + CELL / 2,
    ly: s.ly * CELL + CELL / 2,
    cells: s.cells,
    neighbors: s.neighbors,
    income: rng.int(2, 5),
    owner: NEUTRAL,
    capitalOf: -1,
  }));
  const factions: Faction[] = FACTION_DEFS.map((d, i) => ({
    id: i, name: d.name, color: d.color, rgb: d.rgb, isMajor: i !== NEUTRAL, alive: true,
  }));

  // Capitals: farthest-point sampling so the four realms start apart.
  const dist2 = (a: Province, b: Province) => (a.lx - b.lx) ** 2 + (a.ly - b.ly) ** 2;
  const candidates = provinces.filter((p) => p.neighbors.length >= 2);
  const caps: Province[] = [rng.pick(candidates)];
  while (caps.length < 4) {
    let best = candidates[0];
    let bestD = -1;
    for (const p of candidates) {
      if (caps.includes(p)) continue;
      const d = Math.min(...caps.map((c) => dist2(c, p)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    caps.push(best);
  }
  caps.forEach((p, f) => {
    p.owner = f;
    p.capitalOf = f;
    p.income += 3;
  });

  // Each realm starts with its capital plus up to three nearby provinces.
  for (let round = 0; round < 3; round++) {
    for (let f = 0; f < 4; f++) {
      let best: Province | null = null;
      let bestD = Infinity;
      for (const p of provinces) {
        if (p.owner !== NEUTRAL) continue;
        if (!p.neighbors.some((n) => provinces[n].owner === f)) continue;
        const d = dist2(p, caps[f]);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) best.owner = f;
    }
  }

  const state: GameState = {
    seed, turn: 1, map, provinces, armies: [], factions,
    gold: [80, 80, 80, 80, 0], nextArmyId: 1, log: [], rng, over: null,
  };
  for (let f = 0; f < 4; f++) {
    spawnArmy(state, f, caps[f].id, [newUnit('spear'), newUnit('spear'), newUnit('archer'), newUnit('knight')]);
  }
  for (const p of provinces) {
    if (p.owner !== NEUTRAL || !rng.chance(0.65)) continue;
    const units = [newUnit('spear', 0.8)];
    if (rng.chance(0.6)) units.push(newUnit('archer', 0.8));
    if (rng.chance(0.35)) units.push(newUnit('spear', 0.8));
    spawnArmy(state, NEUTRAL, p.id, units);
  }
  log(state, `You rule the ${factions[PLAYER].name}. Unite the realm under your banner!`);
  return state;
}

export function spawnArmy(state: GameState, owner: number, province: number, units: CUnit[]): Army {
  const a: Army = { id: state.nextArmyId++, owner, province, units, moved: false };
  state.armies.push(a);
  return a;
}

export function armyAt(state: GameState, prov: number): Army | undefined {
  return state.armies.find((a) => a.province === prov);
}

export function armyMen(a: Army): number {
  return a.units.reduce((s, u) => s + u.men, 0);
}

export function armyStrength(a: Army): number {
  return a.units.reduce((s, u) => s + u.men * UNIT_STATS[u.type].value, 0);
}

export function provinceIncome(state: GameState, f: number): number {
  return state.provinces.reduce((s, p) => s + (p.owner === f ? p.income : 0), 0);
}

export function upkeep(state: GameState, f: number): number {
  const units = state.armies.reduce((s, a) => s + (a.owner === f ? a.units.length : 0), 0);
  return Math.floor(units * 0.5);
}

export function netIncome(state: GameState, f: number): number {
  return provinceIncome(state, f) - upkeep(state, f);
}

export function log(state: GameState, msg: string) {
  state.log.push(`T${state.turn} · ${msg}`);
  if (state.log.length > 80) state.log.shift();
}

/** Drops shattered regiments (< 5 men) and empty armies. */
export function cleanupArmies(state: GameState) {
  for (const a of state.armies) a.units = a.units.filter((u) => u.men >= 5);
  state.armies = state.armies.filter((a) => a.units.length > 0);
}

export function capture(state: GameState, provId: number, owner: number) {
  const p = state.provinces[provId];
  const prev = p.owner;
  if (prev === owner) return;
  p.owner = owner;
  const f = state.factions;
  log(state, `${f[owner].name} takes ${p.name}${p.capitalOf >= 0 ? ' (a capital!)' : ''}.`);
  if (prev !== NEUTRAL && !state.provinces.some((q) => q.owner === prev)) {
    f[prev].alive = false;
    state.armies = state.armies.filter((a) => a.owner !== prev);
    log(state, `The ${f[prev].name} has fallen.`);
  }
  checkOver(state);
}

export function checkOver(state: GameState) {
  const f = state.factions;
  if (!f[PLAYER].alive) state.over = 'lost';
  else if (!f.some((x) => x.isMajor && x.alive && x.id !== PLAYER)) state.over = 'won';
}

/** A defeated defender falls back to a friendly neighbour, or is destroyed if cut off. */
export function retreat(state: GameState, army: Army) {
  const from = state.provinces[army.province];
  const options = from.neighbors.filter((n) => {
    if (state.provinces[n].owner !== army.owner) return false;
    const occ = armyAt(state, n);
    return !occ || (occ.owner === army.owner && occ.units.length + army.units.length <= MAX_UNITS);
  });
  const name = state.factions[army.owner].name;
  if (army.owner === NEUTRAL || options.length === 0) {
    state.armies = state.armies.filter((a) => a !== army);
    log(state, `The ${name} army at ${from.name} is cut off and destroyed.`);
    return;
  }
  const dest = options[0];
  const occ = armyAt(state, dest);
  if (occ) {
    occ.units.push(...army.units);
    state.armies = state.armies.filter((a) => a !== army);
  } else {
    army.province = dest;
  }
  log(state, `The ${name} army retreats to ${state.provinces[dest].name}.`);
}

/** Quick statistical battle. Mutates casualties; returns true if the attacker won. */
export function autoResolve(state: GameState, att: Army, def: Army): boolean {
  const rng = state.rng;
  const A = armyStrength(att) * rng.range(0.85, 1.15);
  const D = armyStrength(def) * 1.15 * rng.range(0.85, 1.15);
  const attWon = rng.next() < (A * A) / (A * A + D * D);
  const [w, l, ws, ls] = attWon ? [att, def, A, D] : [def, att, D, A];
  const wLoss = Math.min(0.5, (0.25 * ls) / Math.max(1, ws));
  const lLoss = rng.range(0.35, 0.6);
  for (const u of w.units) u.men = Math.floor(u.men * (1 - wLoss));
  for (const u of l.units) u.men = Math.floor(u.men * (1 - lLoss));
  return attWon;
}

export function startTurn(state: GameState) {
  state.turn++;
  for (const f of state.factions) {
    if (!f.alive || !f.isMajor) continue;
    state.gold[f.id] = Math.max(0, state.gold[f.id] + netIncome(state, f.id));
  }
  for (const a of state.armies) {
    a.moved = false;
    // Armies resting in friendly land recover some men.
    if (state.provinces[a.province].owner === a.owner) {
      for (const u of a.units) {
        const max = UNIT_STATS[u.type].maxMen;
        u.men = Math.min(max, u.men + Math.ceil(max * 0.1));
      }
    }
  }
}
