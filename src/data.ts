import type { Owner } from './india';

export type UnitType =
  | 'mavala' | 'spear' | 'archer' | 'musket' | 'lightcav' | 'heavycav'
  | 'horsearcher' | 'elephant' | 'rocket' | 'cannon';

export type UnitClass = 'infantry' | 'missile' | 'cavalry' | 'elephant' | 'artillery';

export interface UnitStats {
  name: string;
  short: string;
  cls: UnitClass;
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
  glyph: string;
  blurb: string;
}

const base = {
  charge: 1, range: 0, missile: 0, reload: 0, armor: 0.1, antiLarge: 1, fear: 0, climb: 1,
  gate: 0.01, wall: 0, shootMoving: false, skirmish: false, wild: false,
};

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  mavala: {
    ...base, name: 'Mavalas', short: 'Mavalas', cls: 'infantry', cost: 9, upkeep: 1, maxMen: 60,
    speed: 40, melee: 1.15, defense: 1.0, charge: 1.3, armor: 0.15, morale: 75, value: 1.1,
    climb: 2.5, wild: true, glyph: '⚔',
    blurb: 'Hardy hill infantry of the Maval. Quick on foot, deadly in forests and hills, and they scale fort walls fast.',
  },
  spear: {
    ...base, name: 'Bhaldar Spearmen', short: 'Spearmen', cls: 'infantry', cost: 8, upkeep: 1, maxMen: 60,
    speed: 30, melee: 0.95, defense: 1.25, armor: 0.3, morale: 65, value: 1.0, antiLarge: 1.9, glyph: '↟',
    blurb: 'Steady spear blocks. Brace against horse and elephant charges.',
  },
  archer: {
    ...base, name: 'Tirandaz Archers', short: 'Archers', cls: 'missile', cost: 10, upkeep: 1, maxMen: 50,
    speed: 33, melee: 0.5, defense: 0.75, range: 230, missile: 0.0275, morale: 55, value: 0.9, glyph: '➶',
    blurb: 'Shoot steadily while standing still. Weak in melee; arrows glance off armour.',
  },
  musket: {
    ...base, name: 'Toradar Matchlocks', short: 'Matchlocks', cls: 'missile', cost: 14, upkeep: 1, maxMen: 50,
    speed: 30, melee: 0.6, defense: 0.8, range: 190, missile: 0.17, reload: 6, morale: 60, value: 1.1, glyph: '✦',
    blurb: 'Slow, thunderous volleys that punch through armour and scare elephants. Rain soaks the powder.',
  },
  lightcav: {
    ...base, name: 'Bargir Light Horse', short: 'Light Horse', cls: 'cavalry', cost: 12, upkeep: 1.5, maxMen: 40,
    speed: 85, melee: 0.85, defense: 0.9, charge: 1.5, armor: 0.2, morale: 65, value: 1.4, climb: 0, gate: 0,
    glyph: '♘',
    blurb: 'Swift Maratha horsemen. Hunt archers, hit flanks, and raid. An all-horse army marches two provinces a turn.',
  },
  heavycav: {
    ...base, name: 'Sowar Heavy Horse', short: 'Heavy Horse', cls: 'cavalry', cost: 20, upkeep: 2, maxMen: 35,
    speed: 66, melee: 1.7, defense: 1.6, charge: 2.3, armor: 0.6, morale: 80, value: 2.1, climb: 0, gate: 0,
    glyph: '♞',
    blurb: 'Armoured lancers with a crushing charge. Braced spears stop them cold.',
  },
  horsearcher: {
    ...base, name: 'Turani Horse Archers', short: 'Horse Archers', cls: 'cavalry', cost: 18, upkeep: 2, maxMen: 35,
    speed: 80, melee: 0.7, defense: 1.0, charge: 1.2, range: 200, missile: 0.025, armor: 0.3, morale: 65,
    value: 1.7, climb: 0, gate: 0, shootMoving: true, skirmish: true, glyph: '➹',
    blurb: 'Mounted archers who shoot on the move and keep out of reach.',
  },
  elephant: {
    ...base, name: 'War Elephants', short: 'Elephants', cls: 'elephant', cost: 32, upkeep: 3, maxMen: 12,
    speed: 36, melee: 5.0, defense: 9.0, charge: 2.0, armor: 0.6, morale: 60, value: 6.5, fear: 2.5, climb: 0,
    gate: 0.5, glyph: '🐘',
    blurb: 'Living battering rams. They terrify men and horses and break gates, but panic under fire and can run amok.',
  },
  rocket: {
    ...base, name: 'Ban Rocketmen', short: 'Rocketmen', cls: 'missile', cost: 13, upkeep: 1, maxMen: 40,
    speed: 30, melee: 0.4, defense: 0.7, range: 300, missile: 0.12, reload: 5, morale: 55, value: 0.9, glyph: '➚',
    blurb: 'Iron-cased rockets. Wildly inaccurate, but they panic elephants and horses.',
  },
  cannon: {
    ...base, name: 'Siege Guns', short: 'Guns', cls: 'artillery', cost: 26, upkeep: 2, maxMen: 20,
    speed: 9, melee: 0.3, defense: 0.6, range: 520, missile: 0.3, reload: 9, armor: 0, morale: 50, value: 1.3,
    climb: 0, gate: 0, wall: 24, glyph: '◎',
    blurb: 'Heavy bronze guns. Painfully slow, but they smash walls and gates from afar.',
  },
};

export const UNIT_TYPES = Object.keys(UNIT_STATS) as UnitType[];

export const isLarge = (t: UnitType) => {
  const c = UNIT_STATS[t].cls;
  return c === 'cavalry' || c === 'elephant';
};

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
    ['mavala', 'spear', 'archer', 'musket', 'lightcav', 'rocket'], ['mavala', 'musket', 'archer']),
  F('mug', 'Mughal Empire', 'Mughals', '#2e8b57', 'major', 0.8, 0.3, 'delhi',
    ['spear', 'archer', 'musket', 'heavycav', 'horsearcher', 'elephant', 'rocket', 'cannon'], ['spear', 'musket', 'archer']),
  F('bij', 'Adil Shahi Sultanate', 'Bijapur', '#8a55b5', 'major', 0.5, 0.8, 'bijapur',
    ['spear', 'archer', 'musket', 'lightcav', 'heavycav', 'elephant', 'cannon'], ['spear', 'musket', 'archer']),
  F('gol', 'Qutb Shahi Sultanate', 'Golconda', '#2a8fbf', 'major', 0.4, 0.8, 'golconda',
    ['spear', 'archer', 'musket', 'lightcav', 'heavycav', 'elephant', 'cannon'], ['spear', 'musket', 'archer']),
  F('raj', 'Rajput States', 'Rajputs', '#b8406b', 'minor', 0.2, 0.8, 'amber',
    ['spear', 'archer', 'heavycav', 'elephant'], ['spear', 'archer', 'spear']),
  F('sid', 'Siddis of Janjira', 'Siddis', '#4a4e6a', 'minor', 0.3, 1, 'janjira',
    ['spear', 'musket', 'archer', 'cannon'], ['musket', 'spear', 'musket']),
  F('por', 'Estado da Índia', 'Portuguese', '#c9d6ea', 'minor', 0.1, 1, 'goa',
    ['musket', 'spear', 'cannon'], ['musket', 'musket', 'spear']),
  F('eng', 'East India Company', 'English', '#d23c2c', 'minor', 0.1, 1, 'bombay',
    ['musket', 'spear', 'cannon'], ['musket', 'musket', 'spear']),
  F('nay', 'Nayaks of Madurai', 'Madurai', '#a8822a', 'minor', 0.3, 0.8, 'madurai',
    ['spear', 'archer', 'musket', 'lightcav', 'elephant'], ['spear', 'archer', 'musket']),
  F('mys', 'Kingdom of Mysore', 'Mysore', '#c5649a', 'minor', 0.4, 0.9, 'mysore',
    ['spear', 'archer', 'musket', 'lightcav', 'elephant', 'rocket'], ['spear', 'rocket', 'archer']),
  F('aho', 'Ahom Kingdom', 'Ahoms', '#7d9a2e', 'minor', 0.3, 0.9, 'garhgaon',
    ['spear', 'archer', 'musket'], ['spear', 'archer', 'musket']),
  F('ind', 'Independent Chiefs', 'Independents', '#8f897c', 'none', 0, 1, '',
    ['spear', 'archer', 'musket', 'lightcav'], ['spear', 'archer', 'musket']),
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
