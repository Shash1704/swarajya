/**
 * The historical battles' data: armies, regiments, commanders and formations (no DOM, so
 * it can be tested headless). See historical.ts for the menu and how they are fought.
 */
import type { BattleMap, LeaderMods, Terrain } from './battle/battle';
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
  /** Enemy armies that come onto the field partway through (seconds into the battle). */
  arrivals?: { at: number; who: string; regs: Reg[] }[];
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
  /** The first side (`mine`), when it is not the Marathas: its name, short name and colours. */
  ourName?: string;
  ourShort?: string;
  ourColor?: string;
  ourRgb?: [number, number, number];
  /** Who won in history: 0 the first side (`mine`), 1 the second (`theirs`). */
  winner: 0 | 1;
  /** The look of the ground (default plains). */
  terrain?: Terrain;
}

const BAJIRAO: LeaderMods = { morale: 1.15, melee: 1.05, charge: 1.2, horse: 1.15, defense: 1, fatigue: 0.85 };
const BAJIRAO_NOTE = 'Peshwa Bajirao I: never beaten in the field; his horse rides farther and hits harder';

export const SCENARIOS: Scenario[] = [
  {
    id: 'gaugamela',
    title: 'Battle of Gaugamela',
    date: '1 October 331 BC',
    place: 'the plain of Gaugamela, near Arbela',
    brief: [
      'Darius III, King of Kings, has gathered the whole strength of the Persian Empire on a plain he has had levelled for his scythed chariots. His line is far longer than Alexander\'s and overlaps it on both wings.',
      'Alexander leads his army forward and to the right, drawing the Persian left after him, waiting for a gap to open in their line. When it does, he wheels the Companion cavalry and the hypaspists into it and drives at Darius himself, while Parmenion holds the left against Mazaeus as long as he can.',
      'As Darius: your numbers are your strength. Overlap and envelop the Macedonian wings, break their formation with the chariots, and do not let a gap open in your centre.',
    ],
    marathas: 'Alexander with the Companion cavalry on the right, the hypaspists beside the Macedonian phalanx in the centre, Parmenion with the Thessalian horse on the left, archers and Agrianian javelinmen screening the right, and a second line of Greek allies ready to face about. 20 regiments.',
    enemy: 'Darius with the Royal Guard in the centre behind Greek mercenary hoplites and the levies of the empire; scythed chariots and Indian elephants in front; Mazaeus with the Syrian, Mesopotamian and Armenian horse on the right; Bessus with the Bactrian cavalry and the Scythian horse archers on the left. 24 regiments.',
    ourName: 'Macedonians and Greek allies', ourShort: 'Macedonians', ourColor: '#2f5fb3', ourRgb: [47, 95, 179],
    enemyName: 'Persian Empire', enemyShort: 'Persians', enemyColor: '#c99a2e', enemyRgb: [201, 154, 46],
    playerGeneral: 'Alexander', enemyGeneral: 'Darius III',
    leaders: [{ morale: 1.25, melee: 1.1, charge: 1.3, horse: 1.25, defense: 1.05, fatigue: 0.9 }, { morale: 0.84, melee: 0.97, charge: 1.05, horse: 1.05, defense: 0.97, fatigue: 1 }],
    leaderNotes: ['Alexander of Macedon: never beaten; he leads the decisive charge himself', 'Darius III: master of a vast empire, but he has fled a field before'],
    playerAttacks: true,
    mine: [
      ['lightcav', 'Greek allied horse', 230, 740, UP],
      ['heavycav', 'Thessalian cavalry (Parmenion)', 310, 740, UP],
      ['heavycav', 'Thessalian cavalry', 390, 740, UP],
      ['spear', 'Macedonian phalanx', 480, 730, UP],
      ['spear', 'Macedonian phalanx', 560, 730, UP],
      ['spear', 'Macedonian phalanx', 640, 730, UP],
      ['spear', 'Macedonian phalanx', 720, 730, UP],
      ['spear', 'Macedonian phalanx', 800, 730, UP],
      ['spear', 'Macedonian phalanx', 880, 730, UP],
      ['habshi', 'the hypaspists', 960, 730, UP],
      ['habshi', 'the hypaspists', 1040, 730, UP],
      ['rajput', 'Companion cavalry: the royal squadron', 1130, 735, UP],
      ['rajput', 'Companion cavalry', 1210, 735, UP],
      ['rajput', 'Companion cavalry', 1290, 735, UP],
      ['archer', 'Agrianian javelinmen', 1370, 700, UP],
      ['archer', 'Cretan archers', 1440, 700, UP],
      ['lightcav', 'prodromoi lancers', 1500, 760, UP],
      ['spear', 'Greek allies, second line', 560, 860, UP],
      ['spear', 'Greek mercenaries, second line', 760, 860, UP],
      ['spear', 'Greek allies, second line', 960, 860, UP],
    ],
    theirs: [
      ['heavycav', 'Mazaeus\' Syrian horse', 150, 300, DOWN],
      ['heavycav', 'Mesopotamian horse', 230, 300, DOWN],
      ['heavycav', 'Cappadocian horse', 310, 300, DOWN],
      ['lightcav', 'Armenian horse', 390, 300, DOWN],
      ['paik', 'levies of the empire', 480, 310, DOWN],
      ['paik', 'Babylonian levies', 560, 310, DOWN],
      ['paik', 'Persian levies', 640, 310, DOWN],
      ['paik', 'Uxian and Susian levies', 720, 310, DOWN],
      ['spear', 'Greek mercenary hoplites', 810, 320, DOWN],
      ['spear', 'Greek mercenary hoplites', 890, 320, DOWN],
      ['habshi', 'Darius III and the Royal Guard', 850, 230, DOWN],
      ['habshi', 'the Apple-bearers', 930, 230, DOWN],
      ['archer', 'Persian archers', 600, 380, DOWN],
      ['archer', 'Mardian archers', 980, 380, DOWN],
      ['elephant', 'Indian elephants', 850, 420, DOWN],
      ['heavycav', 'scythed chariots', 520, 470, DOWN],
      ['heavycav', 'scythed chariots', 850, 500, DOWN],
      ['heavycav', 'scythed chariots', 1180, 470, DOWN],
      ['heavycav', 'Bactrian cavalry (Bessus)', 1060, 300, DOWN],
      ['heavycav', 'Bactrian cavalry', 1140, 300, DOWN],
      ['heavycav', 'Arachosian cavalry', 1220, 300, DOWN],
      ['horsearcher', 'Scythian horse archers', 1300, 310, DOWN],
      ['horsearcher', 'Massagetae horse archers', 1380, 310, DOWN],
      ['lightcav', 'Dahae horse', 1460, 320, DOWN],
    ],
    generals: [11, 10],
    terrain: 'desert',
    map: {
      rivers: [{ pts: [[-40, 70], [400, 60], [800, 80], [1200, 55], [1660, 70]], w: 30, fords: [], shallow: true }],
      hills: [{ x: 1480, y: 1000, r: 160, h: 0.35 }],
      labels: [
        { x: 400, y: 110, text: 'the Bumodus', size: 22 },
        { x: 810, y: 560, text: 'ground levelled for the chariots', size: 20 },
        { x: 1450, y: 1040, text: 'Alexander\'s camp', size: 20 },
      ],
    },
    winner: 0,
    history: 'The Persian chariots were met by the light troops, who killed their drivers and let the rest through the opened ranks. As the Persian left rode out to outflank Alexander, a gap opened in their line; Alexander wheeled the Companions and the hypaspists into it and drove at Darius, who fled. On the Macedonian left Parmenion was hard pressed by Mazaeus until Alexander turned back to relieve him. The Persian army broke, and the Achaemenid Empire was Alexander\'s. Ancient numbers for the Persian army are much exaggerated; modern estimates vary widely.',
  },
  {
    id: 'uhud',
    title: 'Battle of Uhud',
    date: '23 March 625',
    place: 'below Mount Uhud, north of Medina',
    brief: [
      'A year after Badr, the Quraysh of Mecca march on Medina under Abu Sufyan with about three thousand men, two hundred horse among them under Khalid ibn al-Walid and Ikrimah ibn Abi Jahl.',
      'The Muslims, led by the Prophet Muhammad, about seven hundred after Abdullah ibn Ubayy turned back with his men, take their stand with their backs to Mount Uhud. Fifty archers under Abdullah ibn Jubayr hold the small hill on their left, ordered never to leave it whatever happens, for it guards the way round their flank.',
      'As the Muslims: break the Quraysh centre, but keep the archers on their hill. As the Quraysh: wait for the hill to empty, then send Khalid\'s horse round the flank and into the rear.',
    ],
    marathas: 'About 700 men on foot, with their backs to Mount Uhud: the Muhajirun and the Ansar in the line, Hamza ibn Abd al-Muttalib among the champions, and Abdullah ibn Jubayr\'s archers on the hill to the left. 10 regiments.',
    enemy: 'Abu Sufyan with the Quraysh foot and their allies in the centre, archers before them, Khalid ibn al-Walid\'s horse on the right and Ikrimah ibn Abi Jahl\'s on the left. 16 regiments.',
    ourName: 'the Muslims of Medina', ourShort: 'Muslims', ourColor: '#2e7d4f', ourRgb: [46, 125, 79],
    enemyName: 'the Quraysh of Mecca', enemyShort: 'Quraysh', enemyColor: '#a64b2a', enemyRgb: [166, 75, 42],
    playerGeneral: 'the Muslims of Medina', enemyGeneral: 'Abu Sufyan',
    leaders: [{ morale: 1.4, melee: 1.2, charge: 1.15, horse: 1, defense: 1.1, fatigue: 0.9 }, { morale: 0.95, melee: 1, charge: 1.05, horse: 1.2, defense: 1, fatigue: 1 }],
    leaderNotes: ['The Muslims: few, but fighting for their faith and their city', 'Abu Sufyan, with Khalid ibn al-Walid at the head of the horse'],
    playerAttacks: false,
    mine: [
      ['spear', 'the Muhajirun', 640, 780, UP],
      ['spear', 'the Muhajirun', 720, 780, UP],
      ['habshi', 'Hamza ibn Abd al-Muttalib and the champions', 800, 770, UP],
      ['spear', 'the Muhajirun', 880, 780, UP],
      ['spear', 'the Ansar', 960, 780, UP],
      ['spear', 'the Ansar', 1040, 780, UP],
      ['spear', 'the Ansar', 1120, 780, UP],
      ['paik', 'the Ansar', 1200, 790, UP],
      ['archer', 'Abdullah ibn Jubayr\'s archers, on the hill', 370, 700, UP],
      ['archer', 'Abdullah ibn Jubayr\'s archers, on the hill', 430, 725, UP],
    ],
    theirs: [
      ['heavycav', 'Khalid ibn al-Walid\'s horse', 250, 300, DOWN],
      ['heavycav', 'Khalid ibn al-Walid\'s horse', 320, 330, DOWN],
      ['spear', 'Quraysh foot', 580, 320, DOWN],
      ['spear', 'Quraysh foot', 660, 320, DOWN],
      ['spear', 'Quraysh foot', 740, 320, DOWN],
      ['spear', 'Abu Sufyan and the standard-bearers of the Banu Abd al-Dar', 820, 310, DOWN],
      ['spear', 'Quraysh foot', 900, 320, DOWN],
      ['spear', 'Quraysh foot', 980, 320, DOWN],
      ['paik', 'the Ahabish', 1060, 330, DOWN],
      ['paik', 'the Ahabish', 1140, 330, DOWN],
      ['paik', 'allied tribesmen', 500, 330, DOWN],
      ['paik', 'allied tribesmen', 1220, 330, DOWN],
      ['archer', 'Quraysh archers', 700, 400, DOWN],
      ['archer', 'Quraysh archers', 940, 400, DOWN],
      ['lightcav', 'Ikrimah ibn Abi Jahl\'s horse', 1340, 300, DOWN],
      ['lightcav', 'Ikrimah ibn Abi Jahl\'s horse', 1410, 330, DOWN],
    ],
    generals: [2, 5],
    terrain: 'desert',
    map: {
      hills: [{ x: 760, y: 1080, r: 330, h: 0.95 }, { x: 1180, y: 1080, r: 280, h: 0.85 }, { x: 380, y: 720, r: 115, h: 0.7 }],
      rivers: [{ pts: [[-40, 520], [400, 545], [800, 520], [1200, 548], [1660, 525]], w: 26, fords: [], shallow: true }],
      labels: [
        { x: 960, y: 1040, text: 'Mount Uhud', size: 28 },
        { x: 380, y: 630, text: 'the archers\' hill', size: 20 },
        { x: 1250, y: 570, text: 'Wadi Qanat', size: 20 },
        { x: 810, y: 60, text: 'to Medina', size: 20 },
      ],
    },
    winner: 1,
    history: 'The Muslim charge broke the Quraysh centre and the Meccans began to flee. Seeing their camp being taken, most of the archers left their hill for the spoils, against their orders. Khalid ibn al-Walid saw the hill empty, led his horse round it and fell on the Muslims from behind; the Quraysh rallied, and the Muslims were driven back onto the slopes of Uhud. Hamza was killed and the Prophet was wounded, but the Muslims held the mountain, and the Quraysh, content with their revenge for Badr, marched home without taking Medina.',
  },
  {
    id: 'yarmouk',
    title: 'Battle of Yarmouk',
    date: 'August 636',
    place: 'the Yarmouk plain, by the gorge of the Wadi al-Ruqqad',
    brief: [
      'The Emperor Heraclius has sent a great army to win back Syria. Under Vahan it is drawn up in four armies across the plain, with the deep ravine of the Wadi al-Ruqqad behind it, Jabalah\'s Christian Arabs screening its front.',
      'The Rashidun army under Abu Ubaidah, with Khalid ibn al-Walid in command in the field, stands in four corps under Yazid ibn Abi Sufyan, Abu Ubaidah, Shurahbil ibn Hasana and Amr ibn al-As, and Khalid\'s mobile guard of horse behind the centre.',
      'As the Muslims: drive the Byzantine cavalry away from its infantry, take the bridge over the ravine, and the infantry will be trapped against it. As the Byzantines: keep your horse and foot together, and use your numbers before the Muslim cavalry can split them.',
    ],
    marathas: 'Four corps of infantry and archers (Yazid, Abu Ubaidah, Shurahbil and Amr, left to right), light horse on each wing, and Khalid\'s mobile guard of heavy horse in reserve behind the centre. 18 regiments.',
    enemy: 'Four armies: Gregory\'s on the right, Dairjan\'s, the Armenians under Qanatir, and the left; Byzantine cavalry behind them; Vahan with his guard; Jabalah\'s Ghassanid Arab horse screening the front. The ravine of the Wadi al-Ruqqad behind them all, crossed by one bridge. 20 regiments.',
    ourName: 'the Rashidun Caliphate', ourShort: 'Muslims', ourColor: '#2e7d4f', ourRgb: [46, 125, 79],
    enemyName: 'the Byzantine Empire', enemyShort: 'Byzantines', enemyColor: '#7b3fa0', enemyRgb: [123, 63, 160],
    playerGeneral: 'Khalid ibn al-Walid', enemyGeneral: 'Vahan',
    leaders: [{ morale: 1.28, melee: 1.08, charge: 1.18, horse: 1.22, defense: 1.02, fatigue: 0.88 }, { morale: 0.87, melee: 0.97, charge: 1, horse: 0.97, defense: 1.08, fatigue: 1.05 }],
    leaderNotes: ['Khalid ibn al-Walid, the Sword of God: his horse strikes where it is least expected', 'Vahan: a veteran general with a divided command'],
    playerAttacks: true,
    mine: [
      ['lightcav', 'horse of the left wing', 200, 790, UP],
      ['spear', 'Yazid ibn Abi Sufyan\'s corps', 300, 760, UP],
      ['spear', 'Yazid ibn Abi Sufyan\'s corps', 380, 760, UP],
      ['archer', 'Yazid\'s archers', 340, 830, UP],
      ['spear', 'Abu Ubaidah\'s corps', 560, 760, UP],
      ['spear', 'Abu Ubaidah\'s corps', 640, 760, UP],
      ['archer', 'Abu Ubaidah\'s archers', 600, 830, UP],
      ['spear', 'Shurahbil ibn Hasana\'s corps', 980, 760, UP],
      ['spear', 'Shurahbil ibn Hasana\'s corps', 1060, 760, UP],
      ['archer', 'Shurahbil\'s archers', 1020, 830, UP],
      ['spear', 'Amr ibn al-As\'s corps', 1240, 760, UP],
      ['spear', 'Amr ibn al-As\'s corps', 1320, 760, UP],
      ['archer', 'Amr\'s archers', 1280, 830, UP],
      ['lightcav', 'horse of the right wing', 1420, 790, UP],
      ['rajput', 'Khalid\'s mobile guard', 760, 900, UP],
      ['rajput', 'Khalid\'s mobile guard', 860, 900, UP],
      ['shiledar', 'the mobile guard', 700, 960, UP],
      ['shiledar', 'the mobile guard', 920, 960, UP],
    ],
    theirs: [
      ['spear', 'Gregory\'s infantry, chained in line', 300, 330, DOWN],
      ['spear', 'Gregory\'s infantry', 380, 330, DOWN],
      ['archer', 'Byzantine archers', 340, 390, DOWN],
      ['spear', 'Dairjan\'s infantry', 600, 330, DOWN],
      ['spear', 'Dairjan\'s infantry', 680, 330, DOWN],
      ['archer', 'Byzantine archers', 640, 390, DOWN],
      ['spear', 'the Armenians under Qanatir', 940, 330, DOWN],
      ['spear', 'the Armenians', 1020, 330, DOWN],
      ['archer', 'Armenian archers', 980, 390, DOWN],
      ['spear', 'infantry of the Byzantine left', 1240, 330, DOWN],
      ['spear', 'infantry of the Byzantine left', 1320, 330, DOWN],
      ['archer', 'Byzantine archers', 1280, 390, DOWN],
      ['heavycav', 'Byzantine cavalry (kataphraktoi)', 340, 240, DOWN],
      ['heavycav', 'Byzantine cavalry', 640, 240, DOWN],
      ['heavycav', 'Byzantine cavalry', 980, 240, DOWN],
      ['heavycav', 'Byzantine cavalry', 1280, 240, DOWN],
      ['heavycav', 'Vahan and his guard', 810, 190, DOWN],
      ['lightcav', 'Jabalah\'s Ghassanid horse', 500, 470, DOWN],
      ['lightcav', 'Jabalah\'s Ghassanid horse', 810, 470, DOWN],
      ['lightcav', 'Jabalah\'s Ghassanid horse', 1120, 470, DOWN],
    ],
    generals: [14, 16],
    terrain: 'plains',
    map: {
      // The ravine behind the Byzantines, crossed by one bridge; the Yarmouk gorge to the south.
      rivers: [
        { pts: [[-40, 110], [300, 95], [600, 120], [900, 100], [1200, 118], [1660, 100]], w: 64, fords: [{ x: 300, y: 95, r: 40 }] },
        { pts: [[60, 200], [70, 450], [55, 700], [70, 1120]], w: 50, fords: [] },
      ],
      hills: [{ x: 1480, y: 200, r: 150, h: 0.6 }, { x: 810, y: 1060, r: 220, h: 0.4 }],
      labels: [
        { x: 900, y: 50, text: 'the ravine of the Wadi al-Ruqqad', size: 22 },
        { x: 300, y: 150, text: 'the bridge at Ayn al-Dhakar', size: 18 },
        { x: 120, y: 520, text: 'Yarmouk', rot: -Math.PI / 2, size: 24 },
        { x: 1480, y: 270, text: 'Tell al-Jumu\'a', size: 20 },
      ],
    },
    winner: 0,
    history: 'For five days the Byzantines pressed the Muslim line, which bent but held. On the sixth day Khalid massed his cavalry, drove the Byzantine horse off the field to the north, and sent men to seize the bridge over the Wadi al-Ruqqad. Their cavalry gone and their retreat cut, the Byzantine infantry were driven back against the ravine and destroyed. Syria was lost to the Empire for good. Numbers for both armies are uncertain; ancient and modern estimates differ widely.',
  },
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
    winner: 0,
    history: 'At Palkhed the Nizam, cut off from food and water and surrounded by horse he could not bring to battle, gave in without a great fight. On 6 March 1728 he signed the Treaty of Mungi Shevgaon: he recognised Shahu as the Chhatrapati, gave up the cause of Sambhaji of Kolhapur, and granted the Marathas the right to collect chauth and sardeshmukhi in the Deccan. Jadunath Sarkar called the campaign a classic example of what light horse led by a genius could achieve.',
  },
  {
    id: 'delhi',
    title: 'Battle of Delhi',
    date: '28 March 1737',
    place: 'Rikabganj and Talkatora, outside Delhi',
    brief: [
      'Saadat Khan of Awadh boasted that he had driven the Marathas back across the Chambal. To give him the lie, Bajirao left the main Mughal armies behind him on the Agra road and rode for the capital by the Jat and Mewati hill tracks, covering in days what an imperial army marched in weeks.',
      'His horse now camps by the Talkatora tank, at the gates of Delhi. Emperor Muhammad Shah sends Mir Hasan Khan Koka out of the city against him with the imperial household cavalry. But the Vizier, Qamar-ud-din Khan, is hurrying back towards Delhi with the main imperial army, and the Mughal armies Bajirao left behind on the Agra road are turning after him.',
      'Break Koka\'s horse quickly. In a few minutes the Vizier\'s army comes up from the east, and then you must win against both, or get away as Bajirao did. Draw the heavy horse out of their order and fall on their flanks; feigned flight (F) was the Marathas\' oldest trick.',
    ],
    marathas: 'Peshwa Bajirao with his household horse in reserve; a screen of light horse before the camp; the left and right wings lying back on the flanks (which sardars led them is not recorded in the sources used here); horse archers to gall the Mughal ranks. 16 regiments, all cavalry, after a long forced march.',
    enemy: 'Mir Hasan Khan Koka with the Emperor\'s household cavalry, a vanguard, a centre round his elephant and a wing to each side, and a few matchlockmen from the city. 11 regiments, almost all heavy horse. Coming up from the east after a few minutes: the Vizier Qamar-ud-din Khan with part of the main army (his guns are still on the road).',
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
      ['shiledar', 'the Maratha left wing', 240, 640, UP + 0.4],
      ['shiledar', 'the Maratha left wing', 250, 730, UP + 0.4],
      ['lightcav', 'the Maratha left wing', 330, 680, UP + 0.4],
      ['lightcav', 'the Maratha left wing', 335, 770, UP + 0.4],
      ['shiledar', 'the Maratha right wing', 1380, 640, UP - 0.4],
      ['shiledar', 'the Maratha right wing', 1370, 730, UP - 0.4],
      ['lightcav', 'the Maratha right wing', 1290, 680, UP - 0.4],
      ['lightcav', 'the Maratha right wing', 1285, 770, UP - 0.4],
      ['huzurat', 'the Peshwa\'s household horse', 780, 920, UP],
      ['huzurat', 'the Peshwa\'s own paga', 850, 920, UP],
      ['horsearcher', 'Maratha horse archers', 540, 720, UP],
      ['horsearcher', 'Maratha horse archers', 1080, 760, UP],
    ],
    theirs: [
      ['musket', 'matchlockmen from the city', 810, 400, DOWN],
      ['heavycav', 'household horse of the vanguard', 700, 320, DOWN],
      ['heavycav', 'household horse of the vanguard', 810, 315, DOWN],
      ['heavycav', 'household horse of the vanguard', 920, 320, DOWN],
      ['heavycav', 'the Emperor\'s household horse', 740, 235, DOWN],
      ['elephant', 'Mir Hasan Khan Koka\'s elephant', 810, 220, DOWN],
      ['heavycav', 'the Emperor\'s household horse', 880, 235, DOWN],
      ['heavycav', 'household horse, left wing', 470, 290, DOWN],
      ['heavycav', 'household horse, left wing', 480, 365, DOWN],
      ['heavycav', 'household horse, right wing', 1150, 290, DOWN],
      ['heavycav', 'household horse, right wing', 1140, 365, DOWN],
    ],
    // Qamar-ud-din Khan comes up from the east with part of the main army; his guns are still on the road.
    arrivals: [{
      at: 90, who: 'The Vizier Qamar-ud-din Khan',
      regs: [
        ['elephant', 'the Vizier Qamar-ud-din Khan\'s elephant', 1560, 520, WEST],
        ['heavycav', 'the Vizier\'s sowars', 1540, 400, WEST],
        ['heavycav', 'the Vizier\'s sowars', 1545, 460, WEST],
        ['heavycav', 'the Vizier\'s sowars', 1545, 580, WEST],
        ['heavycav', 'the Vizier\'s sowars', 1540, 640, WEST],
        ['rajput', 'Rajput horse in the Vizier\'s army', 1580, 330, WEST],
        ['heavycav', 'the Vizier\'s sowars', 1580, 710, WEST],
        ['musket', 'the Vizier\'s matchlockmen', 1590, 460, WEST],
        ['musket', 'the Vizier\'s matchlockmen', 1590, 580, WEST],
      ],
    }],
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
    generals: [12, 5],
    winner: 0,
    history: 'At Rikabganj the Marathas routed the force that came out of Delhi, and Mir Hasan Khan Koka was carried from the field wounded. Bajirao did not storm the city: hearing that the Vizier Qamar-ud-din Khan was hurrying back with the main army, he drew off rather than be caught between them, skirmished with it at Badshahpur in failing light, and rode away by Narnaul. The raid showed all Hindustan that the Mughal capital lay open to the Maratha horse. Accounts of the numbers on each side differ widely.',
  },
  {
    id: 'bhopal',
    title: 'Battle of Bhopal',
    date: '24 December 1737',
    place: 'Bhopal, by the Upper Lake',
    brief: [
      'After Bajirao\'s raid on Delhi the Emperor called the Nizam-ul-Mulk north to drive the Marathas out of Malwa. The Nizam came with a strong army, the best artillery in India and Rajput allies, and dug in at Bhopal, beside the great lake.',
      'Bajirao rode north with the whole Maratha horse and closed round him: Holkar to the north, Shinde to the south, Pawar and Pilaji Jadhav between, the Peshwa himself to the east, and the lake at the Nizam\'s back. His guns kept the Marathas from storming the camp; their horse kept anything from reaching it.',
      'As the Marathas: keep clear of the guns and hold the ring; hunger will do the rest. As the Nizam: you must break out before your camp starves, or fight your way to the edge of the field.',
    ],
    marathas: 'Peshwa Bajirao with his household horse to the east; Malharrao Holkar to the north, Ranoji Shinde to the south, Yashwantrao Pawar and Pilaji Jadhav between, each with horse archers. 18 regiments, all cavalry.',
    enemy: 'The Nizam-ul-Mulk in an entrenched camp by the lake: five batteries of guns, matchlockmen and sowars round them, his elephant in the middle, Rajput allies, rocketmen. 22 regiments, starving as long as the ring holds.',
    enemyName: 'Army of the Nizam-ul-Mulk', enemyShort: 'Nizam', enemyColor: '#c9a227', enemyRgb: [201, 162, 39],
    playerGeneral: 'Peshwa Bajirao', enemyGeneral: 'Nizam-ul-Mulk',
    leaders: [BAJIRAO, { morale: 1.1, melee: 1, charge: 1, horse: 1, defense: 1.35, fatigue: 1 }],
    leaderNotes: [BAJIRAO_NOTE, 'Nizam-ul-Mulk Asaf Jah: old now, behind the best guns in India'],
    playerAttacks: true,
    mine: [
      ['huzurat', 'the Peshwa\'s household horse', 1130, 480, WEST],
      ['huzurat', 'the Peshwa\'s own paga', 1130, 560, WEST],
      ['shiledar', 'the Peshwa\'s shiledars', 1200, 420, WEST],
      ['shiledar', 'the Peshwa\'s shiledars', 1200, 620, WEST],
      ['horsearcher', 'the Peshwa\'s horse archers', 1060, 700, WEST],
      ['lightcav', 'Malharrao Holkar\'s horse', 520, 130, DOWN],
      ['lightcav', 'Malharrao Holkar\'s horse', 640, 120, DOWN],
      ['lightcav', 'Malharrao Holkar\'s horse', 760, 130, DOWN],
      ['horsearcher', 'Holkar\'s horse archers', 640, 200, DOWN],
      ['lightcav', 'Ranoji Shinde\'s horse', 520, 930, UP],
      ['lightcav', 'Ranoji Shinde\'s horse', 640, 940, UP],
      ['lightcav', 'Ranoji Shinde\'s horse', 760, 930, UP],
      ['shiledar', 'Shinde\'s shiledars', 640, 870, UP],
      ['lightcav', 'Yashwantrao Pawar\'s horse', 960, 220, 2.4],
      ['lightcav', 'Yashwantrao Pawar\'s horse', 1040, 280, 2.4],
      ['lightcav', 'Pilaji Jadhav\'s horse', 960, 840, -2.4],
      ['lightcav', 'Pilaji Jadhav\'s horse', 1040, 780, -2.4],
      ['horsearcher', 'Pilaji Jadhav\'s horse archers', 900, 900, -2.4],
    ],
    theirs: [
      ['cannon', 'the Nizam\'s great guns', 760, 420, -0.6],
      ['cannon', 'the Nizam\'s great guns', 800, 520, 0],
      ['cannon', 'the Nizam\'s great guns', 760, 620, 0.6],
      ['cannon', 'the Nizam\'s guns', 620, 380, -1.57],
      ['cannon', 'the Nizam\'s guns', 620, 660, 1.57],
      ['musket', 'the Nizam\'s matchlockmen', 720, 470, 0],
      ['musket', 'the Nizam\'s matchlockmen', 720, 570, 0],
      ['musket', 'the Nizam\'s matchlockmen', 560, 400, -1.57],
      ['musket', 'the Nizam\'s matchlockmen', 560, 640, 1.57],
      ['musket', 'the Nizam\'s matchlockmen', 680, 380, -1.2],
      ['musket', 'the Nizam\'s matchlockmen', 680, 660, 1.2],
      ['elephant', 'Nizam-ul-Mulk\'s elephant', 620, 520, 0],
      ['heavycav', 'the Nizam\'s sowars', 540, 470, 0],
      ['heavycav', 'the Nizam\'s sowars', 540, 570, 0],
      ['heavycav', 'Mughal sowars', 660, 470, 0],
      ['heavycav', 'Mughal sowars', 660, 570, 0],
      ['heavycav', 'the Nizam\'s sowars', 600, 330, -1.57],
      ['spear', 'Deccani spearmen', 500, 520, 3.14],
      ['spear', 'Deccani spearmen', 600, 710, 1.57],
      ['rocket', 'the Nizam\'s rocketmen', 700, 520, 0],
      ['rajput', 'Rajput allies', 520, 330, -1.57],
      ['rajput', 'Rajput allies', 520, 710, 1.57],
    ],
    zone0: [20, 1060],
    generals: [0, 11],
    morale: [1, 0.9],
    thirst: [0, 0.05],
    // The ring: the camp starves while it holds; if the Nizam's own regiment reaches the edge of the field he has broken out.
    encircled: { side: 1, starveSeconds: 240 },
    map: {
      // The Upper Lake at the Nizam's back, Bhopal and its new fort on the shore, the Shyamla hills.
      rivers: [{ pts: [[150, 120], [230, 330], [200, 560], [250, 780], [190, 980]], w: 190, fords: [] }],
      villages: [{ x: 410, y: 560, r: 52 }],
      hills: [{ x: 400, y: 380, r: 120, h: 0.55 }, { x: 420, y: 800, r: 140, h: 0.5 }, { x: 1400, y: 140, r: 140, h: 0.45 }],
      forests: [{ x: 1350, y: 900, r: 60 }, { x: 1180, y: 160, r: 45 }],
      labels: [
        { x: 200, y: 560, text: 'the Upper Lake', rot: -Math.PI / 2, size: 28 },
        { x: 410, y: 630, text: 'Bhopal' },
        { x: 400, y: 300, text: 'Fatehgarh fort', size: 20 },
        { x: 1420, y: 1040, text: 'to Sironj and Hindustan →', size: 20 },
      ],
    },
    winner: 0,
    history: 'The Nizam\'s guns kept the Marathas from his camp, but their horse took every convoy and burnt the country round Bhopal. With his army starving, the Nizam tried to march away under the cover of his artillery, and was harassed every step. On 7 January 1738, at Doraha near Sironj, he signed a convention giving the Marathas all of Malwa, promising to win the Emperor\'s sanction for it, and fifty lakh rupees for their costs. It was Bajirao\'s last great campaign against him.',
  },
];
