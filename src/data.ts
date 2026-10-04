export type UnitType = 'spear' | 'archer' | 'knight';

export interface UnitStats {
  name: string;
  /** Recruitment cost in gold. */
  cost: number;
  /** Battlefield speed in pixels per second. */
  speed: number;
  melee: number;
  defense: number;
  /** Missile range in pixels (0 = melee only). */
  range: number;
  ranged: number;
  morale: number;
  maxMen: number;
  /** Per-man strength used by auto-resolve and the campaign AI. */
  value: number;
  blurb: string;
}

export const UNIT_TYPES: UnitType[] = ['spear', 'archer', 'knight'];

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  spear: {
    name: 'Spearmen', cost: 10, speed: 32, melee: 1.0, defense: 1.2, range: 0, ranged: 0,
    morale: 70, maxMen: 60, value: 1.0,
    blurb: 'Hold the line. Brace against cavalry charges and deal bonus damage to knights.',
  },
  archer: {
    name: 'Archers', cost: 12, speed: 34, melee: 0.5, defense: 0.8, range: 240, ranged: 0.55,
    morale: 55, maxMen: 50, value: 0.9,
    blurb: 'Shoot enemies in range when standing still. Fragile in melee; arrows glance off knights.',
  },
  knight: {
    name: 'Knights', cost: 22, speed: 70, melee: 2.2, defense: 1.8, range: 0, ranged: 0,
    morale: 85, maxMen: 30, value: 2.4,
    blurb: 'Fast, armoured, and devastating on the charge, but braced spears stop them cold.',
  },
};

export const UNIT_ICON: Record<UnitType, string> = { spear: '↟', archer: '➶', knight: '♞' };

export interface FactionDef {
  name: string;
  color: string;
  rgb: [number, number, number];
}

/** Index 0 is the player; index 4 is the neutral "Free Lords". */
export const FACTION_DEFS: FactionDef[] = [
  { name: 'Kingdom of Aldmere', color: '#3567c8', rgb: [53, 103, 200] },
  { name: 'Duchy of Varn', color: '#b8322a', rgb: [184, 50, 42] },
  { name: 'Principality of Kesh', color: '#d19a1c', rgb: [209, 154, 28] },
  { name: 'Marches of Ostra', color: '#2f8f4e', rgb: [47, 143, 78] },
  { name: 'Free Lords', color: '#7d7a70', rgb: [125, 122, 112] },
];

export const PROVINCE_NAMES = [
  'Ashford', 'Brackenmoor', 'Caerwyn', 'Dunmarrow', 'Eastwatch', 'Fallowmere', 'Glenhollow',
  'Harrowgate', 'Ironvale', 'Kingsbridge', 'Larkspur', 'Marrowdale', 'Northfold', 'Oakheart',
  'Pennick', 'Ravensholt', 'Saltmarsh', 'Thornbury', 'Umberleigh', 'Valewood', 'Westreach',
  'Yarrowfield', 'Blackwater', 'Coldharbour', 'Dragonsmouth', 'Eldermoor', 'Foxhollow',
  'Greywatch', 'Highcairn', 'Kestrel Downs', 'Lindmoor', 'Mistral', 'Nettlebed', 'Oxenford',
  'Redcliff', 'Stonehaven', 'Tarnwick', 'Wolfden', 'Brightwater', 'Copperhill', 'Duskwood',
  'Emberlyn', 'Gallowmere', 'Hartsfield',
];
