import { RNG } from '../rng';
import { CELL, MH, MW } from '../geo';
import { generateMap, type MapData } from './mapgen';
import { ELITE_CAP, FACTION_DEFS, GENERALS, START_YEAR, UNIT_STATS, type FactionDef, type UnitType } from '../data';
import { PROVINCES, type Kind } from '../india';

export const PLAYER = 0;
export const IND = FACTION_DEFS.length - 1;
export const MAX_UNITS = 20;
/** Distance (world px) at which hostile armies clash. */
export const CONTACT_RANGE = 9;
/** Distance at which an army counts as standing at a settlement. */
export const AT_TOWN = 3;

export interface CUnit {
  type: UnitType;
  men: number;
}

/** What an army means to do when it gets where it is going. */
export type Goal =
  | { kind: 'go'; prov: number }
  | { kind: 'siege'; prov: number }
  | { kind: 'raid'; prov: number }
  | { kind: 'chase'; army: number }
  | { kind: 'join'; army: number };

export interface Army {
  id: number;
  owner: number;
  /** The commander whose standard the army marches under. */
  general: { name: string; house: string };
  units: CUnit[];
  /** World position in pixels. */
  x: number;
  y: number;
  /** Last settlement passed or stood at. */
  node: number;
  /** Settlements still to pass through, in order. */
  route: number[];
  goal: Goal | null;
  /** Province this army is besieging, or -1. */
  siegeOf: number;
  /** Plundering the countryside until this day. */
  raidUntil: number;
  raidProv: number;
  /** Locked in an AI battle until this day. */
  busyUntil: number;
  /** Cannot be caught (just retreated) until this day. */
  safeUntil: number;
  /** Next day the AI reconsiders this army's orders. */
  aiNext: number;
}

export interface Siege {
  army: number;
  start: number;
  /** Days of siege work done: ladders at 4, a ram at 12. */
  work: number;
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
  baseWealth: number;
  owner: number;
  capitalOf: number;
  garrison: CUnit[];
  /** Days of food left in the stores. */
  supplies: number;
  siege: Siege | null;
  /** Days of devastation left (no income while > 0). */
  devastated: number;
  /** Day the last building project finished (one a month). */
  builtDay: number;
}

export interface Faction extends FactionDef {
  id: number;
  alive: boolean;
}

export interface LogEntry {
  day: number;
  text: string;
  /** Concerns the player directly (shown highlighted). */
  mine: boolean;
}

export interface GameState {
  seed: number;
  /** Days since 1 January 1670 (fractional). */
  day: number;
  map: MapData;
  provinces: Province[];
  armies: Army[];
  factions: Faction[];
  gold: number[];
  /** Men of fighting age each realm can still call up (a depleting pool). */
  manpower: number[];
  war: boolean[][];
  ally: boolean[][];
  warSince: number[][];
  nextArmyId: number;
  log: LogEntry[];
  rng: RNG;
  over: null | 'won' | 'lost';
}

export const VICTORY_PROVINCES = 35;

// ---------------------------------------------------------------- calendar

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthOf = (day: number) => Math.floor(day / 30) % 12;
export const yearOf = (day: number) => START_YEAR + Math.floor(day / 360);
export const dateLabel = (day: number) => `${Math.floor(day % 30) + 1} ${MONTHS[monthOf(day)]} ${yearOf(day)}`;
export function seasonOf(day: number): 'Winter' | 'Spring' | 'Monsoon' | 'Autumn' {
  const m = monthOf(day);
  if (m === 11 || m <= 1) return 'Winter';
  if (m <= 4) return 'Spring';
  if (m <= 8) return 'Monsoon';
  return 'Autumn';
}
export const isMonsoon = (day: number) => seasonOf(day) === 'Monsoon';

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
      walls: d.walls, wealth: d.wealth, baseWealth: d.wealth, owner,
      capitalOf: factions[owner].capital === d.key ? owner : -1,
      garrison: [], supplies: 0, siege: null, devastated: 0, builtDay: -999,
    };
    p.supplies = maxSupplies(p);
    p.garrison = garrisonFor(factions[owner], p, rng.range(0.6, 0.95));
    return p;
  });

  const n = factions.length;
  const grid = <T,>(v: T) => Array.from({ length: n }, () => new Array<T>(n).fill(v));
  const state: GameState = {
    seed, day: 0, map, provinces, armies: [], factions,
    gold: factions.map((f) => (f.id === PLAYER ? 150 : 100)), manpower: factions.map(() => 0),
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
    // Regiments go to war at uneven strength: some full, some thinned by desertion and sickness.
    for (const [t, count] of units) for (let i = 0; i < count; i++) list.push(newUnit(t, rng.range(0.62, 1)));
    spawnArmy(state, p.owner, p.id, list);
  };
  army('raigad', [['mavala', 5], ['huzurat', 1], ['shiledar', 1], ['lightcav', 2], ['archer', 2], ['musket', 2]]);
  army('javli', [['mavala', 3], ['shiledar', 1], ['lightcav', 2], ['archer', 1]]);
  army('aurangabad', [['heavycav', 2], ['spear', 3], ['musket', 2], ['archer', 2], ['elephant', 1], ['horsearcher', 1], ['cannon', 1]]);
  army('ahmednagar', [['spear', 2], ['musket', 1], ['heavycav', 1]]);
  army('delhi', [['ahadi', 2], ['heavycav', 4], ['spear', 5], ['musket', 3], ['elephant', 3], ['horsearcher', 2]]);
  army('ahmedabad', [['heavycav', 3], ['spear', 3], ['archer', 3]]);
  army('dhaka', [['spear', 4], ['musket', 3], ['heavycav', 2], ['elephant', 1], ['cannon', 1]]);
  army('lahore', [['heavycav', 3], ['horsearcher', 3], ['spear', 3]]);
  army('bijapur', [['habshi', 2], ['spear', 4], ['musket', 3], ['heavycav', 3], ['elephant', 2], ['cannon', 1]]);
  army('bangalore', [['spear', 3], ['lightcav', 3], ['archer', 2]]);
  army('golconda', [['habshi', 2], ['spear', 4], ['musket', 3], ['heavycav', 3], ['elephant', 1]]);
  army('amber', [['rajput', 4], ['spear', 3], ['archer', 2]]);
  army('marwar', [['rajput', 3], ['spear', 3]]);
  army('mysore', [['spear', 3], ['rocket', 2], ['lightcav', 2]]);
  army('madurai', [['spear', 4], ['archer', 2], ['elephant', 1]]);
  army('garhgaon', [['spear', 4], ['archer', 3], ['musket', 2]]);
  army('kamrup', [['spear', 3], ['archer', 2], ['musket', 1]]);

  for (const f of factions) state.manpower[f.id] = Math.round(maxManpower(state, f.id) * 0.75);
  // Armies start the year in winter quarters.
  for (const a of state.armies) a.aiNext = rng.range(15, 35);
  log(state, 'January 1670. Shivaji resolves to retake the forts surrendered at Purandar. Kondhana (Sinhagad) looms over Pune.', true);
  return state;
}

/** The next commander of a realm not already leading an army. */
function nextGeneral(state: GameState, owner: number): { name: string; house: string } {
  const pool = GENERALS[state.factions[owner].key];
  const busy = new Set(state.armies.filter((a) => a.owner === owner).map((a) => a.general.name));
  const free = pool.find(([n]) => !busy.has(n));
  if (free) return { name: free[0], house: free[1] };
  let k = 2;
  while (busy.has(`Sardar ${k}`)) k++;
  return { name: `Sardar ${k}`, house: state.factions[owner].short };
}

export function spawnArmy(state: GameState, owner: number, province: number, units: CUnit[]): Army {
  const p = state.provinces[province];
  const a: Army = {
    id: state.nextArmyId++, owner, general: nextGeneral(state, owner), units, x: p.x, y: p.y, node: province, route: [], goal: null,
    siegeOf: -1, raidUntil: 0, raidProv: -1, busyUntil: 0, safeUntil: 0, aiNext: state.day + 1,
  };
  state.armies.push(a);
  return a;
}

export function maxSupplies(p: Province): number {
  return 20 + p.walls * 12 + (p.sea ? 15 : 0) + (p.capitalOf >= 0 ? 10 : 0);
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

export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

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

export function armyById(state: GameState, id: number): Army | undefined {
  return state.armies.find((a) => a.id === id);
}

/** Province whose land the army is standing in. */
export function provinceUnder(state: GameState, a: { x: number; y: number }, fallback = -1): number {
  const cx = Math.floor(a.x / CELL);
  const cy = Math.floor(a.y / CELL);
  if (cx < 0 || cy < 0 || cx >= MW || cy >= MH) return fallback;
  const p = state.map.prov[cy * MW + cx];
  return p >= 0 ? p : fallback;
}

/** The settlement an army is standing at (not marching), or -1. */
export function townAt(state: GameState, a: Army): number {
  if (a.route.length) return -1;
  const p = state.provinces[a.node];
  return dist(a, p) <= AT_TOWN ? p.id : -1;
}

/** Can faction a's armies attack faction b? Independents are fair game for anyone. */
export function hostile(state: GameState, a: number, b: number): boolean {
  if (a === b) return false;
  if (a === IND || b === IND) return true;
  return state.war[a][b];
}

/** March speed in world pixels per day. */
export function armySpeed(state: GameState, a: Army): number {
  const cls = a.units.map((u) => UNIT_STATS[u.type].cls);
  let v = 13;
  if (cls.length && cls.every((c) => c === 'cavalry')) v = 22;
  else if (cls.some((c) => c === 'elephant' || c === 'artillery')) v = 9;
  return v * (isMonsoon(state.day) ? 0.6 : 1);
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

/** Army upkeep per month. */
export function upkeep(state: GameState, f: number): number {
  let u = 0;
  for (const a of state.armies) if (a.owner === f) for (const x of a.units) u += UNIT_STATS[x.type].upkeep;
  // Regiments live off the land in part: upkeep is a fraction of their nominal cost.
  return Math.round(u * 0.6);
}

/** Revenue per month. */
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
  state.log.push({ day: state.day, text, mine });
  if (state.log.length > 200) state.log.shift();
}

// ---------------------------------------------------------------- roads

/**
 * Shortest road (settlement to settlement) from where the army stands to a
 * province's settlement. Returns the settlements to pass through, in order.
 */
export function findRoute(state: GameState, a: Army, target: number): number[] | null {
  const P = state.provinces;
  const N = P.length;
  const cost = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  // Start from the settlement behind us and, if marching, the one ahead.
  cost[a.node] = dist(a, P[a.node]);
  if (a.route.length) cost[a.route[0]] = Math.min(cost[a.route[0]], dist(a, P[a.route[0]]));
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < N; i++) if (!done[i] && cost[i] < best) { best = cost[i]; u = i; }
    if (u < 0) return null;
    if (u === target) break;
    done[u] = 1;
    for (const v of P[u].neighbors) {
      const c = best + dist(P[u], P[v]);
      if (c < cost[v]) {
        cost[v] = c;
        prev[v] = u;
      }
    }
  }
  const path: number[] = [];
  for (let v = target; v >= 0; v = prev[v]) path.unshift(v);
  // Drop the starting settlement if we are already standing on it.
  if (path.length && dist(a, P[path[0]]) <= AT_TOWN) path.shift();
  return path;
}

export function setGoal(state: GameState, a: Army, goal: Goal | null) {
  if (a.siegeOf >= 0) liftSiege(state, state.provinces[a.siegeOf]);
  a.raidUntil = 0;
  a.goal = goal;
  if (!goal) {
    a.route = [];
    return;
  }
  const target = goal.kind === 'chase' || goal.kind === 'join'
    ? (() => { const t = armyById(state, goal.army); return t ? provinceUnder(state, t, t.node) : -1; })()
    : goal.prov;
  if (target < 0) {
    a.goal = null;
    a.route = [];
    return;
  }
  a.route = findRoute(state, a, target) ?? [];
}

export function nearestOwned(state: GameState, a: Army, avoidBesieged = true): number {
  let best = -1;
  let bd = Infinity;
  for (const p of state.provinces) {
    if (p.owner !== a.owner || (avoidBesieged && p.siege)) continue;
    const d = dist(a, p);
    if (d < bd) {
      bd = d;
      best = p.id;
    }
  }
  return best;
}

// ---------------------------------------------------------------- diplomacy

export function declareWar(state: GameState, a: number, b: number) {
  if (a === b || state.war[a][b]) return;
  const f = state.factions;
  const pairs: [number, number][] = [[a, b]];
  for (let c = 0; c < f.length; c++) if (c !== a && state.ally[b][c] && f[c].alive) pairs.push([a, c]);
  for (const [x, y] of pairs) {
    state.war[x][y] = state.war[y][x] = true;
    state.warSince[x][y] = state.warSince[y][x] = state.day;
    log(state, `${f[x].name} declares war on the ${f[y].name}.`, x === PLAYER || y === PLAYER);
  }
}

export function makePeace(state: GameState, a: number, b: number) {
  if (!state.war[a][b]) return;
  state.war[a][b] = state.war[b][a] = false;
  state.warSince[a][b] = state.warSince[b][a] = state.day;
  // Sieges end and armies in the other's land head home.
  for (const army of state.armies) {
    if (army.owner !== a && army.owner !== b) continue;
    const other = army.owner === a ? b : a;
    if (army.siegeOf >= 0 && state.provinces[army.siegeOf].owner === other) liftSiege(state, state.provinces[army.siegeOf]);
    const target = army.goal && 'prov' in army.goal ? state.provinces[army.goal.prov].owner : -1;
    const chased = army.goal && 'army' in army.goal ? armyById(state, army.goal.army)?.owner : -1;
    if (target === other || chased === other) setGoal(state, army, null);
    if (state.provinces[provinceUnder(state, army, army.node)].owner === other) {
      const home = nearestOwned(state, army);
      if (home >= 0) setGoal(state, army, { kind: 'go', prov: home });
    }
  }
  log(state, `Peace between the ${state.factions[a].name} and the ${state.factions[b].name}.`, a === PLAYER || b === PLAYER);
}

/** Would AI faction `ai` accept peace with `other` right now? */
export function acceptsPeace(state: GameState, ai: number, other: number): boolean {
  const days = state.day - state.warSince[ai][other];
  const ex = manpowerRatio(state, ai);
  // A realm that has bled itself white takes whatever peace it can get.
  if (ex < 0.15) return true;
  if (ex < 0.3 && state.rng.chance(0.6)) return true;
  if (state.factions[ai].key === 'mug' && days < 240) return false; // Aurangzeb does not bargain early
  const mine = factionStrength(state, ai) + 1;
  const theirs = factionStrength(state, other) + 1;
  if (theirs / mine > 1.4) return true;
  if (days >= 300 && state.rng.chance(0.35)) return true;
  return days >= 120 && theirs / mine > 0.9 && state.rng.chance(0.25);
}

// ---------------------------------------------------------------- war on the map

export function removeArmy(state: GameState, a: Army) {
  if (a.siegeOf >= 0) liftSiege(state, state.provinces[a.siegeOf]);
  state.armies = state.armies.filter((x) => x !== a);
}

export function cleanupArmies(state: GameState) {
  for (const a of state.armies) a.units = a.units.filter((u) => u.men >= 5);
  for (const a of state.armies.filter((x) => x.units.length === 0)) removeArmy(state, a);
  for (const p of state.provinces) p.garrison = p.garrison.filter((u) => u.men >= 5);
}

export const siegeEquipment = (s: Siege) => (s.work >= 12 ? 2 : s.work >= 4 ? 1 : 0);

export function startSiege(state: GameState, army: Army, p: Province) {
  const climbers = army.units.some((u) => UNIT_STATS[u.type].climb >= 2);
  p.siege = { army: army.id, start: state.day, work: climbers ? 4 : 0, lastAssault: -99 };
  army.siegeOf = p.id;
  army.goal = null;
  army.route = [];
  // Camp just below the walls.
  army.x = p.x;
  army.y = p.y + 7;
  log(state, `The ${state.factions[army.owner].short} lay siege to ${p.town} (${p.name}).`,
    army.owner === PLAYER || p.owner === PLAYER);
}

export function liftSiege(state: GameState, p: Province) {
  if (!p.siege) return;
  const a = armyById(state, p.siege.army);
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

export const RAID_DAYS = 2;

/** Gold carried off by a finished raid (chauth). */
export function raidSpoils(state: GameState, army: Army, p: Province): number {
  const horse = army.units.filter((u) => UNIT_STATS[u.type].cls === 'cavalry').length / army.units.length;
  const gold = Math.round(p.wealth * (2 + horse * 2) * (p.devastated > 0 ? 0.3 : 1));
  state.gold[army.owner] += gold;
  p.devastated = Math.max(p.devastated, 60);
  log(state, `The ${state.factions[army.owner].short} plunder the lands of ${p.name} and carry off ${gold} gold.`,
    army.owner === PLAYER || p.owner === PLAYER);
  return gold;
}

/** Loot a freshly taken settlement: a fortune now, a ruin for years. */
export function sack(state: GameState, p: Province, by: number): number {
  const gold = Math.round(p.wealth * 8);
  state.gold[by] += gold;
  p.wealth = Math.max(1, Math.round(p.wealth * 0.6));
  p.devastated = 180;
  log(state, `${p.town} is sacked! ${gold} gold in plunder.`, by === PLAYER || p.owner === PLAYER);
  return gold;
}

/**
 * A beaten (or fleeing) army falls back to a friendly settlement away from the
 * enemy, or is destroyed if it has nowhere to go.
 */
export function retreat(state: GameState, army: Army, threat?: { x: number; y: number }) {
  if (army.siegeOf >= 0) liftSiege(state, state.provinces[army.siegeOf]);
  const name = state.factions[army.owner].short;
  let home = -1;
  if (army.owner !== IND) {
    let best = Infinity;
    for (const p of state.provinces) {
      if (p.owner !== army.owner || p.siege) continue;
      // Prefer close refuges that lie away from whoever is chasing us.
      const score = dist(army, p) - (threat ? Math.min(dist(threat, p), 120) * 0.9 : 0);
      if (score < best && !(threat && dist(threat, p) < 15)) {
        best = score;
        home = p.id;
      }
    }
  }
  if (home < 0) {
    removeArmy(state, army);
    log(state, `The beaten ${name} army has nowhere to run and is destroyed.`, army.owner === PLAYER);
    return;
  }
  setGoal(state, army, { kind: 'go', prov: home });
  army.safeUntil = state.day + 2;
  army.aiNext = state.day + 3;
  log(state, `The ${name} army falls back toward ${state.provinces[home].name}.`, army.owner === PLAYER);
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
  let cut = Math.min(equipment, 2) * 0.15;
  if (attackers.some((u) => UNIT_STATS[u.type].wall > 0)) cut += 0.25;
  if (attackers.some((u) => UNIT_STATS[u.type].cls === 'elephant')) cut += 0.1;
  if (attackers.some((u) => UNIT_STATS[u.type].climb >= 2)) cut += 0.1;
  return Math.max(1.1, 1 + p.walls * (0.75 - cut));
}

/** Quick siege assault. Mutates casualties; returns true if the walls fell. */
export function autoResolveSiege(state: GameState, att: CUnit[], p: Province, def: CUnit[] = p.garrison): boolean {
  const rng = state.rng;
  const eq = p.siege ? siegeEquipment(p.siege) : 0;
  const A = unitsStrength(att) * rng.range(0.85, 1.15);
  const D = (unitsStrength(def) + 10) * wallFactor(p, att, eq) * rng.range(0.85, 1.15);
  const won = rng.next() < (A * A) / (A * A + D * D);
  applyLosses(att, won ? Math.min(0.45, (0.3 * D) / Math.max(1, A)) : rng.range(0.3, 0.5));
  // A garrison that loses its walls dies there; field armies inside break out with what they can.
  applyLosses(p.garrison, won ? 1 : rng.range(0.15, 0.35));
  applyLosses(def.filter((u) => !p.garrison.includes(u)), won ? rng.range(0.4, 0.6) : rng.range(0.15, 0.35));
  return won;
}

// ---------------------------------------------------------------- recruiting and building

/** The player's (or a faction's) army standing at this settlement, if any. */
export function armyAtTown(state: GameState, p: Province, f: number): Army | undefined {
  return state.armies.find((a) => a.owner === f && a.siegeOf < 0 && townAt(state, a) === p.id);
}

/** Raises a regiment at a settlement; returns an error message, or null on success. */
export function recruit(state: GameState, p: Province, type: UnitType, f = PLAYER): string | null {
  const cost = UNIT_STATS[type].cost;
  if (p.owner !== f) return 'Not your province.';
  if (p.siege) return 'The settlement is under siege.';
  if (state.gold[f] < cost) return 'Not enough gold.';
  const eliteErr = eliteBlock(state, p, type, f);
  if (eliteErr) return eliteErr;
  let a = armyAtTown(state, p, f);
  if (a && a.units.length >= MAX_UNITS) return `An army holds at most ${MAX_UNITS} regiments.`;
  const levy = levyFraction(state, f, type);
  if (levy <= 0) return 'Not enough men of fighting age left to raise this regiment.';
  if (!a) a = spawnArmy(state, f, p.id, []);
  const u = newUnit(type, levy);
  a.units.push(u);
  state.manpower[f] -= u.men;
  state.gold[f] -= cost;
  return null;
}

// ---------------------------------------------------------------- manpower

/** Fighting men a province can supply over time, from its population (wealth stands in for it). */
export const MEN_PER_WEALTH = 60;

/** Ceiling of a realm's manpower pool: what its provinces could ever put in the field. */
export function maxManpower(state: GameState, f: number): number {
  let m = 0;
  for (const p of state.provinces) if (p.owner === f) m += p.wealth * MEN_PER_WEALTH;
  // Every realm with land can also call on its nobles' retainers and hereditary soldiers.
  return m > 0 ? m + 400 : 0;
}

/** Men who come of age (or come back from the fields) each month, from provinces not ravaged by war. */
export function manpowerRegen(state: GameState, f: number): number {
  let m = 0;
  for (const p of state.provinces) if (p.owner === f && p.devastated <= 0 && !p.siege) m += p.wealth * MEN_PER_WEALTH * 0.05;
  return Math.round(m > 0 ? m + 20 : 0);
}

/** 1 = a full pool, 0 = nobody left to call up. */
export function manpowerRatio(state: GameState, f: number): number {
  const max = maxManpower(state, f);
  return max > 0 ? Math.max(0, Math.min(1, state.manpower[f] / max)) : 0;
}

export function manpowerLabel(r: number): string {
  return r > 0.6 ? 'Fresh' : r > 0.35 ? 'Strained' : r > 0.15 ? 'Exhausted' : 'Bled white';
}

/** How full a new regiment can be with the men left (0 = cannot raise it at all). */
export function levyFraction(state: GameState, f: number, type: UnitType): number {
  const frac = Math.min(1, state.manpower[f] / UNIT_STATS[type].maxMen);
  return frac < 0.3 ? 0 : frac;
}

/** Draws up to `want` men from the pool; returns how many came. */
export function drawMen(state: GameState, f: number, want: number): number {
  const got = Math.max(0, Math.min(want, state.manpower[f]));
  state.manpower[f] -= got;
  return got;
}

export const wallsCost = (p: Province) => 40 * (p.walls + 1);
export const maxWalls = (p: Province) => (p.kind === 'fort' ? 3 : 2);
export const marketCost = (p: Province) => 20 + p.wealth * 6;
export const maxWealth = (p: Province) => p.baseWealth * 2 + 2;

export function canBuild(state: GameState, p: Province, f = PLAYER): string | null {
  if (p.owner !== f) return 'Not your province.';
  if (p.siege) return 'Under siege.';
  if (state.day - p.builtDay < 30) return `Builders busy for ${Math.ceil(30 - (state.day - p.builtDay))} more days.`;
  return null;
}

export function buildWalls(state: GameState, p: Province, f = PLAYER): string | null {
  const err = canBuild(state, p, f) ?? (p.walls >= maxWalls(p) ? 'The walls are as strong as they can be.' : null)
    ?? (state.gold[f] < wallsCost(p) ? 'Not enough gold.' : null);
  if (err) return err;
  state.gold[f] -= wallsCost(p);
  p.walls++;
  p.builtDay = state.day;
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
  p.builtDay = state.day;
  log(state, `Markets expand in ${p.town}.`, f === PLAYER);
  return null;
}

export function eliteCount(state: GameState, f: number, type: UnitType): number {
  let n = 0;
  for (const a of state.armies) if (a.owner === f) for (const u of a.units) if (u.type === type) n++;
  return n;
}

/** Guard and household troops are raised only at the capital, a few regiments at a time. */
export function eliteBlock(state: GameState, p: Province, type: UnitType, f = PLAYER): string | null {
  if (!UNIT_STATS[type].elite) return null;
  if (p.capitalOf !== f) return `${UNIT_STATS[type].short} are raised only at the capital.`;
  if (eliteCount(state, f, type) >= ELITE_CAP) return `At most ${ELITE_CAP} regiments of ${UNIT_STATS[type].short}.`;
  return null;
}
