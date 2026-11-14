import { RNG } from '../rng';
import { CELL, MH, MW } from '../geo';
import { generateMap, type MapData } from './mapgen';
import { ELITE_CAP, FACTION_DEFS, GENERALS, START_YEAR, UNIT_STATS, type FactionDef, type UnitType, vetRank } from '../data';
import { PROVINCES, type Kind } from '../india';
import { findPath, type Pt } from './paths';
import type { ChronEntry } from './chronicle';

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
  /** Battle experience; see vetRank. */
  xp?: number;
  /** Historical battles: whose men these are (e.g. "Holkar's horse"). */
  label?: string;
}

/** What an army means to do when it gets where it is going. */
export type Goal =
  /** Shadow an enemy army out of its reach, cutting its supplies and burning its forage (Bajirao's way). */
  | { kind: 'harass'; army: number }
  | { kind: 'go'; prov: number }
  /** March to a spot in open country. */
  | { kind: 'point'; x: number; y: number }
  | { kind: 'siege'; prov: number }
  | { kind: 'raid'; prov: number }
  | { kind: 'chase'; army: number }
  | { kind: 'join'; army: number }
  /** March to a village and sack it on arrival. */
  | { kind: 'sack'; village: number };

/** A village in the countryside: something to plunder, and to defend. */
export interface Village {
  id: number;
  name: string;
  /** The province it lies in (its owner is the province's owner). */
  prov: number;
  x: number;
  y: number;
  /** Loot it yields when sacked (rises with the province's wealth). */
  wealth: number;
  /** Burnt and empty until this day. */
  burnedUntil: number;
}

/** What a commander is good at. */
export type Trait = 'bold' | 'cautious' | 'horseman' | 'sapper' | 'raider' | 'quartermaster';
export const TRAITS: Record<Trait, { name: string; help: string }> = {
  bold: { name: 'Bold', help: 'Men follow him in: steadier morale and harder charges, but he defends carelessly.' },
  cautious: { name: 'Cautious', help: 'Never caught napping: stouter defence, lighter losses, men tire less.' },
  horseman: { name: 'Horseman', help: 'Born in the saddle: his cavalry ride faster and strike harder.' },
  sapper: { name: 'Siege master', help: 'Ladders and rams built far faster, and his assaults go better.' },
  raider: { name: 'Raider', help: 'Ganimi kava: his army marches faster and carries off half as much again in plunder.' },
  quartermaster: { name: 'Quartermaster', help: 'His men eat half as much and lose few to hunger and sickness.' },
};

export interface General {
  name: string;
  house: string;
  trait: Trait;
  /** Battles fought and won raise his rank (see generalRank). */
  xp: number;
  /** 0..100. A disloyal commander may defect with his army. */
  loyalty: number;
  /** Granted a jagir (land) by the crown. */
  landed: boolean;
  /** Character: temperament, what they think of the player (-100..100), and what they remember of past talks. */
  persona?: { honour: number; greed: number; temper: number };
  opinion?: number;
  memory?: string[];
  /** Day of the last conversation that warmed them (the charm can't be repeated every day). */
  charmedDay?: number;
  /** The player's own character. */
  isPlayer?: boolean;
}

/** Where the player's character comes from (a nobody: no famous house). */
export type Origin = 'mavala' | 'deshmukh' | 'silahdar' | 'carpenter';
export const ORIGINS: Record<Origin, { label: string; blurb: string; trait: Trait }> = {
  mavala: { label: 'Mavala hillman', blurb: "a hillman's son from the Maval valleys", trait: 'raider' },
  deshmukh: { label: "Deshmukh's younger son", blurb: 'the younger son of a minor deshmukh with no land to inherit', trait: 'cautious' },
  silahdar: { label: 'Silahdar horseman', blurb: 'a silahdar who sold his horse and sword to whoever paid', trait: 'horseman' },
  carpenter: { label: "Fort carpenter's son", blurb: "a fort carpenter's son who knows walls from the inside", trait: 'sapper' },
};
export const generalRank = (g: General) => (g.xp >= 9 ? 3 : g.xp >= 5 ? 2 : g.xp >= 2 ? 1 : 0);
export const RANK_NAMES = ['Captain', 'Commander', 'Veteran commander', 'Great captain'];

export interface Army {
  id: number;
  owner: number;
  /** The commander whose standard the army marches under. */
  general: General;
  /** Days of food carried. Out of food, the army starves. */
  food: number;
  /** Enemy armies: their numbers are known exactly until this day (spies and scouts). */
  scoutedUntil: number;
  /** Camp quarantined against sickness: it may not march until this day. */
  quarantineUntil: number;
  units: CUnit[];
  /** World position in pixels. */
  x: number;
  y: number;
  /** Province the army is standing in. */
  node: number;
  /** Waypoints still to march through, in order (straight legs across country). */
  route: Pt[];
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
  /** The front (a province) this army campaigns on; it doesn't wander off to other wars. */
  front?: number;
  /** Marching under another army's banner (a host): the leader's id, and the day it goes its own way again. */
  follows?: number;
  followUntil?: number;
  /** Riding light: the baggage left behind, an all-horse army marches faster and lives off the land, but cannot besiege. */
  light?: boolean;
  /** Harassed: enemy horse have cut its convoys and burn its forage until this day. */
  cutOffUntil?: number;
  /** Days in a row it has starved while cut off (it asks for terms after a few). */
  starveDays?: number;
  /** The last day it asked for terms (so it doesn't ask every day). */
  termsAsked?: number;
}

/** Armies marching under this one's banner. */
export const followersOf = (s: GameState, a: Army) => s.armies.filter((x) => x.follows === a.id);

/** Puts an army under another's banner for a while (they march and fight as one host). */
export function joinBanner(s: GameState, follower: Army, leader: Army, days = 60) {
  if (follower.siegeOf >= 0) liftSiege(s, s.provinces[follower.siegeOf]);
  follower.follows = leader.id;
  follower.followUntil = s.day + days;
  follower.goal = null;
  follower.route = [];
  follower.raidUntil = 0;
}

/** Sends a follower back to its own war. */
export function leaveBanner(s: GameState, follower: Army) {
  follower.follows = undefined;
  follower.followUntil = undefined;
  follower.aiNext = s.day;
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
  buildings: { temple: boolean; stables: boolean; granary: boolean; shipyard: boolean };
  /** 0..100: discontent. Past 80 the province may rise in revolt. */
  unrest: number;
  faith: Faith;
  /** The realm whose people these are (they resent other rulers). */
  culture: number;
  /** Chauth: this province pays a share of its revenue to another realm until a day. */
  tribute: { to: number; until: number } | null;
  /** Granted as a jagir to a commander: half its revenue goes to him. */
  jagir: boolean;
  famineUntil: number;
  /** Day it last changed hands. */
  takenDay: number;
  /** Last attempts at bribery or demands, so they can't be spammed. */
  lastIntrigue: number;
  lastSortie: number;
  /** Abandoned by its garrison after a lost battle nearby: empty, and no new garrison until this day. */
  unguardedUntil: number;
}

export type Faith = 'hindu' | 'muslim' | 'mixed' | 'buddhist';
export type Policy = { tax: 'light' | 'normal' | 'heavy'; faith: 'tolerant' | 'zealous' };

/** A squadron of ships based at a port. */
export interface Fleet {
  id: number;
  owner: number;
  ships: number;
  home: number;
  mission: 'port' | 'raid' | 'patrol' | 'blockade';
  /** Target province (raid, blockade). */
  target: number;
  x: number;
  y: number;
  /** Sailing back home after a raid. */
  returning: boolean;
}

export interface Captive { gen: General; owner: number; by: number; day: number }

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
  /** The campaign is over (only if Swarajya falls: a victory is celebrated, and the world runs on). */
  over: null | 'won' | 'lost';
  /** Delhi taken (or half of India): the triumph is announced once ('pending'), then play goes on ('shown'). */
  triumph?: 'pending' | 'shown';
  /** -100..100 goodwill between realms. */
  relations: number[][];
  /** Hostages exchanged: no war until this day. */
  truceUntil: number[][];
  marriage: boolean[][];
  policy: Policy[];
  /** Commanders not leading an army, per realm. */
  officers: General[][];
  captives: Captive[];
  fleets: Fleet[];
  nextFleetId: number;
  /** Events that have already happened (one-off ones). */
  eventsDone: string[];
  /** Each realm's sovereign (a character you can seek an audience with); null for the player's realm and the independents. */
  rulers: (General | null)[];
  /** The player's good name, 0..100: kept oaths raise it, broken ones and sacked towns lower it. */
  honour: number;
  /** The player's own character and the army they lead (every other army, Maratha ones included, moves on its own). */
  player: { gen: General; origin: Origin; armyId: number; lastAsk: number; reportedXp: number };
  /** The chronicle of the player's deeds (see chronicle.ts). */
  chronicle: ChronEntry[];
  villages: Village[];
}

/** Is this the army the player leads in person? */
export const isYours = (s: GameState, a: Army | null | undefined) => !!a && a.id === s.player.armyId;
export const yourArmy = (s: GameState) => s.armies.find((a) => a.id === s.player.armyId) ?? null;

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

// ---------------------------------------------------------------- faith

const MUSLIM_REGIONS = new Set(['Sindh', 'Punjab', 'Persia', 'Fars', 'Khorasan', 'Azerbaijan & Gilan', 'Kerman & Sistan', 'Afghanistan', 'Sumatra', 'Malaya']);
const BUDDHIST_REGIONS = new Set(['Burma', 'Siam', 'Laos & Cambodia', 'Dai Viet']);
const MIXED_REGIONS = new Set(['Hindustan', 'Bengal', 'Bijapur', 'Golconda', 'Mughal Deccan', 'Gujarat', 'Awadh & Bihar', 'Malwa', 'Kashmir & Hills', 'Khandesh & Berar']);
export function faithOf(region: string): Faith {
  return MUSLIM_REGIONS.has(region) ? 'muslim' : BUDDHIST_REGIONS.has(region) ? 'buddhist' : MIXED_REGIONS.has(region) ? 'mixed' : 'hindu';
}
/** The faith of a realm's court. */
export function courtFaith(state: GameState, f: number): 'hindu' | 'muslim' | 'christian' | 'buddhist' {
  const k = state.factions[f].key;
  return k === 'mug' || k === 'bij' || k === 'gol' || k === 'sid' || k === 'saf' || k === 'ace' ? 'muslim'
    : k === 'por' || k === 'eng' || k === 'voc' ? 'christian' : k === 'ava' || k === 'aya' || k === 'dvt' ? 'buddhist' : 'hindu';
}
/** 0 = same faith as the ruler, 0.5 = a mixed population, 1 = wholly another faith. */
export function faithGap(state: GameState, p: Province): number {
  const c = courtFaith(state, p.owner);
  if (p.faith === 'mixed') return 0.5;
  return p.faith === c ? 0 : 1;
}

/** Ports and sea forts: where fleets sail from and raid. */
export const isCoastal = (p: Province) => p.kind === 'port' || p.sea;
/** Which sea a coast lies on (fleets stay on their own): 0 the Arabian Sea and the Gulf, 1 the Bay of Bengal, 2 the seas of South-East Asia. */
const EAST_SEA = new Set(['Golconda', 'Bengal', 'Orissa', 'Carnatic', 'Tamil Nadu']);
const FAR_SEA = new Set(['Burma', 'Siam', 'Malaya', 'Sumatra', 'Laos & Cambodia', 'Dai Viet']);
export const seaOf = (p: Province) => (EAST_SEA.has(p.region) ? 1 : FAR_SEA.has(p.region) ? 2 : 0);

/**
 * The key fort of each region: whoever holds it commands the country around.
 * (The strongest fort; ties go to the richer.)
 */
export function keyFort(state: GameState, region: string): Province | null {
  let best: Province | null = null;
  for (const p of state.provinces) {
    if (p.region !== region || p.kind !== 'fort') continue;
    if (!best || p.walls * 10 + p.wealth > best.walls * 10 + best.wealth) best = p;
  }
  return best;
}

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
      buildings: { temple: false, stables: false, granary: false, shipyard: d.key === 'malvan' || d.key === 'janjira' || d.key === 'goa' || d.key === 'bombay' || d.key === 'surat' },
      unrest: rng.range(5, 20), faith: faithOf(d.region),
      // The Desh and the Konkan are Maratha country, whoever holds the forts.
      culture: d.region === 'Desh' || d.region === 'Konkan' ? (d.owner === 'sid' || d.owner === 'eng' || d.owner === 'por' ? owner : 0) : owner,
      tribute: null, jagir: false, famineUntil: 0, takenDay: -999, lastIntrigue: -999, lastSortie: -999, unguardedUntil: 0,
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
    relations: grid(0), truceUntil: grid(0), marriage: grid(false),
    policy: factions.map((f) => ({ tax: 'normal', faith: f.key === 'mug' ? 'zealous' : 'tolerant' })),
    officers: factions.map((f) => (GENERALS[f.key] ?? []).map(([name, house], i) => makeGeneral(rng, name, house, i === 0 ? 3 : rng.range(0, 4)))),
    captives: [], fleets: [], nextFleetId: 1, eventsDone: [], rulers: [], honour: 60,
    player: { gen: { ...makeGeneral(rng, 'Rao', 'of no great house', 0), trait: 'raider', loyalty: 100, isPlayer: true }, origin: 'mavala', armyId: -1, lastAsk: -999, reportedXp: 0 },
    chronicle: [], villages: [],
  };
  state.villages = makeVillages(map, provinces, rng);
  // Shivaji is the sovereign you serve, at Raigad, not a commander in the field.
  state.officers[0] = state.officers[0].filter((g) => g.name !== 'Shivaji');

  const setWar = (a: string, b: string) => {
    state.war[fid(a)][fid(b)] = state.war[fid(b)][fid(a)] = true;
  };
  setWar('mar', 'mug');
  setWar('mar', 'sid');
  setWar('mug', 'aho');
  state.ally[fid('mug')][fid('sid')] = state.ally[fid('sid')][fid('mug')] = true;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a !== b) state.relations[a][b] = state.war[a][b] ? -40 : state.ally[a][b] ? 50 : 0;
    }
  }
  // Fleets: the Siddis, the Portuguese and the English rule the Konkan waters; Shivaji's navy is young.
  const fleet = (key: string, ships: number) => {
    const p = provinces.find((q) => q.key === key)!;
    state.fleets.push({ id: state.nextFleetId++, owner: p.owner, ships, home: p.id, mission: 'port', target: -1, x: p.x, y: p.y, returning: false });
  };
  fleet('malvan', 4);
  fleet('janjira', 8);
  fleet('goa', 9);
  fleet('bombay', 5);
  fleet('surat', 4);
  fleet('malacca', 6);
  fleet('aceh', 4);

  const army = (key: string, units: [UnitType, number][]) => {
    const p = provinces.find((q) => q.key === key)!;
    const list: CUnit[] = [];
    // Regiments go to war at uneven strength: some full, some thinned by desertion and sickness.
    for (const [t, count] of units) for (let i = 0; i < count; i++) list.push(newUnit(t, rng.range(0.62, 1)));
    spawnArmy(state, p.owner, p.id, list);
  };
  army('raigad', [['mavala', 5], ['huzurat', 1], ['shiledar', 1], ['lightcav', 2], ['archer', 2], ['musket', 2]]);
  army('javli', [['mavala', 3], ['shiledar', 1], ['lightcav', 2], ['archer', 1]]);
  // You: a nobody with a few men, given leave by the Raje to raise a following.
  const raigad = provinces.find((q) => q.key === 'raigad')!;
  const yours = spawnArmy(state, 0, raigad.id, [newUnit('mavala', 0.85), newUnit('mavala', 0.7), newUnit('lightcav', 0.8), newUnit('archer', 0.75)], state.player.gen);
  state.player.armyId = yours.id;
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
  army('kabul', [['heavycav', 2], ['horsearcher', 2], ['spear', 3], ['musket', 1]]);
  army('isfahan', [['heavycav', 4], ['horsearcher', 2], ['musket', 3], ['spear', 3], ['cannon', 1]]);
  army('herat', [['heavycav', 2], ['horsearcher', 2], ['spear', 2]]);
  army('kandahar', [['heavycav', 2], ['musket', 2], ['spear', 2]]);
  army('tabriz', [['heavycav', 3], ['spear', 2], ['musket', 2]]);
  army('ava', [['elephant', 2], ['spear', 4], ['musket', 2], ['archer', 2], ['lightcav', 2]]);
  army('pegu', [['spear', 3], ['archer', 2], ['musket', 1]]);
  army('ayutthaya', [['elephant', 2], ['spear', 4], ['musket', 3], ['archer', 2], ['lightcav', 1], ['cannon', 1]]);
  army('phitsanulok', [['spear', 3], ['archer', 2], ['elephant', 1]]);
  army('thanglong', [['spear', 4], ['musket', 3], ['archer', 2], ['elephant', 1]]);
  army('aceh', [['spear', 3], ['musket', 2], ['elephant', 1], ['cannon', 1]]);
  army('malacca', [['firangi', 2], ['musket', 2], ['spear', 1]]);

  for (const f of factions) state.manpower[f.id] = Math.round(maxManpower(state, f.id) * 0.75);
  // The sovereigns of 1670. Where one also leads an army, the ruler and the commander are the same person.
  const RULERS: Record<string, [string, string]> = {
    mar: ['Shivaji', 'Bhonsle'], mug: ['Aurangzeb', 'Timurid'], bij: ['Ali Adil Shah', 'Adil Shahi'], gol: ['Abul Hasan', 'Qutb Shahi'],
    raj: ['Raj Singh', 'Sisodia'], sid: ['Siddi Qasim', 'Janjira'], por: ['Luís de Mendonça', 'Furtado'],
    eng: ['Gerald Aungier', 'Company'], nay: ['Chokkanatha', 'Nayak'], mys: ['Chikka Devaraja', 'Wodeyar'], aho: ['Udayaditya', 'Singha'],
    saf: ['Shah Suleiman', 'Safavid'], ava: ['Pye Min', 'Toungoo'], aya: ['Narai', 'Prasat Thong'], dvt: ['Trinh Tac', 'Trinh'],
    ace: ['Taj ul-Alam', 'Aceh'], voc: ['Balthasar Bort', 'Company'],
  };
  state.rulers = factions.map((f) => {
    const r = RULERS[f.key];
    if (!r) return null;
    const leading = state.armies.find((a) => a.general.name === r[0]);
    const atCourt = state.officers[f.id].find((g) => g.name === r[0]);
    return leading?.general ?? atCourt ?? makeGeneral(rng, r[0], r[1], 6);
  });
  // Armies start the year in winter quarters.
  for (const a of state.armies) a.aiNext = rng.range(15, 35);
  log(state, 'January 1670. Shivaji resolves to retake the forts surrendered at Purandar. Kondhana (Sinhagad) looms over Pune.', true);
  return state;
}

const TRAIT_LIST: Trait[] = ['bold', 'cautious', 'horseman', 'sapper', 'raider', 'quartermaster'];
/** Historical commanders keep their known gifts. */
const KNOWN_TRAITS: Record<string, Trait> = {
  Shivaji: 'raider', 'Netaji': 'horseman', Tanaji: 'bold', Prataprao: 'bold', Hambirrao: 'horseman', Moropant: 'sapper',
  Yesaji: 'cautious', Anaji: 'quartermaster', 'Diler Khan': 'bold', Aurangzeb: 'sapper', 'Shaista Khan': 'cautious',
  'Bahlol Khan': 'horseman', Lachit: 'cautious', Durgadas: 'raider', 'Ram Singh': 'cautious', 'Mir Jumla': 'sapper',
};

export function makeGeneral(rng: RNG, name: string, house: string, xp = 0): General {
  return { name, house, trait: KNOWN_TRAITS[name] ?? rng.pick(TRAIT_LIST), xp, loyalty: rng.range(55, 85), landed: false };
}

/** The next commander of a realm not already leading an army. */
function nextGeneral(state: GameState, owner: number): General {
  const pool = state.officers[owner];
  if (pool?.length) return pool.shift()!;
  const busy = new Set([...state.armies.filter((a) => a.owner === owner).map((a) => a.general.name),
    ...state.captives.filter((c) => c.owner === owner).map((c) => c.gen.name)]);
  let k = 2;
  while (busy.has(`Sardar ${k}`)) k++;
  return makeGeneral(state.rng, `Sardar ${k}`, state.factions[owner].short);
}

/** The army's commander goes back to court (when it disbands or merges). */
export function releaseGeneral(state: GameState, a: Army) {
  if (a.general.isPlayer) return;
  if (state.factions[a.owner]?.alive && !state.officers[a.owner].some((g) => g.name === a.general.name)) state.officers[a.owner].push(a.general);
}

/**
 * The empire's fronts: the Mughals fight on many at once (the Deccan, Rajputana, Bengal and
 * Assam, the north-west, Gujarat, Gondwana, Awadh), each army keeping to its own. Only the
 * Deccan front (Aurangabad) faces the Marathas.
 */
export const FRONTS: Record<string, string[]> = {
  mug: ['aurangabad', 'chanda', 'ajmer', 'dhaka', 'lahore', 'ahmedabad', 'allahabad', 'kabul'],
};
/** How far from its front's centre an army will go campaigning. */
export const FRONT_RANGE = 260;

/** Gives a new army a front: the one with the fewest armies, nearest first. */
export function assignFront(state: GameState, a: Army) {
  const keys = FRONTS[state.factions[a.owner].key];
  if (!keys) return;
  const fronts = keys.map((k) => state.provinces.find((p) => p.key === k)!).filter(Boolean);
  const load = (p: Province) => state.armies.filter((o) => o !== a && o.owner === a.owner && o.front === p.id).length;
  fronts.sort((p, q) => load(p) - load(q) || dist(a, p) - dist(a, q));
  a.front = fronts[0]?.id;
}

/** Days of food an army can carry; riding light, only what the horsemen carry themselves. */
export const maxFood = (a: Army) => (a.light ? 12 : a.general.trait === 'quartermaster' ? 45 : 30);

export function spawnArmy(state: GameState, owner: number, province: number, units: CUnit[], general?: General): Army {
  const p = state.provinces[province];
  const a: Army = {
    id: state.nextArmyId++, owner, general: general ?? nextGeneral(state, owner), units, x: p.x, y: p.y, node: province, route: [], goal: null,
    siegeOf: -1, raidUntil: 0, raidProv: -1, busyUntil: 0, safeUntil: 0, aiNext: state.day + 1,
    food: 30, scoutedUntil: 0, quarantineUntil: 0,
  };
  a.food = maxFood(a);
  state.armies.push(a);
  assignFront(state, a);
  return a;
}

export function maxSupplies(p: Province): number {
  return Math.round((20 + p.walls * 12 + (p.sea ? 15 : 0) + (p.capitalOf >= 0 ? 10 : 0)) * (p.buildings?.granary ? 1.5 : 1));
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
  return units.reduce((s, u) => s + u.men * UNIT_STATS[u.type].value * (1 + vetRank(u.xp) * 0.07), 0);
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
  // A host marches at the pace of its slowest army.
  const host = followersOf(state, a);
  const own = baseSpeed(state, a);
  return host.length ? Math.min(own, ...host.map((f) => baseSpeed(state, f))) : own;
}

function baseSpeed(state: GameState, a: Army): number {
  const cls = a.units.map((u) => UNIT_STATS[u.type].cls);
  let v = 13;
  if (cls.length && cls.every((c) => c === 'cavalry')) v = 22 * (a.general.trait === 'horseman' ? 1.1 : 1);
  else if (cls.some((c) => c === 'elephant' || c === 'artillery')) v = 9;
  if (a.general.trait === 'raider') v *= 1.1;
  // Riding light: no baggage train to wait for.
  if (a.light && cls.length && cls.every((c) => c === 'cavalry')) v *= 1.35;
  // Hill country is slow going (mountain-bred Maratha armies least of all).
  const e = state.map.elev[Math.max(0, Math.min(MH - 1, Math.floor(a.y / CELL))) * MW + Math.max(0, Math.min(MW - 1, Math.floor(a.x / CELL)))];
  if (e > 0.32) v *= a.owner === PLAYER ? 0.85 : 0.75;
  if (state.day < a.quarantineUntil) return 0;
  // Enemy hill forts command the passes: marching under their guns is slow going.
  if (state.provinces.some((p) => p.kind === 'fort' && p.walls >= 2 && p.garrison.length && hostile(state, a.owner, p.owner) && dist(a, p) < 25 && a.siegeOf !== p.id)) v *= 0.8;
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

/** A port blockaded by a hostile fleet earns nothing from the sea. */
export function blockaded(state: GameState, p: Province): boolean {
  return state.fleets.some((f) => f.mission === 'blockade' && f.target === p.id && !f.returning && dist(f, p) < 6 && hostile(state, f.owner, p.owner));
}

/** Gross revenue a province yields its owner (before chauth and jagirs). */
export function provinceIncome(state: GameState, p: Province, regions = regionOwners(state)): number {
  if (p.devastated > 0 || p.siege) return 0;
  let v = p.wealth * (regions.get(p.region) === p.owner ? 1.25 : 1);
  const key = keyFort(state, p.region);
  if (key && key.owner === p.owner) v *= 1.15;
  const pol = state.policy[p.owner];
  if (pol) {
    v *= pol.tax === 'heavy' ? 1.3 : pol.tax === 'light' ? 0.8 : 1;
    if (pol.faith === 'zealous') v *= 1 + 0.1 * faithGap(state, p); // jizya
  }
  if (p.unrest > 50) v *= 0.5;
  if (state.day < p.famineUntil) v *= 0.5;
  if (isCoastal(p)) {
    if (blockaded(state, p)) v *= 0.4;
    else if (state.fleets.some((f) => f.owner === p.owner && f.mission === 'patrol' && dist(f, p) < 300)) v *= 1.15;
  }
  return v;
}

/** Share of a province's revenue that goes out as chauth (and sardeshmukhi). */
export function tributeShare(state: GameState, p: Province): number {
  const t = p.tribute;
  if (!t || t.until < state.day) return 0;
  // Sardeshmukhi: a further tenth, claimed by a realm that already holds land in the region.
  const sardesh = state.provinces.some((q) => q.owner === t.to && q.region === p.region);
  return 0.25 + (sardesh ? 0.1 : 0);
}

/** What a province actually puts in its owner's treasury. */
export function netProvinceIncome(state: GameState, p: Province, regions = regionOwners(state)): number {
  return provinceIncome(state, p, regions) * (1 - tributeShare(state, p)) * (p.jagir ? 0.5 : 1);
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
  for (const p of state.provinces) {
    if (p.owner === f) g += netProvinceIncome(state, p, regions);
    else if (p.tribute?.to === f && p.tribute.until >= state.day) g += provinceIncome(state, p, regions) * tributeShare(state, p);
  }
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

/** Where a goal leads: a town, a spot, or another army's position. */
export function goalPoint(state: GameState, g: Goal): Pt | null {
  if (g.kind === 'point') return { x: g.x, y: g.y };
  if (g.kind === 'chase' || g.kind === 'join' || g.kind === 'harass') {
    const t = armyById(state, g.army);
    return t ? { x: t.x, y: t.y } : null;
  }
  if (g.kind === 'sack') {
    const v = state.villages[g.village];
    return v ? { x: v.x, y: v.y } : null;
  }
  const p = state.provinces[g.prov];
  return { x: p.x, y: p.y };
}

/** A march across country from where the army stands to a point. */
export function findRoute(state: GameState, a: Army, to: Pt): Pt[] | null {
  return findPath(state.map, a, to);
}

export function setGoal(state: GameState, a: Army, goal: Goal | null) {
  if (a.siegeOf >= 0) liftSiege(state, state.provinces[a.siegeOf]);
  a.raidUntil = 0;
  a.goal = goal;
  if (!goal) {
    a.route = [];
    return;
  }
  const target = goalPoint(state, goal);
  const route = target ? findRoute(state, a, target) : null;
  if (!route) {
    a.goal = null;
    a.route = [];
    return;
  }
  a.route = route;
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
  // Breaking a truce sealed with hostages: the hostages pay for it, and every court hears of it.
  if (state.truceUntil[a][b] > state.day) {
    log(state, `The ${f[a].short} break their oath to the ${f[b].short}; the hostages are put to death.`, a === PLAYER || b === PLAYER);
    for (let c = 0; c < f.length; c++) if (c !== a) state.relations[c][a] -= 15;
    if (a === PLAYER) {
      for (const x of state.armies) if (x.owner === PLAYER) x.general.loyalty -= 10;
      state.honour = Math.max(0, state.honour - 20);
    }
    state.truceUntil[a][b] = state.truceUntil[b][a] = 0;
  }
  state.relations[a][b] -= 40;
  state.relations[b][a] -= 40;
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
  state.relations[a][b] += 15;
  state.relations[b][a] += 15;
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

export function removeArmy(state: GameState, a: Army, keepGeneral = true) {
  if (a.siegeOf >= 0) liftSiege(state, state.provinces[a.siegeOf]);
  state.armies = state.armies.filter((x) => x !== a);
  if (keepGeneral) releaseGeneral(state, a);
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
  p.tribute = null;
  p.jagir = false;
  p.takenDay = state.day;
  // Liberators are welcomed; conquerors are not.
  p.unrest = p.culture === owner ? Math.max(0, p.unrest - 25) : Math.min(100, p.unrest + 20);
  const f = state.factions;
  log(state, `The ${f[owner].short} take ${p.town} (${p.name})${p.capitalOf >= 0 ? ', a royal capital!' : '.'}`,
    owner === PLAYER || prev === PLAYER);
  if (prev !== IND && !state.provinces.some((q) => q.owner === prev)) {
    f[prev].alive = false;
    state.armies = state.armies.filter((a) => a.owner !== prev);
    state.fleets = state.fleets.filter((x) => x.owner !== prev);
    log(state, `The ${f[prev].name} is no more.`, true);
  }
  checkOver(state);
}

export function checkOver(state: GameState) {
  if (!state.factions[PLAYER].alive) state.over = 'lost';
  else {
    const delhi = state.provinces.find((p) => p.key === 'delhi')!;
    // Victory is celebrated, not the end: the world runs on, and so may your conquests.
    if (!state.triumph && (delhi.owner === PLAYER || provincesOf(state, PLAYER).length >= VICTORY_PROVINCES)) state.triumph = 'pending';
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
  if (by === PLAYER) state.honour = Math.max(0, state.honour - 4);
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
      if (p.owner !== army.owner || p.siege || p.unguardedUntil > state.day) continue;
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
export function autoResolve(state: GameState, att: CUnit[], def: CUnit[], attK = 1, defK = 1): boolean {
  const rng = state.rng;
  const A = unitsStrength(att) * attK * rng.range(0.85, 1.15);
  const D = unitsStrength(def) * defK * 1.1 * rng.range(0.85, 1.15);
  const won = rng.next() < (A * A) / (A * A + D * D);
  const [ws, ls] = won ? [A, D] : [D, A];
  // The victors lose a little; the beaten lose a third or more, but most of them scatter rather than die.
  applyLosses(won ? att : def, Math.min(0.35, (0.18 * ls) / Math.max(1, ws)));
  applyLosses(won ? def : att, rng.range(0.28, 0.45));
  for (const u of won ? att : def) if (u.men > 0) u.xp = (u.xp ?? 0) + 0.45;
  for (const u of won ? def : att) if (u.men > 0) u.xp = (u.xp ?? 0) + 0.2;
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
export function autoResolveSiege(state: GameState, att: CUnit[], p: Province, def: CUnit[] = p.garrison, attK = 1): boolean {
  const rng = state.rng;
  const eq = p.siege ? siegeEquipment(p.siege) : 0;
  const A = unitsStrength(att) * attK * rng.range(0.85, 1.15);
  const D = (unitsStrength(def) + 10) * wallFactor(p, att, eq) * rng.range(0.85, 1.15);
  const won = rng.next() < (A * A) / (A * A + D * D);
  applyLosses(att, won ? Math.min(0.45, (0.3 * D) / Math.max(1, A)) : rng.range(0.3, 0.5));
  // A garrison that loses its walls dies there; field armies inside break out with what they can.
  applyLosses(p.garrison, won ? 1 : rng.range(0.15, 0.35));
  applyLosses(def.filter((u) => !p.garrison.includes(u)), won ? rng.range(0.4, 0.6) : rng.range(0.15, 0.35));
  for (const u of att) if (u.men > 0) u.xp = (u.xp ?? 0) + (won ? 0.5 : 0.3);
  return won;
}

/** Strength multiplier a commander brings to an auto-resolved battle. */
export function generalK(a: Army | null | undefined, siege = false): number {
  if (!a) return 1;
  const g = a.general;
  let k = 1 + generalRank(g) * 0.05;
  if (g.trait === 'bold') k *= 1.05;
  if (g.trait === 'cautious') k *= 1.03;
  if (g.trait === 'horseman' && a.units.filter((u) => UNIT_STATS[u.type].cls === 'cavalry').length * 2 >= a.units.length) k *= 1.06;
  if (siege && g.trait === 'sapper') k *= 1.12;
  return k;
}

// ---------------------------------------------------------------- recruiting and building

/** The player's (or a faction's) army standing at this settlement, if any. */
export function armyAtTown(state: GameState, p: Province, f: number): Army | undefined {
  return state.armies.find((a) => a.owner === f && a.siegeOf < 0 && townAt(state, a) === p.id);
}

/** Raises a regiment at a settlement; returns an error message, or null on success. */
/** Recruiting cost here: stables breed horses cheaper. */
export function recruitCost(p: Province, type: UnitType): number {
  const st = UNIT_STATS[type];
  return Math.round(st.cost * (st.cls === 'cavalry' && p.buildings.stables ? 0.85 : 1));
}

export function recruit(state: GameState, p: Province, type: UnitType, f = PLAYER): string | null {
  const cost = recruitCost(p, type);
  if (p.owner !== f) return 'Not your province.';
  if (p.siege) return 'The settlement is under siege.';
  if (state.gold[f] < cost) return 'Not enough gold.';
  const eliteErr = eliteBlock(state, p, type, f);
  if (eliteErr) return eliteErr;
  // Your own army, if it stands here, gets the recruits first.
  let a = (f === PLAYER ? state.armies.find((x) => isYours(state, x) && townAt(state, x) === p.id) : undefined) ?? armyAtTown(state, p, f);
  if (a && a.units.length >= MAX_UNITS) return `An army holds at most ${MAX_UNITS} regiments.`;
  const levy = levyFraction(state, f, type);
  if (levy <= 0) return 'Not enough men of fighting age left to raise this regiment.';
  if (!a) a = spawnArmy(state, f, p.id, []);
  const u = newUnit(type, levy);
  // Horse bred and broken at the province's own stables come to the army already seasoned.
  if (UNIT_STATS[type].cls === 'cavalry' && p.buildings.stables) u.xp = 1.2;
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
  // The Marathas also draw on the Maval valleys and the Ghats: hillmen who turn out for every campaign.
  return m > 0 ? m + (f === PLAYER ? 1400 : 400) : 0;
}

/** Men who come of age (or come back from the fields) each month, from provinces not ravaged by war. */
export function manpowerRegen(state: GameState, f: number): number {
  let m = 0;
  for (const p of state.provinces) {
    if (p.owner !== f || p.devastated > 0 || p.siege || p.unrest > 70 || state.day < p.famineUntil) continue;
    const key = keyFort(state, p.region);
    m += p.wealth * MEN_PER_WEALTH * 0.05 * (key && key.owner === f ? 1.25 : 1);
  }
  return Math.round(m > 0 ? (f === PLAYER ? m * 1.5 + 90 : m + 20) : 0);
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

// ---------------------------------------------------------------- villages

const SYL_A = ['Ram', 'Shiv', 'Kal', 'Mor', 'Wad', 'Sas', 'Nar', 'Dev', 'Kon', 'Bhor', 'Sat', 'Kar', 'Pal', 'Ved', 'Man', 'Jam', 'Har', 'Chin', 'Ambe', 'Kes', 'Gor', 'Lon', 'Nim', 'Sir', 'Tal', 'Dhan', 'Ran', 'Mal', 'Ang', 'Bel'];
const SYL_B = ['', 'a', 'i', 'o', 'u', 'ni', 'de', 'ra', 'go', 'ha'];
const SUFFIX = ['pur', 'gaon', 'wadi', 'abad', 'nagar', 'khed', 'ner', 'oli', 'gad', 'wade', 'pada', 'sar'];

/** A village name of the country: a root, a joining sound, and a place-ending. */
function villageName(rng: RNG): string {
  return rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SUFFIX);
}

/** Scatters villages through each province: a few per province, away from the town and from each other. */
export function makeVillages(map: MapData, provinces: Province[], rng: RNG): Village[] {
  const cells: number[][] = provinces.map(() => []);
  for (let i = 0; i < map.prov.length; i++) {
    const p = map.prov[i];
    if (p >= 0 && map.elev[i] < 0.6) cells[p].push(i);
  }
  const out: Village[] = [];
  const names = new Set<string>();
  for (const p of provinces) {
    const want = 2 + (p.wealth >= 8 ? 1 : 0);
    const mine: Village[] = [];
    for (let tries = 0; tries < 60 && mine.length < want && cells[p.id].length; tries++) {
      const c = rng.pick(cells[p.id]);
      const x = (c % MW) * CELL + CELL / 2;
      const y = Math.floor(c / MW) * CELL + CELL / 2;
      if (Math.hypot(x - p.x, y - p.y) < 12) continue;
      if ([...mine, ...out].some((v) => Math.hypot(v.x - x, v.y - y) < 10)) continue;
      let name = villageName(rng);
      for (let k = 0; names.has(name) && k < 5; k++) name = villageName(rng);
      names.add(name);
      mine.push({ id: out.length + mine.length, name, prov: p.id, x, y, wealth: Math.round(4 + p.wealth * 1.6 + rng.range(0, 4)), burnedUntil: 0 });
    }
    out.push(...mine);
  }
  return out;
}

/** The village at (or right by) a point, if any. */
export function villageAt(state: GameState, pt: { x: number; y: number }, within = 4): Village | null {
  let best: Village | null = null;
  let bd = within;
  for (const v of state.villages) {
    const d = Math.hypot(v.x - pt.x, v.y - pt.y);
    if (d <= bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

export const villageOwner = (state: GameState, v: Village) => state.provinces[v.prov].owner;
export const villageBurnt = (state: GameState, v: Village) => v.burnedUntil > state.day;