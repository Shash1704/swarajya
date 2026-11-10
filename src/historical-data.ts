/**
 * The historical battles' data: armies, regiments, commanders and formations (no DOM, so
 * it can be tested headless). See historical.ts for the menu and how they are fought.
 */
import type { BattleMap, LeaderMods } from './battle/battle';
import type { UnitType } from './data';

const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;
const EAST = 0;
const WEST = Math.PI;

/** One regiment: its kind, whose men they are, and where it stands. */
export type Reg = [UnitType, string, number, number, number?];

export interface Scenario {
  id: string;
  title: string;
  date: string;
  place: string;
  /** What led to the battle and what the player faces. */
  brief: string[];
  /** The orders of battle, in words. */
  marathas: string;
  enemy: string;
  enemyName: string;
  enemyShort: string;
  enemyColor: string;
  enemyRgb: [number, number, number];
  playerGeneral: string;
  enemyGeneral: string;
  leaders: [LeaderMods, LeaderMods];
  leaderNotes: [string, string];
  playerAttacks: boolean;
  /** Regiments with their historical places (field 1620 x 1080; the Marathas start at the bottom). */
  mine: Reg[];
  theirs: Reg[];
  zone0?: [number, number];
  thirst?: [number, number];
  /** The regiments (index in `mine`, `theirs`) the two commanders ride with. */
  generals: [number, number];
  /** The real ground, drawn for the battle. */
  map: BattleMap;
  /** What really happened, shown after the battle. */
  history: string;
}

const BAJIRAO: LeaderMods = { morale: 1.15, melee: 1.05, charge: 1.2, horse: 1.15, defense: 1, fatigue: 0.85 };
const BAJIRAO_NOTE = 'Peshwa Bajirao I: never beaten in the field; his horse rides farther and hits harder';

export const SCENARIOS: Scenario[] = [
  {
    id: 'palkhed',
    title: 'Battle of Palkhed',
    date: '25 February 1728',
    place: 'Palkhed, west of Aurangabad',
    brief: [
      'The Nizam-ul-Mulk, Asaf Jah, has refused the Marathas their chauth and sardeshmukhi in the Deccan, and taken up the cause of Sambhaji of Kolhapur against Chhatrapati Shahu. While he plundered the country round Pune with his guns, Peshwa Bajirao rode the other way: through Jalna, Berar, Khandesh and into Gujarat, burning the Nizam\'s lands and drawing him out after him.',
      'Now the Nizam has crossed the Godavari to bring Bajirao to battle on an open plain where his artillery would tell, but in his haste he has marched ahead of his great guns. At Palkhed the Maratha horse has closed round him on every side, and cut him off from his supplies and from the water of the Shiv Nala to the north. His army is parched and penned in.',
      'Your army is horse only, as it was: no infantry and no guns. Your horse archers ride close, loose their arrows into the packed square and wheel away before the spears and sowars can reach them. Hold the ring, keep clear of the matchlocks and the few light pieces that kept up, and break the Nizam\'s army before it breaks out.',
    ],
    marathas: 'Peshwa Bajirao with his household horse and shiledars to the south; Malharrao Holkar\'s horse to the west, Ranoji Shinde\'s to the east, the Pawars\' across the water to the north, two squadrons of shiledars in reserve, and horse archers harassing the square. 17 regiments, all cavalry.',
    enemy: 'Nizam-ul-Mulk on his elephant in the centre; matchlockmen and a few light guns in front, Deccani spearmen at the rear; his Mughal sowars on both wings; Rao Chandrasen Jadhav\'s and Sambhaji of Kolhapur\'s Maratha horse fighting for the Nizam. 22 regiments, drawn up in a hollow square. Parched: they never shake off their fatigue.',
    enemyName: 'Army of the Nizam-ul-Mulk', enemyShort: 'Nizam', enemyColor: '#c9a227', enemyRgb: [201, 162, 39],
    playerGeneral: 'Peshwa Bajirao', enemyGeneral: 'Nizam-ul-Mulk',
    leaders: [BAJIRAO, { morale: 1.1, melee: 1, charge: 1, horse: 1, defense: 1.15, fatigue: 1 }],
    leaderNotes: [BAJIRAO_NOTE, 'Nizam-ul-Mulk Asaf Jah: a veteran of Aurangzeb\'s wars; his lines hold hard'],
    playerAttacks: true,
    mine: [
      ['huzurat', 'the Peshwa\'s household horse', 780, 960, UP],
      ['huzurat', 'the Peshwa\'s own paga', 850, 960, UP],
      ['shiledar', 'the Peshwa\'s shiledars', 680, 985, UP],
      ['shiledar', 'the Peshwa\'s shiledars', 950, 985, UP],
      ['lightcav', 'Malharrao Holkar\'s horse', 170, 330, EAST],
      ['lightcav', 'Malharrao Holkar\'s horse', 170, 440, EAST],
      ['lightcav', 'Malharrao Holkar\'s horse', 170, 550, EAST],
      ['lightcav', 'Ranoji Shinde\'s horse', 1450, 330, WEST],
      ['lightcav', 'Ranoji Shinde\'s horse', 1450, 440, WEST],
      ['lightcav', 'Ranoji Shinde\'s horse', 1450, 550, WEST],
      ['lightcav', 'the Pawars\' horse at the Shiv Nala', 720, 45, DOWN],
      ['lightcav', 'the Pawars\' horse at the Shiv Nala', 900, 45, DOWN],
      ['shiledar', 'shiledars in reserve', 470, 770, UP],
      ['shiledar', 'shiledars in reserve', 1150, 770, UP],
      ['lightcav', 'bargirs of the Peshwa\'s paga', 810, 1035, UP],
      ['horsearcher', 'Maratha horse archers', 470, 600, -0.46],
      ['horsearcher', 'Maratha horse archers', 1150, 600, -2.68],
    ],
    theirs: [
      ['musket', 'the Nizam\'s matchlockmen', 690, 520, DOWN],
      ['musket', 'the Nizam\'s matchlockmen', 770, 535, DOWN],
      ['musket', 'the Nizam\'s matchlockmen', 850, 535, DOWN],
      ['musket', 'the Nizam\'s matchlockmen', 930, 520, DOWN],
      ['cannon', 'light pieces (the great guns lag behind)', 740, 585, DOWN],
      ['cannon', 'light pieces (the great guns lag behind)', 880, 585, DOWN],
      ['rocket', 'the Nizam\'s rocketmen', 810, 485, DOWN],
      ['elephant', 'Nizam-ul-Mulk\'s elephant', 810, 425, DOWN],
      ['elephant', 'war elephants of the centre', 810, 370, DOWN],
      ['spear', 'Deccani spearmen of the rear face', 740, 330, UP],
      ['spear', 'Deccani spearmen of the rear face', 880, 330, UP],
      ['heavycav', 'Mughal sowars of the left wing', 590, 380, WEST],
      ['heavycav', 'Mughal sowars of the left wing', 585, 460, WEST],
      ['heavycav', 'Mughal sowars of the left wing', 630, 535, DOWN],
      ['heavycav', 'Mughal sowars of the right wing', 1030, 380, EAST],
      ['heavycav', 'Mughal sowars of the right wing', 1035, 460, EAST],
      ['heavycav', 'Mughal sowars of the right wing', 990, 535, DOWN],
      ['musket', 'the Nizam\'s matchlockmen of the flanks', 640, 420, WEST],
      ['musket', 'the Nizam\'s matchlockmen of the flanks', 980, 420, EAST],
      ['heavycav', 'Iwaz Khan\'s sowars', 810, 300, UP],
      ['lightcav', 'Rao Chandrasen Jadhav\'s horse', 690, 270, UP],
      ['lightcav', 'Sambhaji of Kolhapur\'s horse', 930, 270, UP],
    ],
    // The Marathas ring the Nizam: they may take post anywhere on the field.
    zone0: [20, 1060],
    map: {
      // The Shiv Nala to the north: the Nizam's only water, held against him by the Pawars.
      rivers: [{
        pts: [[-40, 190], [120, 176], [280, 186], [440, 170], [600, 182], [760, 166], [920, 178], [1080, 164], [1240, 180], [1400, 168], [1560, 182], [1660, 176]],
        w: 30, fords: [{ x: 380, y: 177, r: 40 }, { x: 1240, y: 180, r: 40 }],
      }],
      villages: [{ x: 1250, y: 680, r: 48 }],
      // Low rises of the Deccan plateau, and babul scrub.
      hills: [{ x: 330, y: 890, r: 140, h: 0.45 }, { x: 1430, y: 905, r: 120, h: 0.4 }, { x: 150, y: 90, r: 110, h: 0.5 }],
      forests: [{ x: 520, y: 80, r: 42 }, { x: 1150, y: 75, r: 48 }, { x: 600, y: 720, r: 36 }],
      labels: [
        { x: 640, y: 214, text: 'Shiv Nala', rot: -0.03 },
        { x: 1250, y: 612, text: 'Palkhed village' },
        { x: 1430, y: 1000, text: 'to Aurangabad, 30 miles →', size: 22 },
      ],
    },
    generals: [0, 7],
    thirst: [0, 0.1],
    history: 'At Palkhed the Nizam, cut off from food and water and surrounded by horse he could not bring to battle, gave in without a great fight. On 6 March 1728 he signed the Treaty of Mungi Shevgaon: he recognised Shahu as the Chhatrapati, gave up the cause of Sambhaji of Kolhapur, and granted the Marathas the right to collect chauth and sardeshmukhi in the Deccan. Jadunath Sarkar called the campaign a classic example of what light horse led by a genius could achieve.',
  },
  {
    id: 'delhi',
    title: 'Battle of Delhi',
    date: '28 March 1737',
    place: 'Rikabganj and Talkatora, outside Delhi',
    brief: [
      'Saadat Khan of Awadh boasted that he had driven the Marathas back across the Chambal. To give him the lie, Bajirao left the main Mughal armies behind him on the Agra road and rode for the capital by the Jat and Mewati hill tracks, covering in days what an imperial army marched in weeks.',
      'His horse now camps by the Talkatora tank, at the gates of Delhi. Emperor Muhammad Shah sends Mir Hasan Khan Koka out of the city against him, with the imperial household troopers, the nobles\' contingents, matchlockmen and his elephant.',
      'The Mughals come on in the old order: matchlocks in front, the heavy horse of the vanguard behind them, the commander on his elephant among the household troopers, and a wing to each side. Draw them away from their guns, then fall on their flanks. Feigned flight (F) was the Marathas\' oldest trick.',
    ],
    marathas: 'Peshwa Bajirao with his household horse in reserve; a screen of light horse before the camp; Ranoji Shinde\'s horse on the left wing and Malharrao Holkar\'s on the right, lying back on the flanks; horse archers to gall the Mughal ranks. 16 regiments, all cavalry, after a long forced march.',
    enemy: 'Mir Hasan Khan Koka on his elephant, with the Ahadi household troopers; matchlockmen at the front; the heavy horse of the vanguard; the nobles\' sowars on both wings. 12 regiments, the best armour in Hindustan.',
    enemyName: 'Mughal Empire', enemyShort: 'Mughals', enemyColor: '#2f8f4e', enemyRgb: [47, 143, 78],
    playerGeneral: 'Peshwa Bajirao', enemyGeneral: 'Mir Hasan Khan Koka',
    leaders: [BAJIRAO, { morale: 1, melee: 1, charge: 1.05, horse: 1.05, defense: 1, fatigue: 1 }],
    leaderNotes: [BAJIRAO_NOTE, 'Mir Hasan Khan Koka: the Emperor\'s foster-brother, brave but untried against the Marathas'],
    playerAttacks: false,
    mine: [
      ['lightcav', 'the screen before the camp', 650, 760, UP],
      ['lightcav', 'the screen before the camp', 760, 760, UP],
      ['lightcav', 'the screen before the camp', 860, 760, UP],
      ['lightcav', 'the screen before the camp', 970, 760, UP],
      ['shiledar', 'Ranoji Shinde\'s horse', 240, 640, UP + 0.4],
      ['shiledar', 'Ranoji Shinde\'s horse', 250, 730, UP + 0.4],
      ['lightcav', 'Ranoji Shinde\'s horse', 330, 680, UP + 0.4],
      ['lightcav', 'Ranoji Shinde\'s horse', 335, 770, UP + 0.4],
      ['shiledar', 'Malharrao Holkar\'s horse', 1380, 640, UP - 0.4],
      ['shiledar', 'Malharrao Holkar\'s horse', 1370, 730, UP - 0.4],
      ['lightcav', 'Malharrao Holkar\'s horse', 1290, 680, UP - 0.4],
      ['lightcav', 'Malharrao Holkar\'s horse', 1285, 770, UP - 0.4],
      ['huzurat', 'the Peshwa\'s household horse', 780, 920, UP],
      ['huzurat', 'the Peshwa\'s own paga', 850, 920, UP],
      ['horsearcher', 'Maratha horse archers', 540, 720, UP],
      ['horsearcher', 'Maratha horse archers', 1080, 760, UP],
    ],
    theirs: [
      ['musket', 'imperial matchlockmen', 700, 400, DOWN],
      ['musket', 'imperial matchlockmen', 920, 400, DOWN],
      ['heavycav', 'the vanguard (harawal)', 700, 320, DOWN],
      ['heavycav', 'the vanguard (harawal)', 810, 315, DOWN],
      ['heavycav', 'the vanguard (harawal)', 920, 320, DOWN],
      ['ahadi', 'Ahadi household troopers', 740, 235, DOWN],
      ['elephant', 'Mir Hasan Khan Koka\'s elephant', 810, 220, DOWN],
      ['ahadi', 'Ahadi household troopers', 880, 235, DOWN],
      ['heavycav', 'the nobles\' sowars, left wing', 470, 290, DOWN],
      ['heavycav', 'the nobles\' sowars, left wing', 480, 365, DOWN],
      ['heavycav', 'the nobles\' sowars, right wing', 1150, 290, DOWN],
      ['heavycav', 'the nobles\' sowars, right wing', 1140, 365, DOWN],
    ],
    // Weary horses after the forced march.
    thirst: [0.05, 0],
    map: {
      // The Delhi Ridge along the west, the Talkatora tank by the Maratha camp, Rikabganj to the east,
      // and the road north-east to Shahjahanabad, the walled city, from which the Mughals sallied.
      hills: [{ x: 170, y: 180, r: 150, h: 0.8 }, { x: 150, y: 430, r: 150, h: 0.75 }, { x: 205, y: 690, r: 130, h: 0.6 }],
      forests: [{ x: 115, y: 300, r: 60 }, { x: 235, y: 545, r: 48 }, { x: 1330, y: 150, r: 55 }, { x: 1400, y: 470, r: 50 }],
      rivers: [{ pts: [[525, 885], [640, 878]], w: 72, fords: [] }],
      villages: [{ x: 1080, y: 650, r: 45 }],
      labels: [
        { x: 160, y: 470, text: 'Delhi Ridge', rot: -Math.PI / 2, size: 30 },
        { x: 585, y: 955, text: 'Talkatora tank' },
        { x: 1080, y: 585, text: 'Rikabganj' },
        { x: 1330, y: 40, text: 'to Shahjahanabad, the walled city ↗', size: 22 },
        { x: 600, y: 1000, text: 'Bajirao\'s camp', size: 22 },
      ],
    },
    generals: [12, 6],
    history: 'At Rikabganj the Marathas routed the force that came out of Delhi, and Mir Hasan Khan Koka was carried from the field wounded. Bajirao did not storm the city: hearing that the Vizier Qamar-ud-din Khan was hurrying back with the main army, he drew off, skirmished with it at Badshahpur in failing light, and rode away by Narnaul. The raid showed all Hindustan that the Mughal capital lay open to the Maratha horse. Accounts of the numbers on each side differ widely.',
  },
];

