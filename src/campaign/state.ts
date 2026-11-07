import { RNG } from '../rng';
import { generateMap, type MapData } from './mapgen';
import { FACTION_DEFS, SEASONS, START_YEAR, UNIT_STATS, type FactionDef, type UnitType } from '../data';
import { PROVINCES, type Kind } from '../india';

export const PLAYER = 0;
export const IND = FACTION_DEFS.length - 1;
export const MAX_UNITS = 12;

export interface CUnit {
  type: UnitType;
  men: number;
}

export interface Army {
  id: number;
  owner: number;
  province: number;
  units: CUnit[];
  /** Moves left this turn. */
  mp: number;
  raided: boolean;
  /** Province this army is besieging, or -1. */
  siegeOf: number;
}

export interface Siege {
  army: number;
  turns: number;
  /** 0 none, 1 ladders, 2 ladders and a ram. */
  equipment: number;
  /** Turn of the last assault (one per turn). */
  lastAssault: number;
}

export interface Province {
  id: number;
  key: string;
  name: string;
  town: string;
  region: string;
  kind: Kind;
  sea: boolean;
  /** Settlement position in world pixels. */
  x: number;
  y: number;
  cells: number;
  neighbors: number[];
  walls: number;
  wealth: number;
  owner: number;
  capitalOf: number;
  garrison: CUnit[];
  supplies: number;
  siege: Siege | null;
  /** Turns of devastation left (no income while > 0). */
  devastated: number;
  baseWealth: number;
  /** Last turn something was built here (one project per turn). */
  builtTurn: number;
}

export interface Faction extends FactionDef {
  id: number;
  alive: boolean;
}

export interface LogEntry {
  turn: number;
  text: string;
  /** Concerns the player directly (shown highlighted). */
  mine: boolean;
}

export interface GameState {
  seed: number;
  turn: number;
  map: MapData;
  provinces: Province[];
  armies: Army[];
  factions: Faction[];
  gold: number[];
  war: boolean[][];
  ally: boolean[][];
  warSince: number[][];
  nextArmyId: number;
  log: LogEntry[];
  rng: RNG;
  over: null | 'won' | 'lost';
}

export const VICTORY_PROVINCES = 35;

// ---------------------------------------------------------------- setup

export function newUnit(type: UnitType, frac = 1): CUnit {
  return { type, men: Math.max(1, Math.round(UNIT_STATS[type].maxMen * frac)) };
}

const fid = (key: string) => FACTION_DEFS.findIndex((f) => f.key === key);

export function newGame(seed: number): GameState {
  const rng = new RNG(seed);
  const { map, shapes } = generateMap(seed);
  const factions: Faction[] = FACTION_DEFS.map((d, i) => ({ ...d, id: i, alive: true }));
  const provinces: Province[] = PROVINCES.map((d, i) => {
    const owner = fid(d.owner);
    const p: Province = {
      id: i, key: d.key, name: d.name, town: d.town, region: d.region, kind: d.kind, sea: !!d.sea,
      x: shapes[i].x, y: shapes[i].y, cells: shapes[i].cells, neighbors: shapes[i].neighbors,
      walls: d.walls, wealth: d.wealth, owner, capitalOf: factions[owner].capital === d.key ? owner : -1,
      garrison: [], supplies: 0, siege: null, devastated: 0, baseWealth: d.wealth, builtTurn: 0,
    };
    p.supplies = maxSupplies(p);
    p.garrison = garrisonFor(factions[owner], p, 0.8);
    return p;
  });

  const n = factions.length;
  const grid = <T,>(v: T) => Array.from({ length: n }, () => new Array<T>(n).fill(v));
  const state: GameState = {
    seed, turn: 1, map, provinces, armies: [], factions,
    gold: factions.map((f) => (f.id === PLAYER ? 150 : 100)),
    war: grid(false), ally: grid(false), warSince: grid(0),
    nextArmyId: 1, log: [], rng, over: null,
  };

  const setWar = (a: string, b: string) => {
    state.war[fid(a)][fid(b)] = state.war[fid(b)][fid(a)] = true;
  };
  setWar('mar', 'mug');
  setWar('mar', 'sid');
  setWar('mug', 'aho');
  state.ally[fid('mug')][fid('sid')] = state.ally[fid('sid')][fid('mug')] = true;

  const army = (key: string, units: [UnitType, number][]) => {
    const p = provinces.find((q) => q.key === key)!;
    const list: CUnit[] = [];
    for (const [t, count] of units) for (let i = 0; i < count; i++) list.push(newUnit(t));
    spawnArmy(state, p.owner, p.id, list);
  };
  army('raigad', [['mavala', 3], ['lightcav', 2], ['archer', 1], ['musket', 1]]);
  army('javli', [['mavala', 2], ['lightcav', 2]]);
  army('aurangabad', [['heavycav', 2], ['spear', 2], ['musket', 2], ['elephant', 1], ['horsearcher', 1], ['cannon', 1]]);
  army('ahmednagar', [['spear', 2], ['musket', 1], ['heavycav', 1]]);
  army('delhi', [['heavycav', 3], ['spear', 3], ['musket', 2], ['elephant', 2], ['horsearcher', 2]]);
  army('ahmedabad', [['heavycav', 2], ['spear', 2], ['archer', 2]]);
  army('dhaka', [['spear', 3], ['musket', 2], ['heavycav', 1], ['elephant', 1], ['cannon', 1]]);
  army('lahore', [['heavycav', 2], ['horsearcher', 2], ['spear', 2]]);
  army('bijapur', [['spear', 3], ['musket', 2], ['heavycav', 2], ['elephant', 1], ['cannon', 1]]);
  army('bangalore', [['spear', 2], ['lightcav', 2], ['archer', 1]]);
  army('golconda', [['spear', 3], ['musket', 2], ['heavycav', 2], ['elephant', 1]]);
  army('amber', [['heavycav', 3], ['spear', 2], ['archer', 1]]);
  army('marwar', [['heavycav', 2], ['spear', 2]]);
  army('mysore', [['spear', 2], ['rocket', 1], ['lightcav', 1]]);
  army('madurai', [['spear', 3], ['archer', 1], ['elephant', 1]]);
  army('garhgaon', [['spear', 3], ['archer', 2], ['musket', 1]]);
  army('kamrup', [['spear', 2], ['archer', 1], ['musket', 1]]);

  for (const a of state.armies) a.mp = movePoints(state, a);
  log(state, 'Winter 1670. Shivaji resolves to retake the forts surrendered at Purandar. Kondhana (Sinhagad) looms over Pune.', true);
  return state;
}

export function spawnArmy(state: GameState, owner: number, province: number, units: CUnit[]): Army {
  const a: Army = { id: state.nextArmyId++, owner, province, units, mp: 0, raided: false, siegeOf: -1 };
  state.armies.push(a);
  return a;
}

export function maxSupplies(p: Province): number {
  return 2 + p.walls * 2 + (p.sea ? 2 : 0) + (p.capitalOf >= 0 ? 1 : 0);
}

export function garrisonCap(p: Province): number {
  return [1, 2, 3, 3][p.walls] + (p.capitalOf >= 0 ? 2 : 0) + (p.wealth >= 10 ? 1 : 0);
}

export function garrisonFor(f: FactionDef, p: Province, frac: number): CUnit[] {
  const out: CUnit[] = [];
  for (let i = 0; i < garrisonCap(p); i++) out.push(newUnit(f.garrison[i % f.garrison.length], frac));
  return out;
}

// ---------------------------------------------------------------- queries

export const seasonOf = (turn: number) => SEASONS[(turn - 1) % 4];
export const yearOf = (turn: number) => START_YEAR + Math.floor((turn - 1) / 4);
export const dateLabel = (turn: number) => `${seasonOf(turn)} ${yearOf(turn)}`;
export const isMonsoon = (turn: number) => seasonOf(turn) === 'Monsoon';

export function armyAt(state: GameState, prov: number): Army | undefined {
  return state.armies.find((a) => a.province === prov);
}

export function unitsMen(units: CUnit[]): number {
  return units.reduce((s, u) => s + u.men, 0);
}

export function unitsStrength(units: CUnit[]): number {
  return units.reduce((s, u) => s + u.men * UNIT_STATS[u.type].value, 0);
}

export function armyStrength(a: Army): number {
  return unitsStrength(a.units);
}

export function factionStrength(state: GameState, f: number): number {
  return state.armies.reduce((s, a) => s + (a.owner === f ? armyStrength(a) : 0), 0);
}

/** Can faction a's armies attack faction b? Independents are fair game for anyone. */
export function hostile(state: GameState, a: number, b: number): boolean {
  if (a === b) return false;
  if (a === IND || b === IND) return true;
  return state.war[a][b];
}

export function movePoints(state: GameState, a: Army): number {
  if (isMonsoon(state.turn)) return 1;
  const allHorse = a.units.length > 0 && a.units.every((u) => UNIT_STATS[u.type].cls === 'cavalry');
  return allHorse ? 2 : 1;
}

/** Regions wholly held by one faction, mapped to that faction. */
export function regionOwners(state: GameState): Map<string, number> {
  const owners = new Map<string, number>();
  for (const p of state.provinces) {
    const cur = owners.get(p.region);
    if (cur === undefined) owners.set(p.region, p.owner);
    else if (cur !== p.owner) owners.set(p.region, -1);
  }
  for (const [r, o] of owners) if (o < 0) owners.delete(r);
  return owners;
}

export function provinceIncome(state: GameState, p: Province, regions = regionOwners(state)): number {
  if (p.devastated > 0 || p.siege) return 0;
  return p.wealth * (regions.get(p.region) === p.owner ? 1.25 : 1);
}

export function upkeep(state: GameState, f: number): number {
  let u = 0;
  for (const a of state.armies) if (a.owner === f) for (const x of a.units) u += UNIT_STATS[x.type].upkeep;
  return Math.round(u);
}

export function grossIncome(state: GameState, f: number): number {
  const regions = regionOwners(state);
  let g = 0;
  for (const p of state.provinces) if (p.owner === f) g += provinceIncome(state, p, regions);
  return Math.round(g * state.factions[f].incomeMult);
}

export function netIncome(state: GameState, f: number): number {
  return grossIncome(state, f) - upkeep(state, f);
}

export function provincesOf(state: GameState, f: number): Province[] {
  return state.provinces.filter((p) => p.owner === f);
}

export function log(state: GameState, text: string, mine = false) {
  state.log.push({ turn: state.turn, text, mine });
  if (state.log.length > 150) state.log.shift();
}

// ---------------------------------------------------------------- diplomacy

export function declareWar(state: GameState, a: number, b: number) {
  if (a === b || state.war[a][b]) return;
  const f = state.factions;
  const pairs: [number, number][] = [[a, b]];
  for (let c = 0; c < f.length; c++) if (c !== a && state.ally[b][c] && f[c].alive) pairs.push([a, c]);
  for (const [x, y] of pairs) {
    state.war[x][y] = state.war[y][x] = true;
    state.warSince[x][y] = state.warSince[y][x] = state.turn;
    log(state, `${f[x].name} declares war on the ${f[y].name}.`, x === PLAYER || y === PLAYER);
  }
}

export function makePeace(state: GameState, a: number, b: number) {
  if (!state.war[a][b]) return;
  state.war[a][b] = state.war[b][a] = false;
  state.warSince[a][b] = state.warSince[b][a] = state.turn;
  // Armies standing in the other's land go home.
  for (const army of state.armies) {
    const owner = state.provinces[army.province].owner;
    if (!((army.owner === a && owner === b) || (army.owner === b && owner === a))) continue;
    if (army.siegeOf >= 0) liftSiege(state, state.provinces[army.siegeOf]);
    const home = nearestOwned(state, army.province, army.owner);
    if (home >= 0 && !armyAt(state, home)) army.province = home;
    else state.armies = state.armies.filter((x) => x !== army);
  }
  log(state, `Peace between the ${state.factions[a].name} and the ${state.factions[b].name}.`, a === PLAYER || b === PLAYER);
}

/** Would AI faction `ai` accept peace with `other` right now? */
export function acceptsPeace(state: GameState, ai: number, other: number): boolean {
  const turns = state.turn - state.warSince[ai][other];
  if (state.factions[ai].key === 'mug' && turns < 8) return false; // Aurangzeb does not bargain early
  const mine = factionStrength(state, ai) + 1;
  const theirs = factionStrength(state, other) + 1;
  if (theirs / mine > 1.4) return true;
  if (turns >= 10 && state.rng.chance(0.35)) return true;
  return turns >= 4 && theirs / mine > 0.9 && state.rng.chance(0.25);
}

function nearestOwned(state: GameState, from: number, owner: number): number {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur !== from && state.provinces[cur].owner === owner) return cur;
    for (const n of state.provinces[cur].neighbors) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return -1;
}

// ---------------------------------------------------------------- war on the map

export function cleanupArmies(state: GameState) {
  for (const a of state.armies) a.units = a.units.filter((u) => u.men >= 5);
  const dead = state.armies.filter((a) => a.units.length === 0);
  for (const a of dead) if (a.siegeOf >= 0) liftSiege(state, state.provinces[a.siegeOf]);
  state.armies = state.armies.filter((a) => a.units.length > 0);
  for (const p of state.provinces) p.garrison = p.garrison.filter((u) => u.men >= 5);
}

export function startSiege(state: GameState, army: Army, p: Province) {
  const climbers = army.units.some((u) => u.type === 'mavala');
  p.siege = { army: army.id, turns: 0, equipment: climbers ? 1 : 0, lastAssault: 0 };
  army.siegeOf = p.id;
  army.mp = 0;
  log(state, `The ${state.factions[army.owner].short} lay siege to ${p.town} (${p.name}).`,
    army.owner === PLAYER || p.owner === PLAYER);
}

export function liftSiege(state: GameState, p: Province) {
  if (!p.siege) return;
  const a = state.armies.find((x) => x.id === p.siege!.army);
  if (a) a.siegeOf = -1;
  p.siege = null;
}

export function capture(state: GameState, p: Province, owner: number) {
  const prev = p.owner;
  liftSiege(state, p);
  p.owner = owner;
  p.supplies = maxSupplies(p);
  p.garrison = [newUnit(state.factions[owner].garrison[0], 0.5)];
  const f = state.factions;
  log(state, `The ${f[owner].short} take ${p.town} (${p.name})${p.capitalOf >= 0 ? ', a royal capital!' : '.'}`,
    owner === PLAYER || prev === PLAYER);
  if (prev !== IND && !state.provinces.some((q) => q.owner === prev)) {
    f[prev].alive = false;
    state.armies = state.armies.filter((a) => a.owner !== prev);
    log(state, `The ${f[prev].name} is no more.`, true);
  }
  checkOver(state);
}

export function checkOver(state: GameState) {
  if (!state.factions[PLAYER].alive) state.over = 'lost';
  else {
    const delhi = state.provinces.find((p) => p.key === 'delhi')!;
    if (delhi.owner === PLAYER || provincesOf(state, PLAYER).length >= VICTORY_PROVINCES) state.over = 'won';
  }
}

/** Plunder the countryside around an enemy settlement (chauth). */
export function raid(state: GameState, army: Army): number {
  const p = state.provinces[army.province];
  const horse = army.units.filter((u) => UNIT_STATS[u.type].cls === 'cavalry').length / army.units.length;
  const gold = Math.round(p.wealth * (2 + horse * 2) * (p.devastated > 0 ? 0.3 : 1));
  state.gold[army.owner] += gold;
  p.devastated = Math.max(p.devastated, 3);
  army.raided = true;
  army.mp = 0;
  log(state, `The ${state.factions[army.owner].short} raid the lands of ${p.name} and carry off ${gold} gold.`,
    army.owner === PLAYER || p.owner === PLAYER);
  return gold;
}

/** Loot a freshly taken settlement: a fortune now, a ruin for years. */
export function sack(state: GameState, p: Province, by: number): number {
  const gold = Math.round(p.wealth * 8);
  state.gold[by] += gold;
  p.wealth = Math.max(1, Math.round(p.wealth * 0.6));
  p.devastated = 6;
  log(state, `${p.town} is sacked! ${gold} gold in plunder.`, by === PLAYER || p.owner === PLAYER);
  return gold;
}

/** A beaten defender falls back to a friendly neighbour, or is destroyed if cut off. */
export function retreat(state: GameState, army: Army) {
  const from = state.provinces[army.province];
  if (army.siegeOf >= 0) liftSiege(state, state.provinces[army.siegeOf]);
  const options = from.neighbors.filter((n) => {
    if (state.provinces[n].owner !== army.owner) return false;
    const occ = armyAt(state, n);
    return !occ || (occ.owner === army.owner && occ.units.length + army.units.length <= MAX_UNITS);
  });
  const name = state.factions[army.owner].short;
  if (army.owner === IND || options.length === 0) {
    state.armies = state.armies.filter((a) => a !== army);
    log(state, `The ${name} army at ${from.name} is cut off and destroyed.`, army.owner === PLAYER);
    return;
  }
  const dest = options[0];
  const occ = armyAt(state, dest);
  if (occ) {
    occ.units.push(...army.units);
    state.armies = state.armies.filter((a) => a !== army);
  } else {
    army.province = dest;
    army.mp = 0;
  }
  log(state, `The ${name} army falls back to ${state.provinces[dest].name}.`, army.owner === PLAYER);
}

function applyLosses(units: CUnit[], frac: number) {
  for (const u of units) u.men = Math.floor(u.men * (1 - frac));
}

/** Quick open-field battle. Mutates casualties; returns true if the attacker won. */
export function autoResolve(state: GameState, att: CUnit[], def: CUnit[]): boolean {
  const rng = state.rng;
  const A = unitsStrength(att) * rng.range(0.85, 1.15);
  const D = unitsStrength(def) * 1.1 * rng.range(0.85, 1.15);
  const won = rng.next() < (A * A) / (A * A + D * D);
  const [ws, ls] = won ? [A, D] : [D, A];
  applyLosses(won ? att : def, Math.min(0.5, (0.25 * ls) / Math.max(1, ws)));
  applyLosses(won ? def : att, rng.range(0.35, 0.6));
  return won;
}

/** How much the walls multiply the garrison's strength against this army. */
export function wallFactor(p: Province, attackers: CUnit[], equipment: number): number {
  if (p.walls <= 0) return 1;
  const has = (t: UnitType) => attackers.some((u) => u.type === t);
  let cut = Math.min(equipment, 2) * 0.15;
  if (has('cannon')) cut += 0.25;
  if (has('elephant')) cut += 0.1;
  if (has('mavala')) cut += 0.1;
  return Math.max(1.1, 1 + p.walls * (0.75 - cut));
}

/** Quick siege assault. Mutates casualties; returns true if the walls fell. */
export function autoResolveSiege(state: GameState, att: CUnit[], p: Province): boolean {
  const rng = state.rng;
  const eq = p.siege?.equipment ?? 0;
  const A = unitsStrength(att) * rng.range(0.85, 1.15);
  const D = (unitsStrength(p.garrison) + 10) * wallFactor(p, att, eq) * rng.range(0.85, 1.15);
  const won = rng.next() < (A * A) / (A * A + D * D);
  applyLosses(att, won ? Math.min(0.45, (0.3 * D) / Math.max(1, A)) : rng.range(0.3, 0.5));
  applyLosses(p.garrison, won ? 1 : rng.range(0.15, 0.35));
  return won;
}

// ---------------------------------------------------------------- end of round

export interface TurnEvent {
  kind: 'surrender';
  province: Province;
  by: number;
}

/** Runs once after every faction has moved: sieges, income, recovery, seasons. */
export function endRound(state: GameState): TurnEvent[] {
  const events: TurnEvent[] = [];
  const monsoon = isMonsoon(state.turn);

  for (const p of state.provinces) {
    if (!p.siege) continue;
    const besieger = state.armies.find((a) => a.id === p.siege!.army);
    if (!besieger || besieger.province !== p.id) {
      liftSiege(state, p);
      continue;
    }
    p.siege.turns++;
    if (!monsoon) p.siege.equipment = Math.min(2, p.siege.equipment + 1);
    p.supplies -= p.sea ? 0.5 : 1;
    if (p.supplies <= 0) {
      for (const u of p.garrison) u.men = Math.floor(u.men * 0.75);
      p.garrison = p.garrison.filter((u) => u.men >= 5);
      if (p.garrison.length === 0) {
        log(state, `Starving, ${p.town} surrenders to the ${state.factions[besieger.owner].short}.`,
          besieger.owner === PLAYER || p.owner === PLAYER);
        events.push({ kind: 'surrender', province: p, by: besieger.owner });
      } else {
        log(state, `The garrison of ${p.town} is starving.`, besieger.owner === PLAYER || p.owner === PLAYER);
      }
    }
  }

  // Monsoon rains wear down armies camped in hostile country.
  if (monsoon) {
    for (const a of state.armies) {
      if (state.provinces[a.province].owner === a.owner) continue;
      for (const u of a.units) u.men = Math.floor(u.men * 0.93);
    }
    cleanupArmies(state);
  }

  state.turn++;
  for (const f of state.factions) {
    if (!f.alive || f.ai === 'none') continue;
    state.gold[f.id] = Math.max(0, state.gold[f.id] + netIncome(state, f.id));
  }
  for (const p of state.provinces) {
    if (p.devastated > 0) p.devastated--;
    if (p.siege) continue;
    p.supplies = Math.min(maxSupplies(p), p.supplies + 1);
    // Garrisons refill, and a missing company is raised every other turn.
    const f = state.factions[p.owner];
    for (const u of p.garrison) u.men = Math.min(UNIT_STATS[u.type].maxMen, u.men + Math.ceil(UNIT_STATS[u.type].maxMen * 0.1));
    if (p.garrison.length < garrisonCap(p) && state.turn % 2 === 0) {
      p.garrison.push(newUnit(f.garrison[p.garrison.length % f.garrison.length], 0.4));
    }
  }
  for (const a of state.armies) {
    a.raided = false;
    a.mp = a.siegeOf >= 0 ? 0 : movePoints(state, a);
    if (state.provinces[a.province].owner === a.owner && !monsoon) {
      for (const u of a.units) {
        const max = UNIT_STATS[u.type].maxMen;
        u.men = Math.min(max, u.men + Math.ceil(max * 0.08));
      }
    }
  }
  // AI factions sometimes settle old wars between themselves.
  const n = state.factions.length;
  for (let a = 1; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (state.war[a][b] && state.turn - state.warSince[a][b] > 12 && state.rng.chance(0.08)) makePeace(state, a, b);
    }
  }
  if (seasonOf(state.turn) === 'Monsoon') log(state, 'The monsoon breaks. Roads turn to mud and powder grows damp.', true);
  return events;
}

// ---------------------------------------------------------------- recruiting and building

/** Raises a regiment in a province; returns an error message, or null on success. */
export function recruit(state: GameState, p: Province, type: UnitType, f = PLAYER): string | null {
  const cost = UNIT_STATS[type].cost;
  if (p.owner !== f) return 'Not your province.';
  if (p.siege) return 'The province is under siege.';
  if (state.gold[f] < cost) return 'Not enough gold.';
  let a = armyAt(state, p.id);
  if (a && a.owner !== f) return 'An enemy army stands here.';
  if (a && a.units.length >= MAX_UNITS) return `An army holds at most ${MAX_UNITS} regiments.`;
  if (!a) a = spawnArmy(state, f, p.id, []); // fresh levies can't march until next turn
  a.units.push(newUnit(type));
  state.gold[f] -= cost;
  return null;
}

export const wallsCost = (p: Province) => 40 * (p.walls + 1);
export const maxWalls = (p: Province) => (p.kind === 'fort' ? 3 : 2);
export const marketCost = (p: Province) => 20 + p.wealth * 6;
export const maxWealth = (p: Province) => p.baseWealth * 2 + 2;

export function canBuild(state: GameState, p: Province, f = PLAYER): string | null {
  if (p.owner !== f) return 'Not your province.';
  if (p.siege) return 'Under siege.';
  if (p.builtTurn === state.turn) return 'Already building here this turn.';
  return null;
}

export function buildWalls(state: GameState, p: Province, f = PLAYER): string | null {
  const err = canBuild(state, p, f) ?? (p.walls >= maxWalls(p) ? 'The walls are as strong as they can be.' : null)
    ?? (state.gold[f] < wallsCost(p) ? 'Not enough gold.' : null);
  if (err) return err;
  state.gold[f] -= wallsCost(p);
  p.walls++;
  p.builtTurn = state.turn;
  p.supplies = maxSupplies(p);
  log(state, `New walls rise around ${p.town}.`, f === PLAYER);
  return null;
}

export function buildMarket(state: GameState, p: Province, f = PLAYER): string | null {
  const err = canBuild(state, p, f) ?? (p.wealth >= maxWealth(p) ? 'Trade here cannot grow further.' : null)
    ?? (state.gold[f] < marketCost(p) ? 'Not enough gold.' : null);
  if (err) return err;
  state.gold[f] -= marketCost(p);
  p.wealth++;
  p.builtTurn = state.turn;
  log(state, `Markets expand in ${p.town}.`, f === PLAYER);
  return null;
}
