import type { ChatMessage } from '../llm';
import { cessionFor, peaceTerms, propose, roughMen } from './realm';
import {
  acceptsPeace, type Army, armyById, armyStrength, isYours, ORIGINS, type Origin, yourArmy, dateLabel, declareWar, dist, factionStrength, type GameState, type General,
  generalRank, IND, log, manpowerLabel, manpowerRatio, nearestOwned, PLAYER, provinceUnder, provincesOf, RANK_NAMES,
  removeArmy, setGoal, TRAITS, unitsMen, yearOf,
} from './state';

/**
 * Characters you can talk to: the commanders of every army and the sovereigns
 * of every realm, each with a temperament, an opinion of you and a memory of
 * what passed between you. Conversation (free text, answered by a local
 * language model when one is set up) moves their opinion a little; concrete
 * deals are offered with buttons and decided by the game's own rules, with
 * that opinion counting, and the character then voices the answer.
 */

/** parley: between armies; audience: with a foreign sovereign; counsel: with a fellow Maratha commander; liege: with Shivaji. */
export type TalkKind = 'parley' | 'audience' | 'counsel' | 'liege';

export interface Talk {
  kind: TalkKind;
  gen: General;
  /** The realm the character serves. */
  faction: number;
  /** Their army (parley, counsel), if any. */
  army: Army | null;
  /** The player's army they're facing (parley). */
  mine: Army | null;
  /** The dialogue so far (user = the player, assistant = the character). */
  history: ChatMessage[];
  /** Opinion won by charm this conversation (capped). */
  gained: number;
  /** What was agreed or refused. */
  outcomes: string[];
  /** The talk resolved the encounter: no battle (parley only). */
  settled: boolean;
  /** Talks broke down: fight. */
  fight: boolean;
}

export interface TalkAction {
  id: string;
  label: string;
  help: string;
}

export interface Resolution {
  accepted: boolean;
  /** What happened, for the log and the reply prompt. */
  text: string;
  /** For the model: the decision it must voice, and why. */
  brief: string;
  ends: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A stable number in 0..1 from a name, so a character's temperament doesn't change between games. */
function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** What history says of the best-known figures (given to the model, and fixing their temperament). */
const KNOWN: Record<string, { note: string; honour?: number; greed?: number; temper?: number }> = {
  Aurangzeb: { note: 'A pious, austere and relentless emperor. Shivaji slipped out of your custody at Agra in 1666 and you have never forgiven it.', honour: 0.45, greed: 0.2, temper: 0.35 },
  'Diler Khan': { note: 'An Afghan warrior of the old school, blunt, fierce and proud.', temper: 0.85, greed: 0.4 },
  'Shaista Khan': { note: 'Shivaji raided your quarters at Pune by night in 1663 and you lost your fingers; you have not forgotten.', temper: 0.6 },
  'Ram Singh': { note: 'A Rajput prince in Mughal service; Shivaji escaped from Agra while in your charge, and you still feel some sympathy for him.', honour: 0.75 },
  'Ali Adil Shah': { note: 'The young Sultan of Bijapur. Shivaji killed your general Afzal Khan at Pratapgad in 1659.', temper: 0.5 },
  'Abul Hasan': { note: 'The cultured, pleasure-loving Sultan of Golconda, guided by your Brahmin ministers Madanna and Akkanna.', greed: 0.6, temper: 0.2 },
  Madanna: { note: 'The shrewd Brahmin chief minister of Golconda, open to an understanding with Shivaji.', honour: 0.6 },
  'Siddi Qasim': { note: 'The Abyssinian admiral of Janjira, the Marathas\' bitterest enemy at sea; your island fort has never fallen.', temper: 0.7 },
  'Gerald Aungier': { note: 'President of the East India Company at Bombay: a careful merchant who wants trade and safe harbours, not war.', greed: 0.7, temper: 0.15 },
  'Luís de Mendonça': { note: 'Viceroy of the Portuguese Estado da Índia at Goa, wary of Maratha power on the coast.', temper: 0.4 },
  'Raj Singh': { note: 'The proud Rana of Mewar, defender of Rajput honour, no friend of Aurangzeb.', honour: 0.9 },
  Chokkanatha: { note: 'The Nayak of Madurai, ruling the rich south.', greed: 0.6 },
  'Chikka Devaraja': { note: 'The ambitious young Wodeyar king of Mysore.', temper: 0.55 },
  Udayaditya: { note: 'King of the Ahoms, who beat back the Mughals in Assam.', honour: 0.7 },
  Lachit: { note: 'The great Ahom general who will not yield an inch of Assam to the Mughals.', honour: 0.9, temper: 0.7 },
  Netaji: { note: 'Shivaji\'s cavalry chief, who once went over to the Mughals and has come back.', honour: 0.45 },
  Tanaji: { note: 'Shivaji\'s boyhood friend, fiercely loyal, who has sworn to take Kondhana.', honour: 0.95, temper: 0.8 },
  Prataprao: { note: 'Shivaji\'s brave and impetuous commander of horse.', temper: 0.85 },
  Moropant: { note: 'Shivaji\'s Peshwa, a builder of forts and a careful administrator.', temper: 0.2 },
  Durgadas: { note: 'The loyal Rathore who will defend Marwar against all comers.', honour: 0.95 },
  Shivaji: { note: 'You are the founder of Swarajya, raja of the Marathas: a master of hill forts and of the sudden raid, generous to those who serve you well, stern with those who fail, and you trust deeds more than words.', honour: 0.85, greed: 0.25, temper: 0.4 },
};

export const historyNote = (g: General) => KNOWN[g.name]?.note ?? '';

export function persona(g: General) {
  if (!g.persona) {
    const k = KNOWN[g.name];
    const p = { honour: k?.honour ?? hash01(g.name, 1), greed: k?.greed ?? hash01(g.name, 2), temper: k?.temper ?? hash01(g.name, 3) };
    if (g.trait === 'bold') p.temper = Math.max(p.temper, 0.6);
    if (g.trait === 'cautious') p.temper = Math.min(p.temper, 0.4);
    if (g.trait === 'raider') p.greed = Math.max(p.greed, 0.55);
    g.persona = p;
  }
  return g.persona;
}

export function personaWords(g: General): string {
  const p = persona(g);
  return [
    p.honour > 0.66 ? 'a man of his word, proud of his honour' : p.honour < 0.33 ? 'slippery and calculating' : 'practical',
    p.greed > 0.66 ? 'fond of gold' : p.greed < 0.33 ? 'contemptuous of bribes' : '',
    p.temper > 0.66 ? 'hot-tempered and proud' : p.temper < 0.33 ? 'calm and patient' : '',
  ].filter(Boolean).join(', ');
}

export const rulerOf = (s: GameState, f: number) => s.rulers[f] ?? null;

/** The player's renown: what their deeds have made of their name. */
export const renown = (s: GameState) => generalRank(s.player.gen);

/** How the character feels about the player, -100..100. */
export function attitude(s: GameState, t: Talk): number {
  const name = (s.honour - 50) / 4 + renown(s) * 8;
  // Fellow Marathas (and the Raje) judge you by your deeds and their own opinion of you.
  if (t.faction === PLAYER) return clamp(10 + (t.gen.opinion ?? 0) + name, -100, 100);
  const realm = s.relations[t.faction][PLAYER];
  return clamp(realm * 0.6 + (t.gen.opinion ?? 0) + name, -100, 100);
}

export function attitudeWord(n: number): string {
  return n > 50 ? 'warm' : n > 15 ? 'friendly' : n > -15 ? 'wary' : n > -50 ? 'hostile' : 'full of hatred';
}

/** Your name, as others say it. */
export const meName = (s: GameState) => s.player.gen.name;

/** How Shivaji is styled (crowned or not yet). */
export const liegeTitle = (s: GameState) => (s.eventsDone.includes('coronation') ? 'Chhatrapati Shivaji Maharaj' : 'Shivaji Raje Bhonsle');

/** Who you are, for the characters: a nobody risen by the sword in Shivaji's service. */
export function playerTitle(s: GameState): string {
  const o = ORIGINS[s.player.origin];
  return `${meName(s)}, ${o.blurb}, now a ${RANK_NAMES[renown(s)].toLowerCase()} in the service of ${liegeTitle(s)}`;
}

/** Sets up the player's character at the start of a campaign. */
export function applyPlayerCharacter(s: GameState, name: string, origin: Origin) {
  const g = s.player.gen;
  g.name = name.trim().slice(0, 28) || 'Rao';
  g.house = 'of no great house';
  g.trait = ORIGINS[origin].trait;
  s.player.origin = origin;
  const a = armyById(s, s.player.armyId);
  if (origin === 'silahdar' && a) a.units.push({ type: 'lightcav', men: 30 });
  if (origin === 'deshmukh') s.gold[PLAYER] += 60;
  if (origin === 'carpenter' && a) a.units.push({ type: 'musket', men: 30 });
  log(s, `${g.name}, ${ORIGINS[origin].blurb}, takes service with ${liegeTitle(s)} with a handful of men.`, true);
}

/** Recent happenings between the two realms, from the dispatches. */
function recentNews(s: GameState, f: number): string[] {
  const short = s.factions[f].short;
  return s.log.filter((l) => l.text.includes(short) || l.text.includes(s.factions[f].name)).slice(-4).map((l) => `${dateLabel(l.day)}: ${l.text}`);
}

/** The system prompt that puts the model in the character's shoes. */
export function systemPrompt(s: GameState, t: Talk): string {
  const g = t.gen;
  const f = s.factions[t.faction];
  const att = attitude(s, t);
  const me = meName(s);
  const role = t.kind === 'liege' ? `raja of the ${f.name}` : t.kind === 'audience' ? `sovereign of the ${f.name}` : t.faction === PLAYER
    ? `a commander in the service of ${liegeTitle(s)}` : `a commander of the ${f.name}`;
  const war = t.faction === PLAYER ? '' : s.war[PLAYER][t.faction] ? 'Your realm is AT WAR with the Marathas.'
    : s.ally[PLAYER][t.faction] ? 'Your realm is allied with the Marathas.' : 'Your realm is at peace with the Marathas.';
  const ties = t.faction === PLAYER ? '' : [
    s.marriage[PLAYER][t.faction] ? 'Your houses are joined by marriage.' : '',
    s.truceUntil[PLAYER][t.faction] > s.day ? 'Hostages have been exchanged; a truce is sworn.' : '',
  ].join(' ').trim();
  const strength = t.faction === PLAYER ? '' : (() => {
    const r = (factionStrength(s, t.faction) + 1) / (factionStrength(s, PLAYER) + 1);
    return `Your realm's armies are ${r > 2 ? 'far stronger than' : r > 1.2 ? 'stronger than' : r > 0.8 ? 'about equal to' : 'weaker than'} the Marathas'. Its fighting men are ${manpowerLabel(manpowerRatio(s, t.faction)).toLowerCase()}.`;
  })();
  const field = t.army ? `You lead ${Math.round(unitsMen(t.army.units))} men near ${s.provinces[provinceUnder(s, t.army, t.army.node)].name}.` : '';
  const facing = t.mine && t.army ? `${me}'s army of about ${roughMen(t.mine).replace('~', '')} men stands before yours.` : '';
  const memory = (g.memory ?? []).slice(-3);
  const news = t.faction === PLAYER ? [] : recentNews(s, t.faction);
  return [
    `You are ${g.name} of the house of ${g.house}, ${role}, in India in ${yearOf(s.day)}.`,
    historyNote(g),
    `Your temperament: ${personaWords(g)}. As a soldier you are known as ${TRAITS[g.trait].name.toLowerCase()} (${RANK_NAMES[generalRank(g)].toLowerCase()}).`,
    `You are speaking with ${playerTitle(s)}${t.kind === 'parley' ? ', face to face between your armies' : t.kind === 'audience' ? `, who comes as envoy of the Marathas to your court` : t.kind === 'liege' ? ', who has come to your durbar at Raigad' : ', in camp'}. ${me} is a nobody risen by the sword, not a king; address him accordingly.`,
    war, ties, strength, field, facing,
    `${me}'s reputation for keeping his word is ${s.honour > 70 ? 'excellent' : s.honour > 45 ? 'fair' : 'poor'}; his name as a soldier is ${renown(s) >= 2 ? 'well known' : renown(s) >= 1 ? 'growing' : 'unknown'}.`,
    `Your feeling towards ${me}: ${attitudeWord(att)}.`,
    memory.length ? `What you remember of earlier dealings: ${memory.join(' ')}` : '',
    news.length ? `Recent news: ${news.join(' ')}` : '',
    '',
    'Rules for your replies:',
    '- Speak only as this character, in the first person, in one to three short sentences. Courtly, of the 1670s, no modern words.',
    `- Never agree to give up territory, money, troops or peace on your own. Such matters are settled only when ${me} makes a formal proposal; then you will be told the decision to voice.`,
    `- After your words, on its own last line, write OPINION: followed by a number from -5 to 5: how much this exchange improved (+) or worsened (-) your view of ${me}. Flattery that rings false, threats and insults lower it; respect, honesty and courtesy raise it.`,
  ].filter(Boolean).join('\n');
}

/** Splits the model's reply into speech and the opinion change it reports. */
export function parseReply(text: string): { say: string; delta: number } {
  const m = text.match(/OPINION\s*[:=]\s*([+-]?\d+)/i);
  const delta = m ? clamp(Number(m[1]), -5, 5) : 0;
  const say = text.replace(/\n?\s*OPINION\s*[:=].*$/is, '').replace(/^["“]|["”]$/g, '').trim();
  return { say: say || '…', delta };
}

/** Without a language model: a reply chosen from the character's mood and the tone of what was said. */
export function scriptedReply(s: GameState, t: Talk, text: string): { say: string; delta: number } {
  const w = text.toLowerCase();
  const p = persona(t.gen);
  let delta = 0;
  if (/(honou?r|respect|great|glory|wise|brave|valou?r|noble|friend)/.test(w)) delta += p.honour > 0.5 ? 2 : 1;
  if (/(coward|dog|fool|traitor|worm|weak|slave)/.test(w)) delta -= 4;
  if (/(destroy|burn|kill|crush|slaughter|die)/.test(w)) delta += p.temper > 0.6 ? -3 : -1;
  if (/(gold|reward|wealth|jagir|pay)/.test(w)) delta += p.greed > 0.6 ? 2 : 0;
  const att = attitude(s, t) + delta * 4;
  const name = t.gen.name;
  const lines = att > 40
    ? ['Your words are welcome, Raje. Speak plainly and you will find me reasonable.', 'There is more that unites us than divides us. Say what you came to say.']
    : att > 0
      ? ['I hear you. Words cost nothing; let us see what you propose.', 'You speak boldly for a man of no great name. Go on.']
      : att > -40
        ? ['Mind your tongue. I have not forgotten what your raiders have done.', 'Say your piece quickly. My patience has limits.']
        : ['Enough. There is nothing I wish to hear from a mountain rat.', 'Every word you speak hardens my heart. Leave, or fight.'];
  return { say: `${lines[(text.length + name.length) % lines.length]}`, delta };
}

/** Applies the opinion change from a line of conversation, within limits. */
export function applyDelta(s: GameState, t: Talk, delta: number): number {
  let d = delta;
  if (d > 0) {
    // Charm works once a month, and only so far in one sitting.
    if (s.day - (t.gen.charmedDay ?? -99) < 30 && t.gained === 0) d = Math.min(d, 1);
    d = Math.min(d, 10 - t.gained);
    if (d <= 0) return 0;
    t.gained += d;
    t.gen.charmedDay = s.day;
  }
  if (t.kind === 'audience') s.relations[t.faction][PLAYER] = clamp(s.relations[t.faction][PLAYER] + d, -100, 100);
  else t.gen.opinion = clamp((t.gen.opinion ?? 0) + d * 2, -60, 60);
  return d;
}

// ---------------------------------------------------------------- deals

export function actionsFor(s: GameState, t: Talk): TalkAction[] {
  if (t.kind === 'parley') {
    const out: TalkAction[] = [];
    const war = s.war[PLAYER][t.faction] || t.faction === IND;
    if (war) {
      out.push({ id: 'withdraw', label: 'Demand they withdraw', help: 'They march home and leave you be. Likelier if you are much stronger or they think well of you.' });
      out.push({ id: 'surrender', label: 'Demand surrender', help: 'Their regiments lay down their arms and their commander is your prisoner. Only if they are hopelessly outmatched.' });
      out.push({ id: 'pass', label: 'Propose to pass in peace', help: 'No battle today: both armies go their ways.' });
      out.push({ id: 'defect', label: 'Invite him into your service (150 gold)', help: 'He brings his army over to you. Only a commander who likes you and is not bound to his master by loyalty.' });
    }
    out.push({ id: 'gift', label: 'Offer a gift (60 gold)', help: 'Warms him to you. The greedy most of all.' });
    if (war) out.push({ id: 'challenge', label: 'Break off and give battle', help: 'End the talk; the battle begins.' });
    return out;
  }
  if (t.kind === 'audience') {
    const war = s.war[PLAYER][t.faction];
    const cede = war ? cessionFor(s, t.faction) : null;
    return war
      ? [
        { id: 'peace', label: 'Propose peace', help: 'A white peace.' },
        { id: 'peace-tribute', label: 'Peace, if they pay tribute', help: 'They pay gold for peace.' },
        ...(cede ? [{ id: 'peace-province', label: `Peace, if they cede ${cede.name}`, help: 'They hand over a province.' }] : []),
        { id: 'royal-gift', label: 'Send rich gifts (80 gold)', help: 'Goodwill at their court.' },
      ]
      : [
        { id: 'alliance', label: 'Propose an alliance', help: 'They join wars against those who attack you.' },
        { id: 'marriage', label: 'Propose a marriage', help: 'Joins your houses: they will be slow to fight you.' },
        { id: 'hostages', label: 'Exchange hostages', help: 'Two years of sworn peace.' },
        { id: 'royal-gift', label: 'Send rich gifts (80 gold)', help: 'Goodwill at their court.' },
        { id: 'war', label: 'Declare war', help: 'End the audience with a declaration of war.' },
      ];
  }
  if (t.kind === 'liege') {
    return [
      { id: 'counsel', label: 'Ask the Raje\'s counsel', help: 'Shivaji gives his view of the war.' },
      { id: 'report', label: 'Report your deeds', help: 'Tell of the battles you have won since you last reported. The Raje rewards deeds, not words.' },
      { id: 'men', label: 'Ask for men', help: 'Two regiments of Mavalas for your army, if you stand at a town of the realm and have shown your worth (once every two months).' },
    ];
  }
  const theirs = t.army && !isYours(s, t.army);
  return [
    { id: 'counsel', label: 'Ask his counsel on the war', help: 'He gives his view of the situation.' },
    { id: 'share', label: 'Share your spoils (60 gold)', help: 'He thinks better of you.' },
    ...(theirs ? [{ id: 'join', label: 'Ask him to join forces with you', help: 'His army marches to yours and merges with it. Only if he respects you, and your name stands as high as his.' }] : []),
  ];
}

/** Settles a proposal by the game's rules (with the character's attitude counting). */
export function resolveAction(s: GameState, t: Talk, id: string): Resolution {
  const att = attitude(s, t);
  const p = persona(t.gen);
  const f = s.factions[t.faction];
  const say = (accepted: boolean, text: string, why: string, ends = false): Resolution => {
    if (text) t.outcomes.push(text);
    return { accepted, text, brief: `${accepted ? 'You ACCEPT' : 'You REFUSE'}. Reason: ${why}`, ends };
  };
  const them = t.army ? armyStrength(t.army) : 0;
  const us = t.mine ? armyStrength(t.mine) : 0;
  switch (id) {
    case 'withdraw': {
      const ok = them < us * (0.8 + Math.max(0, att) / 150) || (att > 50 && them < us * 1.3);
      if (!ok) return say(false, `${t.gen.name} refuses to withdraw.`, them >= us ? 'your army is the stronger and you will not yield ground' : `you will not be ordered about by ${meName(s)}`);
      const home = nearestOwned(s, t.army!);
      if (home >= 0) setGoal(s, t.army!, { kind: 'go', prov: home });
      t.army!.safeUntil = t.mine!.safeUntil = s.day + 4;
      t.army!.aiNext = s.day + 6;
      t.settled = true;
      return say(true, `${t.gen.name} agrees to withdraw his army.`, them < us ? 'you are outmatched and will not throw away your men' : `you think well enough of ${meName(s)} to avoid bloodshed`, true);
    }
    case 'surrender': {
      const ok = them < us * 0.35 * (1 + Math.max(0, att) / 100) || (them < us * 0.6 && manpowerRatio(s, t.faction) < 0.2);
      if (!ok) return say(false, `${t.gen.name} scorns the demand to surrender.`, 'you are not beaten, and surrender would dishonour you');
      if (t.faction !== IND) s.captives.push({ gen: t.gen, owner: t.faction, by: PLAYER, day: s.day });
      removeArmy(s, t.army!, false);
      t.settled = true;
      log(s, `${t.gen.name} lays down his arms before ${meName(s)}. ${Math.round(unitsMen(t.army!.units))} men disband.`, true);
      return say(true, `${t.gen.name} surrenders.`, 'your men are hopelessly outmatched and you choose life over a massacre', true);
    }
    case 'pass': {
      const ok = att > -20 || them < us;
      if (!ok) return say(false, `${t.gen.name} will not let you pass.`, 'you mean to fight');
      t.army!.safeUntil = t.mine!.safeUntil = s.day + 3;
      if (t.army!.goal?.kind === 'chase') setGoal(s, t.army!, null);
      if (t.mine!.goal?.kind === 'chase') setGoal(s, t.mine!, null);
      t.settled = true;
      return say(true, 'The armies part without a fight.', 'there is nothing to be won here today', true);
    }
    case 'defect': {
      if (s.gold[PLAYER] < 150) return say(false, '', `${meName(s)} does not have the gold he promises`);
      const isRuler = s.rulers[t.faction] === t.gen;
      const ok = !isRuler && att > 30 && t.gen.loyalty < 55 + p.honour * 20 && (p.greed > 0.4 || att > 60);
      if (!ok) return say(false, `${t.gen.name} will not betray his master.`, isRuler ? 'you are a sovereign' : 'your loyalty and honour forbid it');
      s.gold[PLAYER] -= 150;
      const a = t.army!;
      a.owner = PLAYER;
      a.goal = null;
      a.route = [];
      t.gen.loyalty = 45 + att / 4;
      t.settled = true;
      s.relations[t.faction][PLAYER] -= 15;
      log(s, `${t.gen.name} brings his army over to Swarajya!`, true);
      return say(true, `${t.gen.name} enters your service with his army.`, `${meName(s)} has won your heart and pays well; your old master never valued you`, true);
    }
    case 'gift': {
      if (s.gold[PLAYER] < 60) return say(false, '', `${meName(s)} has no gold to give`);
      s.gold[PLAYER] -= 60;
      t.gen.opinion = clamp((t.gen.opinion ?? 0) + 8 + p.greed * 14, -60, 60);
      return say(true, `${t.gen.name} accepts your gift.`, p.greed > 0.6 ? 'you are pleased by the gold' : 'courtesy obliges you');
    }
    case 'challenge':
      t.fight = true;
      return { accepted: true, text: 'Talks are broken off.', brief: `${meName(s)} breaks off the talks: battle will follow. Answer with defiance.`, ends: true };
    case 'peace':
    case 'peace-tribute':
    case 'peace-province': {
      const willing = acceptsPeace(s, t.faction, PLAYER) || (att > 35 && s.rng.chance(0.5));
      const [made, text] = peaceTerms(s, t.faction, id === 'peace' ? 'white' : id === 'peace-tribute' ? 'tribute' : 'province', willing);
      return say(made, text, made ? 'the war no longer serves your realm' : 'the war is not yet decided, or the terms are too hard');
    }
    case 'royal-gift':
    case 'alliance':
    case 'marriage':
    case 'hostages': {
      const what = id === 'royal-gift' ? 'gift' : id;
      const before = s.relations[t.faction][PLAYER];
      // A good opinion at court helps: for this proposal, it counts towards their goodwill.
      s.relations[t.faction][PLAYER] = clamp(before + Math.max(0, (t.gen.opinion ?? 0) / 2), -100, 100);
      const text = propose(s, t.faction, what as 'gift' | 'alliance' | 'marriage' | 'hostages');
      const ok = what === 'gift' ? !text.startsWith('Not enough')
        : what === 'alliance' ? s.ally[PLAYER][t.faction] : what === 'marriage' ? s.marriage[PLAYER][t.faction] : s.truceUntil[PLAYER][t.faction] > s.day;
      if (!ok) s.relations[t.faction][PLAYER] = Math.min(s.relations[t.faction][PLAYER], before);
      return say(ok, text, ok ? 'it serves your realm' : `it does not serve your realm, or you do not trust the Marathas enough`);
    }
    case 'war':
      declareWar(s, PLAYER, t.faction);
      return { accepted: true, text: `War is declared on the ${f.name}.`, brief: `The Marathas have just declared war on your realm. Answer with cold fury.`, ends: true };
    case 'share': {
      if (s.gold[PLAYER] < 60) return say(false, '', `${meName(s)} has no gold to share`);
      s.gold[PLAYER] -= 60;
      t.gen.opinion = clamp((t.gen.opinion ?? 0) + 8 + p.greed * 12, -60, 60);
      return say(true, `${t.gen.name} takes his share.`, 'a comrade who shares the spoils is a comrade worth having');
    }
    case 'join': {
      const mine = yourArmy(s);
      const ok = !!mine && !!t.army && att > 25 && (renown(s) >= generalRank(t.gen) || att > 55)
        && t.army.units.length + mine.units.length <= 20;
      if (!ok) {
        return say(false, `${t.gen.name} keeps his own command.`, !mine || !t.army ? 'there is no army to join'
          : t.army.units.length + mine.units.length > 20 ? 'your two armies together would be too many to feed' : `${meName(s)} has not yet earned the right to lead you`);
      }
      setGoal(s, t.army!, { kind: 'join', army: mine!.id });
      t.army!.aiNext = s.day + 30;
      return say(true, `${t.gen.name} marches to join your army.`, `you respect ${meName(s)} and will serve under him`, true);
    }
    case 'report': {
      const won = s.player.gen.xp - s.player.reportedXp;
      if (won < 1.4) return say(false, '', `${meName(s)} has done nothing of note since he last stood here`);
      const gold = Math.round(won * 22);
      s.player.reportedXp = s.player.gen.xp;
      t.gen.opinion = clamp((t.gen.opinion ?? 0) + 6, -60, 60);
      s.honour = Math.min(100, s.honour + 2);
      s.gold[PLAYER] += gold;
      return say(true, `The Raje rewards your service with ${gold} gold.`, `${meName(s)} has fought well and deserves reward`);
    }
    case 'men': {
      const mine = yourArmy(s);
      const at = mine ? s.provinces.find((q) => q.owner === PLAYER && dist(q, mine) < 4) : undefined;
      if (s.day - s.player.lastAsk < 60) return say(false, '', 'you gave him men only lately');
      if (!mine || !at) return say(false, '', `${meName(s)} must stand at a town of the realm to receive men`);
      if (att < 0 && renown(s) < 1) return say(false, '', `${meName(s)} has not yet shown his worth`);
      if (mine.units.length > 18) return say(false, '', 'his army is already as large as an army can be');
      s.player.lastAsk = s.day;
      mine.units.push({ type: 'mavala', men: 42 }, { type: 'mavala', men: 36 });
      return say(true, 'The Raje gives you two regiments of Mavalas.', `${meName(s)} serves you well and Swarajya needs commanders`);
    }
    case 'counsel':
      return { accepted: true, text: '', brief: `${meName(s)} asks your counsel. Give it in two or three sentences, as a ${TRAITS[t.gen.trait].name.toLowerCase()} would, using this news: ${counselFacts(s)}`, ends: false };
  }
  return say(false, '', 'unknown proposal');
}

/** Plain facts about the war for a commander's counsel. */
function counselFacts(s: GameState): string {
  const foes = s.factions.filter((f) => f.alive && f.id !== PLAYER && f.id !== IND && s.war[PLAYER][f.id]);
  const mine = provincesOf(s, PLAYER).length;
  const near = s.armies.filter((a) => a.owner !== PLAYER && s.war[PLAYER][a.owner]
    && s.armies.some((m) => m.owner === PLAYER && dist(m, a) < 150)).map((a) => `${a.general.name}'s army of the ${s.factions[a.owner].short} (${roughMen(a)} men)`);
  const sieges = s.provinces.filter((p) => p.siege && p.owner === PLAYER).map((p) => p.town);
  return [
    `We hold ${mine} provinces and ${s.gold[PLAYER]} gold; our fighting men are ${manpowerLabel(manpowerRatio(s, PLAYER)).toLowerCase()}.`,
    foes.length ? `We are at war with ${foes.map((f) => `the ${f.short} (men ${manpowerLabel(manpowerRatio(s, f.id)).toLowerCase()})`).join(', ')}.` : 'We are at peace.',
    near.length ? `Enemy armies near ours: ${near.join('; ')}.` : '',
    sieges.length ? `Our towns under siege: ${sieges.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

/** Scripted voice for a decision, without a language model. */
export function scriptedDecision(t: Talk, r: Resolution): string {
  if (t.kind === 'counsel' && !r.text) return `Raje, strike where they are weak and never where they wait for us. Guard the forts, and let their armies starve in the hills.`;
  if (r.brief.includes('declared war')) return 'So be it. You will regret this day.';
  if (r.brief.includes('breaks off')) return 'Then let our swords speak. Har Har Mahadev, if you must; we shall see whose god is listening.';
  return r.accepted
    ? ['It is agreed.', 'So be it. Let it be done as you say.', 'Very well. You have my word.'][r.text.length % 3]
    : ['No. That I will not do.', 'You ask too much.', 'I refuse. Do not ask again.'][r.text.length % 3];
}

/** After a conversation: a line for the character's memory. */
export function remember(s: GameState, t: Talk) {
  const att = attitude(s, t);
  const what = t.outcomes.length ? t.outcomes.join(' ') : 'Words only, nothing agreed.';
  const line = `On ${dateLabel(s.day)} you spoke with ${meName(s)} (${t.kind === 'parley' ? 'between armies' : t.kind === 'audience' ? 'when he came as envoy' : t.kind === 'liege' ? 'at your durbar' : 'in camp'}): ${what} You came away ${attitudeWord(att)}.`;
  t.gen.memory = [...(t.gen.memory ?? []), line].slice(-6);
}

/** Your army, if it is close enough to parley with (or talk to) this one. */
export function parleyPartner(s: GameState, a: Army): Army | null {
  const mine = yourArmy(s);
  if (!mine || isYours(s, a) || dist(mine, a) > 60) return null;
  return mine;
}
