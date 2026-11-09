import { fightingMen } from './realm';
import {
  type Army, armyStrength, dist, type Faction, type GameState, type General, hostile, IND, isYours, PLAYER, type Province,
  provinceUnder, TRAITS, unitsMen, unitsStrength, yourArmy,
} from './state';
import type { Talk } from './characters';

/**
 * Conversation without a language model: a small understanding of what was said
 * (intentions, even misspelt; the places, armies, people and realms named) and
 * replies built from the real state of the world, the speaker's temperament,
 * his own aims, and what he thinks of the people you mention.
 */

// ---------------------------------------------------------------- reading what was said

/** Edit distance, for forgiving misspellings ("ahouls", "Ahamednagar"). */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

const tokens = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(Boolean);

/** Does the word list contain this word (allowing a slip of the pen in longer words)? */
function hasWord(words: string[], w: string): boolean {
  const tol = w.length >= 8 ? 2 : w.length >= 5 ? 1 : 0;
  return words.some((x) => x === w || (tol && Math.abs(x.length - w.length) <= tol && lev(x, w) <= tol));
}

/** Any of these words or two-word phrases present? */
function hasAny(words: string[], keys: string[]): boolean {
  for (const k of keys) {
    const parts = k.split(' ');
    if (parts.length === 1) {
      if (hasWord(words, k)) return true;
    } else {
      for (let i = 0; i + parts.length <= words.length; i++) {
        if (parts.every((p, j) => words[i + j] === p || (p.length >= 5 && lev(words[i + j], p) <= 1))) return true;
      }
    }
  }
  return false;
}

export type Intent = 'join' | 'strike' | 'withdraw' | 'surrender' | 'pass' | 'defect' | 'peace' | 'alliance' | 'marriage'
  | 'hostages' | 'gift' | 'men' | 'report' | 'counsel' | 'plan' | 'fight' | 'about' | 'lord' | 'news' | 'reputation' | 'war' | 'greet' | 'thanks' | 'farewell';

const INTENTS: [Intent, string[]][] = [
  ['join', ['combine', 'combined', 'together', 'join forces', 'join me', 'join us', 'unite', 'united', 'side by side', 'march with', 'ride with', 'with me', 'help me', 'aid me', 'merge']],
  ['strike', ['attack', 'beat', 'defeat', 'crush', 'destroy', 'strike', 'smash', 'rout', 'take', 'capture', 'storm', 'besiege', 'siege', 'retake', 'assault', 'hit']],
  ['withdraw', ['withdraw', 'retreat', 'go home', 'turn back', 'leave these', 'march away', 'leave', 'begone']],
  ['surrender', ['surrender', 'lay down', 'yield', 'submit']],
  ['pass', ['let us pass', 'pass in peace', 'no bloodshed', 'avoid battle', 'part in peace', 'let me pass']],
  ['defect', ['change sides', 'changing sides', 'switch sides', 'switching sides', 'serve me', 'my service', 'come over', 'betray', 'desert', 'join me', 'join us', 'our side', 'my side']],
  ['peace', ['peace', 'truce', 'end the war', 'stop fighting']],
  ['alliance', ['alliance', 'ally', 'allies', 'allied']],
  ['marriage', ['marry', 'marriage', 'wed', 'wedding', 'bride', 'daughter']],
  ['hostages', ['hostage', 'hostages']],
  ['gift', ['gift', 'present', 'gold', 'reward', 'pay', 'money', 'share']],
  ['men', ['men', 'troops', 'soldiers', 'reinforcements', 'reinforce', 'regiments', 'army']],
  ['report', ['report', 'deeds', 'victories', 'victory', 'won']],
  ['counsel', ['advice', 'advise', 'counsel', 'should we', 'should i', 'what do', 'think']],
  ['plan', ['plan', 'plans', 'intend', 'want', 'aim', 'next', 'going to']],
  ['fight', ['fight', 'battle', 'enough talk', 'draw your sword', 'duel']],
  ['about', ['who are you', 'yourself', 'your name', 'your family', 'your house']],
  ['lord', ['your master', 'your lord', 'your king', 'emperor', 'sultan', 'serve him']],
  ['news', ['news', 'rumour', 'rumours', 'rumor', 'heard', 'happening']],
  ['reputation', ['about me', 'of me', 'my name', 'my reputation']],
  ['war', ['war', 'campaign', 'front', 'enemy', 'enemies']],
  ['greet', ['hello', 'greetings', 'namaskar', 'ram ram', 'salaam', 'salam', 'jai', 'hail']],
  ['thanks', ['thank', 'thanks', 'grateful', 'dhanyavad', 'shukriya']],
  ['farewell', ['farewell', 'goodbye', 'bye', 'go now', 'must leave']],
];

export interface Parsed {
  words: string[];
  intents: Set<Intent>;
  places: { p: Province; army: boolean }[];
  armies: Army[];
  people: General[];
  realms: Faction[];
  yes: boolean;
  no: boolean;
  question: boolean;
  tone: 'insult' | 'threat' | 'flatter' | 'gold' | 'plain';
}

const STOP = new Set(['fort', 'port', 'castle', 'the', 'and', 'with', 'from', 'great', 'upper']);
const REALM_WORDS: Record<string, string[]> = {
  mug: ['mughal', 'mughals', 'moghul', 'mogul', 'aurangzeb', 'emperor', 'imperial', 'delhi'],
  bij: ['bijapur', 'adil', 'adilshahi'], gol: ['golconda', 'qutb', 'qutbshahi'], raj: ['rajput', 'rajputs', 'mewar', 'rajputana'],
  sid: ['siddi', 'siddis', 'janjira', 'habshi'], por: ['portuguese', 'goa', 'firangi', 'firangis'], eng: ['english', 'company', 'bombay', 'angrez'],
  nay: ['madurai', 'nayak', 'nayaks'], mys: ['mysore'], aho: ['ahom', 'ahoms', 'assam'], mar: ['maratha', 'marathas', 'swarajya'],
};

/** Every character in the world, for names you mention. */
function everyone(s: GameState): General[] {
  const out = new Set<General>([...s.armies.map((a) => a.general), ...s.officers.flat(), ...(s.rulers.filter(Boolean) as General[])]);
  return [...out];
}

export function parse(s: GameState, t: Talk, text: string): Parsed {
  const words = tokens(text);
  const intents = new Set<Intent>();
  for (const [intent, keys] of INTENTS) if (hasAny(words, keys)) intents.add(intent);
  // Places by name (province or town), forgiving spelling.
  const places: { p: Province; army: boolean }[] = [];
  for (const p of s.provinces) {
    const names = [...tokens(p.name), ...tokens(p.town)].filter((w) => w.length >= 4 && !STOP.has(w));
    if (names.some((n) => hasWord(words, n))) places.push({ p, army: false });
  }
  // People by name.
  // Titles ("Khan", "Shah", "Singh"...) don't name anyone in particular.
  const TITLES = new Set(['khan', 'shah', 'singh', 'raje', 'raja', 'siddi', 'sardar', 'prince', 'mirza', 'adil', 'qutb']);
  // Leave out the words that address the man you're talking to ("Tanaji, …" must not read as "Anaji").
  const self = tokens(t.gen.name);
  const others = words.filter((w) => !self.some((n) => w === n || (n.length >= 5 && lev(w, n) <= 1)));
  const people = everyone(s).filter((g) => g !== t.gen && tokens(g.name).some((n) => n.length >= 4 && !TITLES.has(n)
    && (others.includes(n) || (n.length >= 6 && hasWord(others, n)))));
  // Realms.
  const realms = s.factions.filter((f) => f.alive && (REALM_WORDS[f.key] ?? []).some((w) => hasWord(words, w)));
  // Armies: named by their commander (when you speak of fighting or of his army, not of the man),
  // or "the army near <place>" (of the realm named, else any but ours).
  const armies = new Set<Army>();
  const armyTalk = hasAny(words, ['army', 'armies', 'host', 'force', 'forces', 'troops', 'horsemen', 'men']);
  const fightTalk = hasAny(words, ['attack', 'beat', 'defeat', 'crush', 'strike', 'smash', 'rout', 'fight', 'battle', 'against', 'march on']);
  const aboutMan = hasAny(words, ['think of', 'think about', 'what of', 'opinion', 'know of', 'like him', 'trust']);
  if ((armyTalk || fightTalk) && !aboutMan) {
    for (const g of people) {
      const a = s.armies.find((x) => x.general === g);
      if (a) armies.add(a);
    }
  }
  if (armyTalk) {
    for (const { p } of places) {
      for (const a of s.armies) {
        if (dist(a, p) > 45 || a.owner === PLAYER) continue;
        if (realms.length && !realms.some((f) => f.id === a.owner)) continue;
        armies.add(a);
      }
    }
  }
  const tone = /(coward|dog|fool|traitor|worm|slave|rat|jackal|idiot)/.test(text.toLowerCase()) ? 'insult'
    : /(destroy you|burn your|kill you|your head|you will die|regret)/.test(text.toLowerCase()) ? 'threat'
      : /(honou?r|respect|great man|glory|wise|brave|valou?r|noble|famous|renowned)/.test(text.toLowerCase()) ? 'flatter'
        : /(gold|reward|wealth|jagir|rich)/.test(text.toLowerCase()) ? 'gold' : 'plain';
  return {
    words, intents, places, armies: [...armies], people, realms,
    yes: hasAny(words, ['yes', 'aye', 'agreed', 'agree', 'very well', 'of course', 'gladly', 'indeed', 'ho', 'haan', 'ji', 'sure', 'certainly', 'lets do', 'do it']),
    no: hasAny(words, ['no', 'nay', 'never', 'not now', 'refuse', 'nahi']),
    question: /\?\s*$/.test(text) || ['what', 'who', 'how', 'why', 'where', 'when', 'will', 'would', 'can', 'could', 'should', 'do', 'does', 'is', 'are'].includes(words[0] ?? ''),
    tone,
  };
}

// ---------------------------------------------------------------- the speaker's own aims

/** What a character wants: the town he means to take (or keep), and how he puts it. */
export function agenda(s: GameState, g: General, faction: number, army: Army | null): { prov: Province | null; line: string } {
  const at = army ?? s.armies.find((a) => a.general === g) ?? null;
  const KNOWN_AIMS: Record<string, string> = { Tanaji: 'pune', Netaji: 'aurangabad', Prataprao: 'saswad', Moropant: 'junnar', 'Diler Khan': 'raigad', 'Siddi Qasim': 'malvan', Aurangzeb: 'raigad', 'Ali Adil Shah': 'satara' };
  let prov = KNOWN_AIMS[g.name] ? s.provinces.find((p) => p.key === KNOWN_AIMS[g.name]) ?? null : null;
  if (prov && !hostile(s, faction, prov.owner)) prov = null;
  if (!prov && at) {
    // The nearest enemy town worth having.
    prov = s.provinces.filter((p) => p.owner !== IND && hostile(s, faction, p.owner) && p.walls > 0)
      .sort((a, b) => dist(at, a) - dist(at, b))[0] ?? null;
  }
  if (!prov) return { prov: null, line: 'I hold what I have and wait for orders.' };
  const mine = faction === PLAYER;
  const line = g.name === 'Tanaji' && prov.key === 'pune'
    ? `I have sworn to take Kondhana. My son's wedding can wait; the fort cannot.`
    : mine
      ? `I mean to take ${prov.town} from the ${s.factions[prov.owner].short}. ${prov.walls >= 3 ? 'It is a hard nut; it will want ladders and a dark night.' : 'It should not hold long against a determined push.'}`
      : `My orders are to take ${prov.town}${prov.owner === PLAYER ? ', and I mean to' : ''}.`;
  return { prov, line };
}

/** What he thinks of someone you name. */
function opinionOf(s: GameState, speaker: General, faction: number, other: General): string {
  const RIVALS: Record<string, string> = {
    'Diler Khan|Muazzam': 'The prince? He plays at war and takes the credit for other men\'s blood.',
    'Muazzam|Diler Khan': 'Diler Khan is a brave brute who thinks every problem is a nail.',
    'Tanaji|Shivaji': 'The Raje is my oldest friend. I would walk into fire for him, and have.',
    'Tanaji|Aurangzeb': 'The Emperor sits in Delhi and spends other men\'s lives. Let him come up the Sahyadri himself and see.',
    'Netaji|Aurangzeb': 'I served the Mughals once. They pay well and trust no one. I will not go back.',
    'Shivaji|Diler Khan': 'Diler Khan is brave and stubborn. Make him chase you into the hills and let the hills fight him.',
    'Tanaji|Diler Khan': 'An Afghan bull. Charge him head on and you will break your horns; go round.',
    'Netaji|Shivaji': 'The Raje forgave me when another king would have hanged me. I do not forget it.',
    'Aurangzeb|Shivaji': 'The mountain rat. He slipped through my fingers at Agra; he will not do so twice.',
    'Shivaji|Aurangzeb': 'The Emperor prays five times a day and sends armies to burn our villages in between.',
    'Gerald Aungier|Shivaji': 'A formidable prince, and a reasonable one when it comes to trade.',
    'Siddi Qasim|Shivaji': 'He wants Janjira. He will have to grow wings to get it.',
  };
  const key = `${speaker.name}|${other.name}`;
  if (RIVALS[key]) return RIVALS[key];
  const theirs = s.factions.findIndex((f) => s.armies.some((a) => a.general === other && a.owner === f.id) || s.officers[f.id]?.includes(other) || s.rulers[f.id] === other);
  if (other.isPlayer) return 'You? I am still making up my mind.';
  if (theirs === faction) {
    return other.trait === speaker.trait ? `${other.name} and I see the world alike. A good man.` : `${other.name}? ${TRAITS[other.trait].name}, they say. We get along well enough.`;
  }
  const enemy = theirs >= 0 && hostile(s, faction, theirs);
  return enemy
    ? (speaker.persona && speaker.persona.honour > 0.6 ? `${other.name} is my enemy, but a worthy one. I will give him that.` : `${other.name}? I would like to see his head on a lance.`)
    : `${other.name}? I know him only by name.`;
}

// ---------------------------------------------------------------- replying

/** How this man talks: a word to open with now and then, by temper and by name. */
function voice(g: General): { open: string[]; close: string[] } {
  const p = g.persona ?? { honour: 0.5, greed: 0.5, temper: 0.5 };
  const NAMED: Record<string, { open: string[]; close: string[] }> = {
    Tanaji: { open: ['Ha!', 'Listen.', 'By Bhavani!'], close: ['Har Har Mahadev!', 'Let them come.'] },
    Shivaji: { open: ['Hm.', 'Listen well.'], close: ['Swarajya is not given; it is taken, fort by fort.', 'Deeds, not words.'] },
    Aurangzeb: { open: ['Hm.', 'All things are by the will of God.'], close: ['God is great.', 'The empire is patient.'] },
    'Gerald Aungier': { open: ['Well now.', 'Hm.'], close: ['The Company prefers profit to powder.', 'Good trade makes good neighbours.'] },
    'Diler Khan': { open: ['Ha!', 'Bah.'], close: ['Steel settles more than talk.', 'We Afghans do not haggle.'] },
  };
  if (NAMED[g.name]) return NAMED[g.name];
  return p.temper > 0.6 ? { open: ['Ha!', 'Bah.', 'Listen.'], close: ['Enough talk.', 'Let them come.'] }
    : p.temper < 0.35 ? { open: ['Hm.', 'Let me think.'], close: ['Patience wins more forts than courage.', 'We shall see.'] }
      : { open: ['Hm.', 'Well then.'], close: [''] };
}

const any = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** An honest look at an army: who leads it, how many would really fight, and how that compares with ours. */
function assessArmy(s: GameState, t: Talk, a: Army): { line: string; good: boolean } {
  const fm = fightingMen(s, a);
  const theirs = fm.army + fm.garrison + fm.nearby;
  const theirStr = armyStrength(a) * (1 + (fm.garrison + fm.nearby) / Math.max(1, fm.army));
  const mineA = yourArmy(s);
  const ours = (t.army && !isYours(s, t.army) ? unitsMen(t.army.units) : 0) + (mineA ? unitsMen(mineA.units) : 0);
  const ourStr = (t.army && !isYours(s, t.army) ? armyStrength(t.army) : 0) + (mineA ? armyStrength(mineA) : 0);
  const where = s.provinces[provinceUnder(s, a, a.node)];
  const parts = [`That is ${a.general.name}'s army${where ? ` near ${where.town}` : ''}, ${s.factions[a.owner].short === 'Independents' ? 'a local chief\'s' : `of the ${s.factions[a.owner].short}`}: ${Math.round(fm.army)} men${fm.garrison ? `, and the garrison adds ${fm.garrison}` : ''}${fm.nearby ? `; ${fm.nearby} more are close enough to come up` : ''}.`];
  if (t.faction === PLAYER) parts.push(`Your ${mineA ? Math.round(unitsMen(mineA.units)) : 0} and my ${t.army ? Math.round(unitsMen(t.army.units)) : 0} make ${Math.round(ours)} against their ${Math.round(theirs)}.`);
  return { line: parts.join(' '), good: ourStr > theirStr * 0.85 };
}

/** A reply to free words, without a language model. */
export function understand(s: GameState, t: Talk, text: string): { say: string; delta: number; offer: { id: string; label: string } | null } {
  const q = parse(s, t, text);
  const g = t.gen;
  const p = g.persona ?? { honour: 0.5, greed: 0.5, temper: 0.5 };
  const v = voice(g);
  const out: string[] = [];
  let delta = 0;
  let offer: { id: string; label: string } | null = null;
  const bold = p.temper > 0.55 || g.trait === 'bold';
  const ally = t.faction === PLAYER;

  // 1. Tone first: men react to how they are spoken to.
  if (q.tone === 'insult') {
    delta -= 4;
    out.push(p.temper > 0.6 ? `Say that again and I will cut the words from your mouth.` : 'Insults are the weapons of men who have no others.');
  } else if (q.tone === 'threat') {
    delta += p.temper > 0.6 ? -3 : -1;
    out.push(p.temper > 0.6 ? 'Threats? Come and try.' : 'A threat in words is only wind.');
  } else if (q.tone === 'flatter') {
    delta += p.honour > 0.5 ? 2 : 1;
    out.push(p.honour > 0.6 ? 'Fair words. I will remember them.' : 'Sweet words. What do you really want?');
  } else if (q.tone === 'gold' && !q.intents.has('gift')) {
    delta += p.greed > 0.6 ? 2 : 0;
    out.push(p.greed > 0.6 ? 'Gold… now you speak my language.' : 'I am not a merchant to be bought.');
  }

  // 2. An answer to his own question.
  if (t.pending && (q.yes || q.no)) {
    const target = s.provinces[t.pending];
    t.pending = null;
    if (q.yes) {
      delta += 2;
      out.push(any([`Good! Then let us take ${target.town} together.`, `I knew you had it in you. ${target.town} it is.`]));
      offer = { id: `march:${target.id}`, label: `Ask him to march on ${target.town}` };
    } else {
      delta -= 1;
      out.push(any(['Hm. Another time, then.', 'Pity. I will find another way.']));
    }
    return { say: [any(v.open), ...out].filter(Boolean).join(' '), delta, offer };
  }

  // 3. Armies and places named: a real assessment, and his view as a soldier.
  const enemyArmy = q.armies.find((a) => hostile(s, t.faction === PLAYER ? PLAYER : t.faction, a.owner) || (ally && a.owner !== PLAYER));
  if (enemyArmy) {
    const { line, good } = assessArmy(s, t, enemyArmy);
    out.push(line);
    if (ally) {
      if (good || bold) out.push(good ? 'We can beat them if we strike together and strike first.' : 'Not enough on paper. But Mughals fight badly in broken country, and I would like to try.');
      else out.push('Too many for us, unless we draw them out piecemeal. I would not attack them as they stand.');
      if (good || bold) offer = { id: `strike:${enemyArmy.id}`, label: `Ask him to attack ${enemyArmy.general.name}'s army with you` };
    } else if (enemyArmy.owner === t.faction) {
      out.push('Our men. Do not think you will find them easy.');
    }
  } else if (q.places.length) {
    const { p: pl } = q.places[0];
    const owner = s.factions[pl.owner];
    out.push(`${pl.town}? ${pl.owner === t.faction ? 'Ours' : `Held by the ${owner.short}`}, ${pl.walls >= 3 ? 'a great fort' : pl.walls ? 'walled' : 'open'}, with ${Math.round(unitsMen(pl.garrison))} men in the garrison${pl.siege ? ', and under siege right now' : ''}.`);
    if (ally && hostile(s, PLAYER, pl.owner)) {
      const strong = t.army ? armyStrength(t.army) > (unitsStrength(pl.garrison) + 10) * (1 + pl.walls * 0.5) : false;
      out.push(strong || bold ? `I could take it${strong ? '' : ', with luck and ladders'}.` : 'It would need more men than I have.');
      if (strong || bold) offer = { id: `march:${pl.id}`, label: `Ask him to march on ${pl.town}` };
    }
  }

  // 4. People and realms named.
  for (const other of q.people.slice(0, 1)) if (enemyArmy?.general !== other) out.push(opinionOf(s, g, t.faction, other));
  if (!q.people.length && q.realms.length && !enemyArmy) {
    const r = q.realms[0];
    out.push(r.id === t.faction ? `The ${r.short}? My own people.` : s.war[t.faction][r.id] ? `The ${r.short} are our enemies, and I will not pretend otherwise.` : `The ${r.short}? We are at peace with them, for what peace is worth.`);
  }

  // 5. What he was asked to do, in plain words: he says how he feels, and it can be made formal.
  if (q.intents.has('join') && ally && t.army && !isYours(s, t.army) && !offer) {
    const att = (g.opinion ?? 0) + 10;
    out.push(att > 25 ? 'Join forces? Gladly. Two fists hit harder than two fingers.' : 'Join forces with a captain I hardly know? Prove yourself first, and then ask me.');
    offer = { id: 'join', label: 'Ask him to join forces with you' };
  }
  if (q.intents.has('strike') && !enemyArmy && !q.places.length && ally) {
    const aim = agenda(s, g, t.faction, t.army);
    if (aim.prov) {
      out.push(`Attack? Aye, but where? ${aim.line} Will you ride with me?`);
      t.pending = aim.prov.id;
    }
  }
  if (!ally && (q.intents.has('withdraw') || q.intents.has('surrender'))) out.push(bold ? 'You give me orders? Look at your own men first.' : 'That is a large thing to ask of a man with an army at his back.');
  if (!ally && (q.intents.has('defect') || q.intents.has('join'))) {
    if (!offer && t.kind === 'parley') offer = { id: 'defect', label: 'Invite him into your service (150 gold)' };
  }
  if (!ally && (q.intents.has('defect') || q.intents.has('join'))) out.push(g.loyalty < 40 ? '…Careful. Walls have ears, even in a tent. But I am listening.' : 'Betray my master? You mistake me for a lesser man.');
  if (q.intents.has('peace') && !ally) out.push(s.war[PLAYER][t.faction] ? 'Peace is for kings to make, not captains. Take it to my master.' : 'We are at peace. Let us keep it so.');

  // 6. Questions about himself, his master, the news, you.
  const answered = q.people.length > 0 || q.places.length > 0 || !!enemyArmy;
  if (!out.length || (q.question && !answered)) {
    if (q.intents.has('plan') || q.intents.has('counsel')) {
      const aim = agenda(s, g, t.faction, t.army);
      out.push(aim.line);
      if (ally && aim.prov) {
        out.push('Will you ride with me?');
        t.pending = aim.prov.id;
      }
    } else if (q.intents.has('about')) out.push(`I am ${g.name} of the house of ${g.house}. Men call me ${TRAITS[g.trait].name.toLowerCase()}, and I have earned it.`);
    else if (q.intents.has('lord')) out.push(g.loyalty > 70 ? 'I serve my master gladly. Ask me nothing more on that.' : g.loyalty > 40 ? 'I do my duty.' : 'My master remembers my failures better than my victories.');
    else if (q.intents.has('news')) {
      const item = [...s.log].reverse().find((l) => !l.mine && s.day - l.day < 60);
      out.push(item ? `They say: ${item.text}` : 'The roads are quiet. Too quiet.');
    } else if (q.intents.has('war')) out.push(ally ? agenda(s, g, t.faction, t.army).line : 'The war goes as God wills it.');
  }
  if (q.intents.has('greet') && !out.length) out.push(any(['And to you.', 'Ram Ram.', 'Well met.']));
  if (q.intents.has('thanks') && !out.length) out.push(any(['It is nothing.', 'Thank me when the fort is ours.']));

  // 7. Nothing he could take hold of: he steers the talk to what he cares about, and asks you.
  if (!out.length) {
    const aim = agenda(s, g, t.faction, t.army);
    if (ally && aim.prov && !t.pending) {
      out.push(`I am not sure I follow you. But here is what is on my mind: ${aim.line} Will you ride with me?`);
      t.pending = aim.prov.id;
    } else out.push(any(['Speak plainly; I am a soldier, not a poet.', 'I do not follow. Say what you mean.', `${aim.line} What is it you want of me?`]));
  }
  const close = Math.random() < 0.35 ? any(v.close) : '';
  const open = Math.random() < 0.4 ? any(v.open) : '';
  return { say: [open, ...out, close].filter(Boolean).join(' '), delta, offer };
}
