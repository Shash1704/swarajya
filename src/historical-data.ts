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
  /** A ringed, starving army (see BattleOptions.encircled). */
  encircled?: { side: 0 | 1; starveSeconds: number; relief?: number[] };
  /** Each side's starting heart (1 = as usual). */
  morale?: [number, number];
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
      'Now the Nizam has crossed the Godavari to bring Bajirao to battle on an open plain where his artillery would tell, but in his haste he has left his great guns behind at Puntamba, on the far bank. At Palkhed, under the long ridge to the north, the Maratha horse has closed round him: Pilaji Jadhav to the north-east, the Peshwa himself to the east across the Shiv nadi, the Nizam\'s water, Davalji Somvanshi to the south-east, and Malharrao Holkar riding in from the west. His army is parched and penned in.',
      'This was not won by a great charge but by the ring. You need not destroy the Nizam\'s army: hold the ring and let hunger do the work. Every minute his camp starves and his men lose heart, until his army breaks and he asks for terms. He wins if he breaks out: if his own regiment reaches the edge of the field, the trap has failed. His great guns are marching up from Puntamba with food and powder; if they reach him, his camp takes heart again, so cut them off. It is the dry season: the rivers are low and can be forded anywhere, but men in the water are easy prey for a charge. Your army is horse only, as it was: no infantry and no guns.',
    ],
    marathas: 'Pilaji Jadhav\'s horse to the north-east (8 regiments); Peshwa Bajirao with his household horse beyond the Shiv nadi to the east (6); Davalji Somvanshi\'s horse to the south-east (6); Malharrao Holkar\'s horse to the west (5). Each division has a squadron of horse archers to gall the Nizam\'s ranks. 25 regiments, all cavalry, most of them light horse with spear and sword.',
    enemy: 'Nizam-ul-Mulk on his elephant at Palkhed, his army bent in a crescent round the village: sowars and matchlocks facing Pilaji to the north-east, spearmen and Iwaz Khan\'s sowars facing Holkar to the west, matchlocks and two light pieces facing the Peshwa to the east, sowars facing Davalji to the south; the Maratha horse of Rao Chandrasen Jadhav, Rao Rambha Nimbalkar and Sambhaji of Kolhapur fighting for the Nizam. 28 regiments, far more foot than the Maratha horse can ride down, and his great guns with their guard far off at Puntamba. Hungry and parched after weeks of Bajirao cutting his convoys and burning his forage, and starving further every minute the ring holds.',
    enemyName: 'Army of the Nizam-ul-Mulk', enemyShort: 'Nizam', enemyColor: '#c9a227', enemyRgb: [201, 162, 39],
    playerGeneral: 'Peshwa Bajirao', enemyGeneral: 'Nizam-ul-Mulk',
    leaders: [BAJIRAO, { morale: 1.2, melee: 1.1, charge: 1, horse: 1, defense: 1.35, fatigue: 1 }],
    leaderNotes: [BAJIRAO_NOTE, 'Nizam-ul-Mulk Asaf Jah: a veteran of Aurangzeb\'s wars; his lines hold hard'],
    playerAttacks: true,
    mine: [
      ['lightcav', 'Pilaji Jadhav\'s horse', 870, 250, 2.4],
      ['shiledar', 'Pilaji Jadhav\'s horse', 952, 254, 2.4],
      ['lightcav', 'Pilaji Jadhav\'s horse', 962, 314, 2.4],
      ['horsearcher', 'Pilaji Jadhav\'s horse archers', 1034, 314, 2.4],
      ['lightcav', 'Pilaji Jadhav\'s horse', 1034, 371, 2.4],
      ['shiledar', 'Pilaji Jadhav\'s horse', 1146, 357, 2.4],
      ['lightcav', 'Pilaji Jadhav\'s horse', 1194, 385, 2.4],
      ['lightcav', 'Pilaji Jadhav\'s horse', 1253, 428, 2.4],
      ['shiledar', 'the Peshwa\'s shiledars', 1290, 492, WEST],
      ['lightcav', 'bargirs of the Peshwa\'s paga', 1358, 520, WEST],
      ['huzurat', 'the Peshwa\'s household horse', 1294, 541, WEST],
      ['huzurat', 'the Peshwa\'s own paga', 1296, 598, WEST],
      ['horsearcher', 'the Peshwa\'s horse archers', 1276, 683, WEST],
      ['shiledar', 'the Peshwa\'s shiledars', 1224, 733, WEST],
      ['lightcav', 'Davalji Somvanshi\'s horse', 1116, 768, -2.2],
      ['shiledar', 'Davalji Somvanshi\'s horse', 1112, 818, -2.2],
      ['lightcav', 'Davalji Somvanshi\'s horse', 1034, 808, -2.2],
      ['horsearcher', 'Davalji Somvanshi\'s horse archers', 948, 839, -2.2],
      ['lightcav', 'Davalji Somvanshi\'s horse', 870, 879, -2.2],
      ['lightcav', 'Davalji Somvanshi\'s horse', 798, 910, -2.2],
      ['lightcav', 'Malharrao Holkar\'s horse', 210, 477, EAST],
      ['lightcav', 'Malharrao Holkar\'s horse', 173, 555, EAST],
      ['shiledar', 'Malharrao Holkar\'s horse', 173, 619, EAST],
      ['lightcav', 'Malharrao Holkar\'s horse', 208, 697, EAST],
      ['horsearcher', 'Malharrao Holkar\'s horse archers', 275, 747, EAST],
    ],
    theirs: [
      ['heavycav', 'Mughal sowars facing Pilaji', 767, 357, -0.785],
      ['heavycav', 'Mughal sowars facing Pilaji', 814, 389, -0.785],
      ['musket', 'the Nizam\'s matchlockmen', 859, 420, -0.785],
      ['musket', 'the Nizam\'s matchlockmen', 905, 453, -0.785],
      ['elephant', 'Nizam-ul-Mulk\'s elephant', 835, 506, -0.785],
      ['elephant', 'war elephants', 915, 544, -0.785],
      ['lightcav', 'Rao Chandrasen Jadhav\'s horse', 736, 428, -0.785],
      ['heavycav', 'Iwaz Khan\'s sowars', 681, 456, WEST],
      ['spear', 'Deccani spearmen of the west face', 696, 516, WEST],
      ['musket', 'the Nizam\'s matchlockmen of the west face', 747, 570, 2.6],
      ['spear', 'Deccani spearmen of the west face', 798, 609, 2.4],
      ['lightcav', 'Sambhaji of Kolhapur\'s horse', 839, 626, 2.2],
      ['heavycav', 'Mughal sowars facing the Peshwa', 976, 506, EAST],
      ['musket', 'the Nizam\'s matchlockmen', 978, 548, EAST],
      ['musket', 'the Nizam\'s matchlockmen', 982, 591, EAST],
      ['cannon', 'light pieces (the great guns lag behind)', 1028, 534, EAST],
      ['cannon', 'light pieces (the great guns lag behind)', 1032, 598, EAST],
      ['rocket', 'the Nizam\'s rocketmen', 931, 598, 0.4],
      ['musket', 'the Nizam\'s matchlockmen', 978, 634, 0.4],
      ['heavycav', 'Mughal sowars facing Davalji', 925, 665, 0.785],
      ['heavycav', 'Mughal sowars facing Davalji', 870, 693, DOWN],
      ['cannon', 'the Nizam\'s great guns, left at Puntamba', 122, 910, -0.785],
      ['cannon', 'the Nizam\'s great guns, left at Puntamba', 224, 925, -0.785],
      ['cannon', 'the Nizam\'s great guns, left at Puntamba', 173, 981, -0.785],
      ['musket', 'the gun guard at Puntamba', 275, 981, -0.785],
      ['lightcav', 'Rao Rambha Nimbalkar\'s horse', 640, 600, 2.6],
      // The Nizam's foot: far more of it than the Maratha horse could hope to ride down.
      ['musket', 'the Nizam\'s matchlockmen', 905, 395, -0.785],
      ['musket', 'the Nizam\'s matchlockmen', 760, 545, 2.6],
      ['musket', 'the Nizam\'s matchlockmen', 1030, 700, 0.6],
      ['spear', 'Deccani spearmen', 950, 720, 1.0],
      ['spear', 'Deccani spearmen', 830, 690, 1.57],
      ['musket', 'the Nizam\'s matchlockmen', 700, 420, 3.0],
    ],
    // The Marathas ring the Nizam: they may take post anywhere on the field.
    zone0: [20, 1060],
    // Drawn after the period map of the battle: the ridge to the north, the Shiv nadi to the east
    // (the Nizam's water, held by Bajirao), the Godavari to the south-west with Puntamba ford,
    // where the Nizam's heavy guns were left behind.
    map: {
      rivers: [
        { pts: [[19, 771], [60, 776], [193, 797], [337, 825], [439, 846], [562, 882], [624, 903], [706, 953], [808, 1003], [911, 1052], [972, 1102]], w: 54, fords: [{ x: 337, y: 825, r: 46 }], shallow: true },
        { pts: [[1208, 385], [1214, 428], [1222, 470], [1239, 520], [1218, 555], [1188, 626], [1177, 697], [1208, 754], [1188, 811], [1300, 882], [1464, 925], [1587, 946]], w: 24, fords: [{ x: 1239, y: 520, r: 36 }, { x: 1181, y: 676, r: 36 }, { x: 1300, y: 882, r: 36 }], shallow: true },
        { pts: [[870, 503], [993, 501], [1095, 506], [1177, 510], [1228, 527]], w: 16, fords: [], shallow: true },
        { pts: [[624, 903], [607, 839], [599, 790]], w: 14, fords: [], shallow: true },
        { pts: [[644, 875], [696, 811], [747, 733]], w: 14, fords: [], shallow: true },
      ],
      villages: [{ x: 870, y: 506, r: 44 }, { x: 333, y: 534, r: 38 }, { x: 833, y: 822, r: 38 }, { x: 193, y: 943, r: 40 }],
      // The long ridge across the north.
      hills: [{ x: 162, y: 229, r: 80, h: 0.8 }, { x: 220, y: 205, r: 80, h: 0.8 }, { x: 279, y: 182, r: 80, h: 0.8 }, { x: 337, y: 158, r: 80, h: 0.8 }, { x: 405, y: 148, r: 80, h: 0.8 }, { x: 474, y: 139, r: 80, h: 0.8 }, { x: 542, y: 129, r: 80, h: 0.8 }, { x: 597, y: 120, r: 80, h: 0.8 }, { x: 651, y: 110, r: 80, h: 0.8 }, { x: 706, y: 101, r: 80, h: 0.8 }, { x: 754, y: 94, r: 80, h: 0.8 }, { x: 801, y: 87, r: 80, h: 0.8 }, { x: 849, y: 80, r: 80, h: 0.8 }, { x: 897, y: 73, r: 80, h: 0.8 }, { x: 945, y: 65, r: 80, h: 0.8 }, { x: 993, y: 58, r: 80, h: 0.8 }, { x: 1041, y: 53, r: 80, h: 0.8 }, { x: 1088, y: 49, r: 80, h: 0.8 }, { x: 1136, y: 44, r: 80, h: 0.8 }],
      forests: [],
      labels: [
        { x: 940, y: 466, text: 'Palkhed' },
        { x: 1319, y: 811, text: 'Shiv nadi', rot: 1.1 },
        { x: 746, y: 993, text: 'R. Godavari', rot: 0.75 },
        { x: 253, y: 998, text: 'Puntamba' },
      ],
    },
    generals: [10, 4],
    thirst: [0, 0.1],
    // Weeks of Bajirao's horse burning their forage and cutting their convoys: the Nizam's men are hungry and losing heart.
    morale: [1, 0.85],
    // Hold the ring: the camp starves over four minutes, its guns at Puntamba march to relieve it,
    // and if the Nizam's own regiment reaches the edge of the field he has broken out.
    encircled: { side: 1, starveSeconds: 240, relief: [21, 22, 23] },
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

