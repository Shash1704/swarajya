import type { Owner } from './india';

export type UnitType =
  | 'paik' | 'spear' | 'mavala' | 'habshi'
  | 'archer' | 'musket' | 'firangi' | 'rocket'
  | 'lightcav' | 'shiledar' | 'horsearcher' | 'heavycav' | 'rajput' | 'ahadi' | 'huzurat'
  | 'elephant' | 'cannon';

export type UnitClass = 'infantry' | 'missile' | 'cavalry' | 'elephant' | 'artillery';

/** How the battle AI uses a unit. */
export type Role = 'line' | 'pike' | 'shooter' | 'raider' | 'shock' | 'skirmish' | 'beast' | 'gun';

export type Weapon = 'bow' | 'gun' | 'rocket' | 'cannon' | null;

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';
export const TIERS: Tier[] = ['S', 'A', 'B', 'C', 'D'];
export const TIER_NAMES: Record<Tier, string> = {
  S: 'Household & imperial guard',
  A: 'Elite',
  B: 'Veteran',
  C: 'Regular',
  D: 'Levy',
};

/** Parts of a NATO-style unit symbol, drawn inside the frame (see symbols.ts). */
export type SymbolPart = 'cross' | 'diag' | 'oval' | 'dot' | 'mountain' | 'bow' | 'spearhead' | 'bar' | 'topbar' | 'arrow';

export interface UnitStats {
  name: string;
  short: string;
  cls: UnitClass;
  role: Role;
  weapon: Weapon;
  tier: Tier;
  /** Raised only at the capital, at most ELITE_CAP regiments at a time. */
  elite: boolean;
  cost: number;
  upkeep: number;
  maxMen: number;
  /** Battlefield speed, pixels per second. */
  speed: number;
  melee: number;
  defense: number;
  /** Damage multiplier for the first moments of a charge. */
  charge: number;
  /** Missile range in pixels (0 = melee only). */
  range: number;
  /** Continuous fire: men killed per man per second. Volley fire: per man per volley. */
  missile: number;
  /** Seconds between volleys; 0 means continuous fire (bows). */
  reload: number;
  /** 0..1, how much missile damage armour shrugs off. */
  armor: number;
  morale: number;
  /** Per-man strength for auto-resolve and the campaign AI. */
  value: number;
  /** Melee multiplier against cavalry and elephants. */
  antiLarge: number;
  /** Morale per second drained from enemies close by. */
  fear: number;
  /** Ladder-climbing speed multiplier; 0 = cannot climb walls. */
  climb: number;
  /** Gate damage per man per second (without a ram). */
  gate: number;
  /** Wall damage per shot (siege guns). */
  wall: number;
  shootMoving: boolean;
  skirmish: boolean;
  /** Fights better in forests and hills (Mavalas). */
  wild: boolean;
  symbol: SymbolPart[];
  blurb: string;
}

export const ELITE_CAP = 3;

/** Experience ranks a regiment earns by surviving battles. */
export const VET_NAMES = ['Raw', 'Seasoned', 'Veteran', 'Elite'];
export const vetRank = (xp = 0) => (xp >= 5 ? 3 : xp >= 2.5 ? 2 : xp >= 1 ? 1 : 0);

/** Battle formations, and which kinds of regiment can take them up. */
export type Formation = 'normal' | 'tight' | 'loose' | 'brace' | 'wedge';
export const FORMATION_NAMES: Record<Formation, string> = {
  normal: 'Open order', tight: 'Tight block', loose: 'Loose order', brace: 'Spear hedge', wedge: 'Wedge',
};
export const FORMATION_HELP: Record<Formation, string> = {
  normal: 'The usual order of battle.',
  tight: 'Shoulder to shoulder: holds a charge and resists rout, but slow, clumsy in woods, and a fat target for guns.',
  loose: 'Spread out: arrows and shot do far less harm and woods are easy going, but it gives way to a charge.',
  brace: 'Shields locked and spears levelled: cavalry and elephants break on it, but it cannot move.',
  wedge: 'A cavalry wedge: a far heavier charge, but exposed flanks.',
};
export function formationsFor(t: UnitType): Formation[] {
  const c = UNIT_STATS[t].cls;
  if (c === 'infantry') return ['normal', 'tight', 'loose', 'brace'];
  if (c === 'missile') return ['normal', 'loose'];
  if (c === 'cavalry') return ['normal', 'wedge'];
  return ['normal'];
}
/** Arrows (seconds of shooting) or volleys a missile regiment carries into battle. */
export function ammoFor(t: UnitType): number {
  const st = UNIT_STATS[t];
  if (!st.range) return 0;
  if (st.weapon === 'bow') return st.cls === 'cavalry' ? 55 : 70;
  if (st.weapon === 'rocket') return 8;
  if (st.weapon === 'cannon') return 30;
  return t === 'firangi' ? 16 : 14;
}

const foot = {
  cls: 'infantry' as UnitClass, role: 'line' as Role, weapon: null as Weapon, elite: false,
  charge: 1, range: 0, missile: 0, reload: 0, armor: 0.1, antiLarge: 1, fear: 0, climb: 1,
  gate: 0.01, wall: 0, shootMoving: false, skirmish: false, wild: false,
};
const shot = { ...foot, cls: 'missile' as UnitClass, role: 'shooter' as Role };
const horse = { ...foot, cls: 'cavalry' as UnitClass, climb: 0, gate: 0 };

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  // ---- Infantry
  paik: {
    ...foot, name: 'Paik Levies', short: 'Levies', tier: 'D', cost: 5, upkeep: 0.5, maxMen: 60,
    speed: 30, melee: 0.65, defense: 0.85, armor: 0.05, morale: 45, value: 0.6, symbol: ['cross', 'bar'],
    blurb: 'Peasant levies with spear and shield. Cheap and numerous, but quick to run.',
  },
  spear: {
    ...foot, role: 'pike', name: 'Bhaldar Spearmen', short: 'Spearmen', tier: 'C', cost: 8, upkeep: 1, maxMen: 60,
    speed: 30, melee: 0.95, defense: 1.25, armor: 0.3, morale: 65, value: 1.0, antiLarge: 1.9, symbol: ['cross', 'spearhead'],
    blurb: 'Steady spear blocks. Brace against horse and elephant charges.',
  },
  mavala: {
    ...foot, name: 'Mavalas', short: 'Mavalas', tier: 'B', cost: 9, upkeep: 1, maxMen: 60,
    speed: 40, melee: 1.15, defense: 1.0, charge: 1.3, armor: 0.15, morale: 75, value: 1.1, climb: 2.5, wild: true,
    symbol: ['cross', 'mountain'],
    blurb: 'Hardy hill infantry of the Maval. Quick on foot, deadly in forests and hills, and they scale fort walls fast.',
  },
  habshi: {
    ...foot, name: 'Habshi Guards', short: 'Habshis', tier: 'A', cost: 16, upkeep: 1.5, maxMen: 50,
    speed: 32, melee: 1.4, defense: 1.45, charge: 1.2, armor: 0.45, morale: 85, value: 1.7, antiLarge: 1.3,
    symbol: ['cross', 'oval'],
    blurb: 'Abyssinian soldiers of the Deccan courts and Janjira. Armoured, disciplined and very hard to break.',
  },
  // ---- Missile troops
  archer: {
    ...shot, weapon: 'bow', name: 'Tirandaz Archers', short: 'Archers', tier: 'C', cost: 10, upkeep: 1, maxMen: 50,
    speed: 33, melee: 0.5, defense: 0.75, range: 230, missile: 0.0275, morale: 55, value: 0.9, gate: 0.008,
    symbol: ['cross', 'bow'],
    blurb: 'Shoot steadily while standing still. Weak in melee; arrows glance off armour.',
  },
  musket: {
    ...shot, weapon: 'gun', name: 'Toradar Matchlocks', short: 'Matchlocks', tier: 'B', cost: 14, upkeep: 1, maxMen: 50,
    speed: 30, melee: 0.6, defense: 0.8, range: 190, missile: 0.17, reload: 6, morale: 60, value: 1.1, gate: 0.008,
    symbol: ['cross', 'dot'],
    blurb: 'Slow, thunderous volleys that punch through armour and scare elephants. Rain soaks the powder.',
  },
  firangi: {
    ...shot, weapon: 'gun', name: 'Firangi Musketeers', short: 'Firangis', tier: 'A', cost: 20, upkeep: 1.5, maxMen: 50,
    speed: 30, melee: 0.85, defense: 1.0, range: 210, missile: 0.22, reload: 5, armor: 0.25, morale: 75, value: 1.5,
    gate: 0.008, symbol: ['cross', 'dot', 'topbar'],
    blurb: 'European-drilled musketeers. Faster, deadlier volleys than any matchlock, and they stand their ground.',
  },
  rocket: {
    ...shot, weapon: 'rocket', name: 'Ban Rocketmen', short: 'Rocketmen', tier: 'C', cost: 13, upkeep: 1, maxMen: 40,
    speed: 30, melee: 0.4, defense: 0.7, range: 300, missile: 0.12, reload: 5, morale: 55, value: 0.9,
    symbol: ['dot', 'arrow'],
    blurb: 'Iron-cased rockets. Wildly inaccurate, but they panic elephants and horses.',
  },
  // ---- Cavalry
  lightcav: {
    ...horse, role: 'raider', name: 'Bargir Light Horse', short: 'Bargirs', tier: 'C', cost: 12, upkeep: 1.5, maxMen: 40,
    speed: 85, melee: 0.85, defense: 0.9, charge: 1.5, armor: 0.2, morale: 65, value: 1.4, symbol: ['diag'],
    blurb: 'State-mounted Maratha horsemen. Hunt archers, hit flanks and raid. An all-horse army marches two provinces a turn.',
  },
  shiledar: {
    ...horse, role: 'raider', name: 'Shiledar Cavalry', short: 'Shiledars', tier: 'B', cost: 16, upkeep: 1.5, maxMen: 40,
    speed: 82, melee: 1.2, defense: 1.2, charge: 1.8, armor: 0.35, morale: 72, value: 1.75, symbol: ['diag', 'bar'],
    blurb: 'Gentlemen-volunteers who bring their own horse and arms. Tougher than bargirs and nearly as quick.',
  },
  horsearcher: {
    ...horse, role: 'skirmish', weapon: 'bow', name: 'Turani Horse Archers', short: 'Horse Archers', tier: 'B', cost: 18,
    upkeep: 2, maxMen: 35, speed: 84, melee: 0.75, defense: 1.1, charge: 1.2, range: 220, missile: 0.04, armor: 0.3,
    morale: 72, value: 1.7, shootMoving: true, skirmish: true, symbol: ['diag', 'bow'],
    blurb: 'Mounted archers who shoot on the move and keep out of reach: their bows outrange the matchlock, so they can gall a formed line without ever closing.',
  },
  heavycav: {
    ...horse, role: 'shock', name: 'Sowar Heavy Horse', short: 'Sowars', tier: 'B', cost: 20, upkeep: 2, maxMen: 35,
    speed: 66, melee: 1.7, defense: 1.6, charge: 2.3, armor: 0.6, morale: 80, value: 2.1, symbol: ['diag', 'oval'],
    blurb: 'Armoured mansabdari lancers with a crushing charge. Braced spears stop them cold.',
  },
  rajput: {
    ...horse, role: 'shock', name: 'Rajput Cavalry', short: 'Rajputs', tier: 'A', cost: 24, upkeep: 2, maxMen: 35,
    speed: 68, melee: 1.9, defense: 1.6, charge: 2.5, armor: 0.5, morale: 92, value: 2.4,
    symbol: ['diag', 'oval', 'spearhead'],
    blurb: 'Clan horsemen sworn never to turn back. The fiercest charge in Hindustan.',
  },
  ahadi: {
    ...horse, role: 'shock', elite: true, name: 'Ahadi Imperial Troopers', short: 'Ahadis', tier: 'S', cost: 34, upkeep: 3,
    maxMen: 35, speed: 66, melee: 2.05, defense: 2.0, charge: 2.4, armor: 0.7, morale: 88, value: 2.9,
    symbol: ['diag', 'oval', 'topbar'],
    blurb: 'The Emperor’s own gentlemen-troopers, armoured head to foot. Raised only at the capital.',
  },
  huzurat: {
    ...horse, role: 'shock', elite: true, name: 'Huzurat Household Cavalry', short: 'Huzurat', tier: 'S', cost: 34, upkeep: 3,
    maxMen: 35, speed: 80, melee: 2.3, defense: 2.0, charge: 2.6, armor: 0.6, morale: 96, value: 3.1,
    symbol: ['diag', 'oval', 'mountain'],
    blurb: 'The Chhatrapati’s household horse, the finest riders in the Deccan. Quick as light horse, they hit like lancers and never break first. Raised only at the capital.',
  },
  // ---- Beasts and guns
  elephant: {
    ...foot, cls: 'elephant', role: 'beast', name: 'War Elephants', short: 'Elephants', tier: 'A', cost: 32, upkeep: 3,
    maxMen: 12, speed: 36, melee: 5.0, defense: 9.0, charge: 2.0, armor: 0.6, morale: 60, value: 6.5, fear: 2.5,
    climb: 0, gate: 0.5, symbol: ['oval'],
    blurb: 'Living battering rams. They terrify men and horses and break gates, but panic under fire and can run amok.',
  },
  cannon: {
    ...shot, cls: 'artillery', role: 'gun', weapon: 'cannon', name: 'Siege Guns', short: 'Guns', tier: 'B', cost: 26,
    upkeep: 2, maxMen: 20, speed: 9, melee: 0.3, defense: 0.6, range: 520, missile: 0.3, reload: 9, armor: 0,
    morale: 50, value: 1.3, climb: 0, gate: 0, wall: 24, symbol: ['dot'],
    blurb: 'Heavy bronze guns. Painfully slow, but they smash walls and gates from afar.',
  },
};

export const UNIT_TYPES = Object.keys(UNIT_STATS) as UnitType[];

export const isLarge = (t: UnitType) => {
  const c = UNIT_STATS[t].cls;
  return c === 'cavalry' || c === 'elephant';
};

/** Units that can break a gate or wall without siege equipment. */
export const isBreaker = (t: UnitType) => UNIT_STATS[t].wall > 0 || UNIT_STATS[t].cls === 'elephant';

export interface FactionDef {
  key: Owner;
  name: string;
  short: string;
  color: string;
  rgb: [number, number, number];
  /** 'major' expands, 'minor' defends and relieves sieges, 'none' never moves. */
  ai: 'major' | 'minor' | 'none';
  aggression: number;
  /** AI income multiplier (keeps the Mughal juggernaut from flooding the Deccan). */
  incomeMult: number;
  capital: string;
  roster: UnitType[];
  garrison: UnitType[];
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];
const F = (
  key: Owner, name: string, short: string, color: string, ai: FactionDef['ai'], aggression: number,
  incomeMult: number, capital: string, roster: UnitType[], garrison: UnitType[],
): FactionDef => ({ key, name, short, color, rgb: rgb(color), ai, aggression, incomeMult, capital, roster, garrison });

/** Index 0 is the player. The last entry is the independent chiefs. */
export const FACTION_DEFS: FactionDef[] = [
  F('mar', 'Maratha Swarajya', 'Marathas', '#e8821e', 'major', 0, 1, 'raigad',
    ['mavala', 'spear', 'archer', 'musket', 'rocket', 'lightcav', 'shiledar', 'huzurat'], ['mavala', 'musket', 'archer']),
  F('mug', 'Mughal Empire', 'Mughals', '#2e8b57', 'major', 0.8, 0.45, 'delhi',
    ['paik', 'spear', 'archer', 'musket', 'rocket', 'horsearcher', 'heavycav', 'rajput', 'ahadi', 'elephant', 'cannon'],
    ['spear', 'musket', 'archer']),
  F('bij', 'Adil Shahi Sultanate', 'Bijapur', '#8a55b5', 'major', 0.5, 0.8, 'bijapur',
    ['spear', 'habshi', 'archer', 'musket', 'lightcav', 'heavycav', 'elephant', 'cannon'], ['spear', 'musket', 'archer']),
  F('gol', 'Qutb Shahi Sultanate', 'Golconda', '#2a8fbf', 'major', 0.4, 0.8, 'golconda',
    ['spear', 'habshi', 'archer', 'musket', 'lightcav', 'heavycav', 'elephant', 'cannon'], ['spear', 'musket', 'archer']),
  F('raj', 'Rajput States', 'Rajputs', '#b8406b', 'minor', 0.2, 0.8, 'amber',
    ['paik', 'spear', 'archer', 'rajput', 'elephant'], ['spear', 'archer', 'paik']),
  F('sid', 'Siddis of Janjira', 'Siddis', '#4a4e6a', 'minor', 0.3, 1, 'janjira',
    ['spear', 'habshi', 'musket', 'cannon'], ['habshi', 'musket', 'musket']),
  F('por', 'Estado da Índia', 'Portuguese', '#c9d6ea', 'minor', 0.1, 1, 'goa',
    ['spear', 'musket', 'firangi', 'cannon'], ['firangi', 'musket', 'spear']),
  F('eng', 'East India Company', 'English', '#d23c2c', 'minor', 0.1, 1, 'bombay',
    ['spear', 'musket', 'firangi', 'cannon'], ['firangi', 'musket', 'spear']),
  F('nay', 'Nayaks of Madurai', 'Madurai', '#a8822a', 'minor', 0.3, 0.8, 'madurai',
    ['paik', 'spear', 'archer', 'musket', 'lightcav', 'elephant'], ['spear', 'archer', 'musket']),
  F('mys', 'Kingdom of Mysore', 'Mysore', '#c5649a', 'minor', 0.4, 0.9, 'mysore',
    ['spear', 'archer', 'musket', 'rocket', 'lightcav', 'elephant'], ['spear', 'rocket', 'archer']),
  F('aho', 'Ahom Kingdom', 'Ahoms', '#7d9a2e', 'minor', 0.3, 0.9, 'garhgaon',
    ['paik', 'spear', 'archer', 'musket'], ['spear', 'archer', 'musket']),
  F('ind', 'Independent Chiefs', 'Independents', '#8f897c', 'none', 0, 1, '',
    ['paik', 'spear', 'archer', 'lightcav'], ['paik', 'archer', 'spear']),
];

export const SEASONS = ['Winter', 'Spring', 'Monsoon', 'Autumn'] as const;
export const START_YEAR = 1670;

export function wallName(walls: number, kind: string, sea: boolean): string {
  if (walls <= 0) return 'Open town';
  if (walls === 1) return 'Mud walls';
  if (walls === 2) return 'Stone walls';
  if (sea) return 'Sea fort';
  return kind === 'fort' ? 'Hill fort' : 'Great walls';
}

/**
 * Commanders who lead each realm's armies, in the order they take the field:
 * [name, house]. When a realm runs out, captains are named generically.
 */
export const GENERALS: Record<Owner, [string, string][]> = {
  mar: [['Shivaji', 'Bhonsle'], ['Netaji', 'Palkar'], ['Tanaji', 'Malusare'], ['Prataprao', 'Gujar'], ['Hambirrao', 'Mohite'],
    ['Moropant', 'Pingale'], ['Yesaji', 'Kank'], ['Anaji', 'Datto'], ['Suryaji', 'Malusare'], ['Kondaji', 'Farzand']],
  mug: [['Diler Khan', 'Daudzai'], ['Mahabat Khan', 'Mughal'], ['Aurangzeb', 'Timurid'], ['Shaista Khan', 'Mughal'], ['Ram Singh', 'Kachhwaha'],
    ['Muazzam', 'Timurid'], ['Bahadur Khan', 'Kokaltash'], ['Daud Khan', 'Qureshi'], ['Khan Jahan', 'Mughal'], ['Ikhlas Khan', 'Mughal']],
  bij: [['Ali Adil Shah', 'Adil Shahi'], ['Bahlol Khan', 'Miana'], ['Khawas Khan', 'Habshi'], ['Sharza Khan', 'Adil Shahi'], ['Siddi Masud', 'Habshi']],
  gol: [['Abul Hasan', 'Qutb Shahi'], ['Madanna', 'Pandit'], ['Akkanna', 'Pandit'], ['Mir Jumla', 'Ardistani']],
  raj: [['Raj Singh', 'Sisodia'], ['Jaswant Singh', 'Rathore'], ['Durgadas', 'Rathore'], ['Anup Singh', 'Rathore']],
  sid: [['Siddi Qasim', 'Janjira'], ['Siddi Sambal', 'Janjira'], ['Siddi Khairiyat', 'Janjira']],
  por: [['Luís de Mendonça', 'Furtado'], ['António de Melo', 'Castro']],
  eng: [['Gerald Aungier', 'Company'], ['George Oxenden', 'Company']],
  nay: [['Chokkanatha', 'Nayak'], ['Rangakrishna', 'Muthu Virappa']],
  mys: [['Chikka Devaraja', 'Wodeyar'], ['Doddaiya', 'Dalavayi']],
  aho: [['Lachit', 'Borphukan'], ['Udayaditya', 'Singha'], ['Atan', 'Burhagohain']],
  ind: [['Local', 'Chieftain']],
};
