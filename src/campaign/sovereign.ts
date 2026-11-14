/**
 * Founding your own realm, and what the death of the great does to the map:
 * successions, broken empires, revolts and empty barracks.
 */
import { GENERALS } from '../data';
import { chronicle } from './chronicle';
import {
  type Army, COURT_FAITHS, type CourtFaith, dist, fid, type GameState, type General, generalRank, IND,
  leaveBanner, log, makeGeneral, newUnit, PLAYER, type Policy, type Province, provincesOf, provinceUnder, REALM_TYPES,
  type RealmType, setPlayerFaction, townAt, unitsMen, yearOf, yourArmy,
} from './state';

// ---------------------------------------------------------------- founding a realm

export interface FoundingPlan {
  name: string;
  color: string;
  type: RealmType;
  faith: CourtFaith;
  policy: Policy;
  how: 'revolt' | 'leave';
}

export const REALM_COLORS = ['#d9b64a', '#c0392b', '#1f6f8b', '#6c3483', '#d35400', '#117a65', '#f0f0e8', '#2c2c2c'];

/** Renown (rank) and men a nobody needs before chiefs will follow him as a sovereign. */
export const FOUND_RANK = 1;
export const FOUND_MEN = 250;

/** Can you found your own realm now, and how? */
export function foundingOptions(s: GameState): { ok: boolean; why: string; revoltAt: Province | null } {
  if (s.realm) return { ok: false, why: 'You already rule your own realm.', revoltAt: null };
  const a = yourArmy(s);
  if (!a) return { ok: false, why: 'You have no army to raise your banner with.', revoltAt: null };
  if (generalRank(s.player.gen) < FOUND_RANK) return { ok: false, why: 'No chief will follow a captain nobody has heard of. Win renown in battle first (Commander rank).', revoltAt: null };
  if (unitsMen(a.units) < FOUND_MEN) return { ok: false, why: `Raise a following first: at least ${FOUND_MEN} men under your banner.`, revoltAt: null };
  const t = townAt(s, a);
  const p = t >= 0 ? s.provinces[t] : null;
  const revoltAt = p && p.owner === PLAYER && p.capitalOf !== PLAYER && !p.siege ? p : null;
  return { ok: true, why: '', revoltAt };
}

/** Raises your own banner: a new realm with you as its sovereign. */
export function foundRealm(s: GameState, plan: FoundingPlan): string {
  const own = fid('own');
  const liege = PLAYER;
  const L = s.factions[liege];
  const a = yourArmy(s)!;
  const T = REALM_TYPES[plan.type];
  const { revoltAt } = foundingOptions(s);
  const how = plan.how === 'revolt' && revoltAt ? 'revolt' : 'leave';

  const f = s.factions[own];
  f.alive = true;
  f.name = plan.name.trim() || `${T.label} of ${s.player.gen.name}`;
  f.short = f.name.length > 18 ? f.name.split(/\s+/).slice(-1)[0] : f.name;
  f.color = plan.color;
  f.rgb = [parseInt(plan.color.slice(1, 3), 16), parseInt(plan.color.slice(3, 5), 16), parseInt(plan.color.slice(5, 7), 16)];
  f.roster = [...T.roster];
  f.garrison = [...T.garrison];
  f.incomeMult = T.income;
  f.ai = 'major';
  f.aggression = 0;
  s.policy[own] = { ...plan.policy };
  s.realm = { faction: own, type: plan.type, faith: plan.faith, founded: s.day, how };

  // Your army is now your realm's.
  if (a.follows !== undefined) leaveBanner(s, a);
  for (const x of s.armies) if (x.follows === a.id) leaveBanner(s, x);
  a.owner = own;
  a.front = undefined;
  // The treasury you kept for the Raje: a share of it rides with you.
  const share = Math.round(s.gold[liege] * (how === 'revolt' ? 0.4 : 0.2));
  s.gold[liege] -= share;
  s.gold[own] = 80 + share;
  s.manpower[own] = 350;
  // Two companions who threw in their lot with you.
  s.officers[own] = [makeGeneral(s.rng, s.rng.pick(['Bahirji', 'Kanhoji', 'Malhar', 'Santaji', 'Dhanaji', 'Khanduji']), s.rng.pick(['Naik', 'Jadhav', 'Ghorpade', 'Shinde']), 2),
    makeGeneral(s.rng, s.rng.pick(['Ismail', 'Rustam', 'Daulat', 'Yesaji', 'Godaji', 'Manaji']), s.rng.pick(['Khan', 'Rao', 'Bhosale', 'Angre']), 1)];
  for (const g of s.officers[own]) g.loyalty = 80;

  // The courts weigh you up: kin in faith warm to you, others are wary.
  for (const o of s.factions) {
    if (o.id === own || o.id === IND) continue;
    const same = courtFaithOf(s, o.id) === plan.faith;
    const base = Math.round(s.relations[o.id][liege] * 0.4) + (same ? 15 : -10);
    s.relations[o.id][own] = s.relations[own][o.id] = base;
  }
  setPlayerFaction(own);
  // The Raje's realm now makes its own wars.
  L.aggression = Math.max(L.aggression, 0.5);

  let text: string;
  if (how === 'revolt') {
    const p = revoltAt!;
    p.owner = own;
    p.capitalOf = own;
    p.tribute = null;
    p.jagir = false;
    p.takenDay = s.day;
    p.unrest = Math.min(100, p.unrest + 10);
    s.war[liege][own] = s.war[own][liege] = true;
    s.warSince[liege][own] = s.warSince[own][liege] = s.day;
    s.relations[liege][own] = s.relations[own][liege] = -60;
    s.honour = Math.max(0, s.honour - 15);
    // Discontented commanders of the Raje may bring their armies over to you.
    const turned: string[] = [];
    for (const x of s.armies) {
      if (x.owner !== liege || x === a) continue;
      const g = x.general;
      if ((g.loyalty < 40 || (g.opinion ?? 0) >= 45) && s.rng.chance(0.55)) {
        x.owner = own;
        x.front = undefined;
        x.goal = null;
        x.route = [];
        g.loyalty = 65;
        turned.push(`${g.name} (${Math.round(unitsMen(x.units))} men)`);
      }
    }
    text = `You raise your own banner at ${p.town} and proclaim the ${f.name}. ${L.name} is at war with you.${turned.length ? ` ${turned.join(', ')} come over to you.` : ''}`;
  } else {
    // A parting in good faith: the Raje lets you go with his blessing and a year's truce.
    s.truceUntil[liege][own] = s.truceUntil[own][liege] = s.day + 360;
    s.relations[liege][own] = s.relations[own][liege] = 25;
    text = `You take leave of the Raje with his blessing and ride out to carve a realm of your own: the ${f.name}. Take a town and it will be your seat.`;
  }
  log(s, text, true);
  chronicle(s, 'court', `${s.player.gen.name} became ${T.title} of the ${f.name} (${T.label.toLowerCase()}, ${COURT_FAITHS[plan.faith]}). ${text}`);
  return text;
}

const courtFaithOf = (s: GameState, f: number): CourtFaith => {
  const k = s.factions[f].key;
  return ['mug', 'bij', 'gol', 'sid', 'saf', 'ace', 'dec', 'ben', 'awd'].includes(k) ? 'muslim'
    : ['por', 'eng', 'voc'].includes(k) ? 'christian' : ['ava', 'aya', 'dvt'].includes(k) ? 'buddhist' : 'hindu';
};

/** "Raja Rao of the Maratha hills": how you are styled once you rule. */
export function sovereignTitle(s: GameState): string | null {
  if (!s.realm) return null;
  return `${REALM_TYPES[s.realm.type].title} ${s.player.gen.name}`;
}

// ---------------------------------------------------------------- the death of the great

/** Who takes the throne when a sovereign dies, in order. */
const HEIRS: Record<string, [string, string][]> = {
  mar: [['Sambhaji', 'Bhonsle'], ['Rajaram', 'Bhonsle'], ['Shahu', 'Bhonsle']],
  mug: [['Muazzam', 'Timurid'], ['Jahandar Shah', 'Timurid'], ['Farrukhsiyar', 'Timurid'], ['Muhammad Shah', 'Timurid']],
  bij: [['Sikandar Adil Shah', 'Adil Shahi']],
  gol: [['Mir Jumla', 'Ardistani']],
  raj: [['Jai Singh', 'Sisodia'], ['Amar Singh', 'Sisodia']],
  sid: [['Siddi Sambal', 'Janjira'], ['Siddi Khairiyat', 'Janjira']],
  nay: [['Rangakrishna', 'Muthu Virappa']],
  mys: [['Kanthirava', 'Wodeyar']],
  aho: [['Ramdhwaj', 'Singha'], ['Gadadhar', 'Singha']],
  saf: [['Sultan Husayn', 'Safavid']],
  ava: [['Narawara', 'Toungoo'], ['Minye Kyawhtin', 'Toungoo']],
  aya: [['Phetracha', 'Ban Phlu Luang']],
  dvt: [['Trinh Can', 'Trinh']],
};

/** When the sovereigns of the age died in their beds (or were made to). Rulers live on in the game until then. */
const DIES_BY: Record<string, number> = {
  Shivaji: 1680, Aurangzeb: 1707, 'Ali Adil Shah': 1672, 'Raj Singh': 1680, Udayaditya: 1672, 'Shah Suleiman': 1694,
  Narai: 1688, 'Chikka Devaraja': 1704, Chokkanatha: 1682, 'Pye Min': 1672, 'Trinh Tac': 1682, 'Siddi Qasim': 1707,
  Sambhaji: 1689, Rajaram: 1700, Muazzam: 1712, 'Sikandar Adil Shah': 1686, Phetracha: 1703,
};

/** The successor states that rise from the Mughal provinces when the throne falls empty. */
const SUCCESSORS: { key: string; regions: string[] }[] = [
  { key: 'dec', regions: ['Mughal Deccan', 'Khandesh & Berar', 'Golconda'] },
  { key: 'ben', regions: ['Bengal'] },
  { key: 'awd', regions: ['Awadh & Bihar'] },
];

/** Historical names (not the "Sardar 5"s a realm makes up when it runs short). */
const FAMOUS = new Set(Object.values(GENERALS).flat().map(([n]) => n));

/**
 * A character has died. Rulers leave a succession (and sometimes a broken realm) behind; famous
 * commanders leave empty barracks and shaken provinces.
 */
export function characterDied(s: GameState, g: General, owner: number, how: 'battle' | 'age') {
  if (g.isPlayer || owner === IND) return;
  if (s.rulers[owner] === g) {
    succession(s, owner, g, how);
    return;
  }
  if (!FAMOUS.has(g.name)) return;
  // A great captain falls: his retainers go home, and his country mourns.
  const k = 0.06 + 0.03 * generalRank(g);
  s.manpower[owner] = Math.round(s.manpower[owner] * (1 - k));
  const home = s.armies.find((a) => a.general === g);
  for (const p of provincesOf(s, owner)) if (!home || dist(p, home) < 300) p.unrest = Math.min(100, p.unrest + 4);
  const mine = owner === PLAYER;
  log(s, `The death of ${g.name} is a heavy blow to the ${s.factions[owner].short}: ${Math.round(k * 100)}% of their fighting men go home to mourn him.`, mine || s.war[PLAYER][owner]);
  if (mine) for (const x of s.armies) if (x.owner === PLAYER && !x.general.isPlayer) x.general.loyalty = Math.max(0, x.general.loyalty - 5);
}

function succession(s: GameState, f: number, dead: General, how: 'battle' | 'age') {
  const fac = s.factions[f];
  const big = provincesOf(s, f).length >= 8;
  // The heir: the next in line who still lives, found among the realm's commanders if he is one of them.
  const line = (HEIRS[fac.key] ?? []).filter(([n]) => n !== dead.name && !s.eventsDone.includes(`dead:${n}`));
  s.eventsDone.push(`dead:${dead.name}`);
  const [hn, hh] = line[0] ?? [s.officers[f][0]?.name ?? `${fac.short} heir`, s.officers[f][0]?.house ?? fac.short];
  const leading = s.armies.find((a) => a.owner === f && a.general.name === hn);
  const atCourt = s.officers[f].find((g) => g.name === hn);
  const heir = leading?.general ?? atCourt ?? makeGeneral(s.rng, hn, hh, 3);
  s.rulers[f] = heir;

  // A throne changes hands: nobles bargain, levies go home, the treasury is spent buying loyalty.
  const blow = how === 'battle' ? 0.45 : 0.25;
  s.manpower[f] = Math.round(s.manpower[f] * (1 - blow));
  s.gold[f] = Math.round(s.gold[f] * (how === 'battle' ? 0.6 : 0.8));
  const cap = s.provinces.find((p) => p.capitalOf === f && p.owner === f);
  for (const p of provincesOf(s, f)) {
    const far = cap ? dist(p, cap) > 420 : true;
    p.unrest = Math.min(100, p.unrest + (how === 'battle' ? 15 : 8) + (far ? 8 : 0));
  }
  const mine = f === PLAYER || s.war[PLAYER][f];
  const verb = how === 'battle' ? 'has fallen in battle' : 'is dead';
  log(s, `${dead.name} ${verb}! ${heir.name} takes the throne of the ${fac.name}.`, true);
  chronicle(s, 'event', `${dead.name} of the ${fac.name} ${verb}. ${heir.name} succeeded him.`);

  const broken: string[] = [];
  // The great empire comes apart: its governors make themselves nawabs.
  if (fac.key === 'mug' && (how === 'battle' || big)) broken.push(...raiseSuccessors(s, f));
  // Distant, restless provinces throw off the new ruler.
  if (big) {
    for (const p of provincesOf(s, f)) {
      if (p.capitalOf === f || p.siege || p.unrest < 55 || !s.rng.chance(how === 'battle' ? 0.5 : 0.25)) continue;
      const home = p.culture;
      const to = home !== f && s.factions[home]?.alive && home !== IND ? home : IND;
      p.owner = to;
      p.garrison = [newUnit('spear', 0.7), newUnit(to === IND ? 'paik' : s.factions[to].garrison[0], 0.8), newUnit('archer', 0.6)];
      p.unrest = 30;
      p.takenDay = s.day;
      p.tribute = null;
      broken.push(p.name);
    }
  }
  // Commanders who cared for the old master and not the new one go their own way.
  for (const a of s.armies) {
    if (a.owner !== f || a.general === heir || a.general.isPlayer) continue;
    if (s.rng.chance(how === 'battle' ? 0.18 : 0.08)) {
      a.owner = IND;
      a.goal = null;
      a.route = [];
      a.front = undefined;
      if (a.follows !== undefined) leaveBanner(s, a);
      broken.push(`${a.general.name}'s army`);
    }
  }
  if (broken.length) log(s, `The ${fac.short} realm is shaken: ${broken.slice(0, 6).join(', ')}${broken.length > 6 ? ` and ${broken.length - 6} more` : ''} break away.`, mine);
  // Your liege is dead: you owe the new one nothing yet, and his commanders waver.
  if (f === PLAYER && !s.realm) {
    for (const x of s.armies) if (x.owner === f && !x.general.isPlayer) x.general.loyalty = Math.max(0, x.general.loyalty - 12);
    log(s, `The Raje's commanders waver under ${heir.name}. If ever you meant to raise your own banner, men say, the time is now.`, true);
  }
  s.news = [...(s.news ?? []), {
    title: how === 'battle' ? `${dead.name} has fallen` : `The death of ${dead.name}`,
    text: `${dead.name} of the ${fac.name} ${verb}. ${heir.name} takes the throne. The realm loses ${Math.round(blow * 100)}% of its fighting men as the nobles bargain and the levies go home, and its provinces grow restless.${broken.length ? ` ${broken.length} provinces and armies break away: ${broken.slice(0, 8).join(', ')}${broken.length > 8 ? '…' : '.'}` : ''}`,
  }];
}

/** Mughal governors who make themselves nawabs of their provinces. */
function raiseSuccessors(s: GameState, mug: number): string[] {
  const out: string[] = [];
  s.risen = s.risen ?? [];
  for (const { key, regions } of SUCCESSORS) {
    if (s.risen.includes(key)) continue;
    const n = fid(key);
    const lands = s.provinces.filter((p) => p.owner === mug && regions.includes(p.region) && p.capitalOf !== mug && p.key !== 'delhi' && p.key !== 'agra');
    if (lands.length < 2) continue;
    s.risen.push(key);
    const F = s.factions[n];
    F.alive = true;
    for (const p of lands) {
      p.owner = n;
      p.takenDay = s.day;
      p.tribute = null;
      p.unrest = Math.max(0, p.unrest - 10);
    }
    const seat = lands.find((p) => p.key === F.capital) ?? lands.sort((a, b) => b.wealth - a.wealth)[0];
    seat.capitalOf = n;
    // The Mughal armies quartered in those lands go over to their governor.
    for (const a of s.armies) {
      if (a.owner !== mug || a.general === s.rulers[mug]) continue;
      if (lands.some((p) => p.id === provinceUnder(s, a, a.node))) {
        a.owner = n;
        a.front = undefined;
        a.goal = null;
        a.route = [];
        if (a.follows !== undefined) leaveBanner(s, a);
      }
    }
    if (!s.armies.some((a) => a.owner === n)) {
      const units = [newUnit('heavycav', 0.8), newUnit('spear', 0.9), newUnit('musket', 0.8), newUnit('archer', 0.8)];
      const g = s.officers[n].shift();
      const a = spawnAt(s, n, seat, units, g);
      a.aiNext = s.day + 5;
    }
    s.rulers[n] = s.armies.find((a) => a.owner === n)?.general ?? s.officers[n][0] ?? makeGeneral(s.rng, GENERALS[F.key][0][0], GENERALS[F.key][0][1], 4);
    s.manpower[n] = 900;
    s.gold[n] = 150;
    // They keep the peace with Delhi in name, but the Deccan nawabs inherit the Deccan wars.
    for (const o of s.factions) {
      if (o.id === n || o.id === IND) continue;
      s.relations[n][o.id] = s.relations[o.id][n] = o.id === mug ? -20 : Math.round(s.relations[mug][o.id] * 0.5);
      if (key === 'dec' && s.war[mug][o.id] && o.alive) {
        s.war[n][o.id] = s.war[o.id][n] = true;
        s.warSince[n][o.id] = s.warSince[o.id][n] = s.day;
      }
    }
    log(s, `The governors of ${regions[0]} proclaim themselves the ${F.name}, and ${lands.length} provinces with them no longer answer to Delhi!`, true);
    chronicle(s, 'event', `The ${F.name} rose from the Mughal provinces of ${regions.join(', ')}.`);
    out.push(`the ${F.name} (${lands.length} provinces)`);
  }
  return out;
}

function spawnAt(s: GameState, owner: number, p: Province, units: ReturnType<typeof newUnit>[], g?: General): Army {
  const a: Army = {
    id: s.nextArmyId++, owner, general: g ?? makeGeneral(s.rng, `Sardar ${s.nextArmyId}`, s.factions[owner].short, 2), units, x: p.x, y: p.y, node: p.id,
    route: [], goal: null, siegeOf: -1, raidUntil: 0, raidProv: -1, busyUntil: 0, safeUntil: 0, aiNext: s.day + 1, food: 30, scoutedUntil: 0, quarantineUntil: 0,
  };
  s.armies.push(a);
  return a;
}

/** Monthly: old sovereigns die when their time comes (a little before or after the year history gave them). */
export function mortalityMonthly(s: GameState) {
  const year = yearOf(s.day);
  for (const f of s.factions) {
    const r = s.rulers[f.id];
    if (!f.alive || !r) continue;
    const by = DIES_BY[r.name];
    if (by === undefined || year < by - 1) continue;
    if (s.rng.chance(year >= by ? 0.2 : 0.03)) {
      // A ruler in the field dies in his tent; his army passes to the next commander.
      const a = s.armies.find((x) => x.general === r);
      if (a) {
        const pool = s.officers[f.id];
        a.general = pool.length ? pool.shift()! : makeGeneral(s.rng, `Sardar ${s.nextArmyId}`, f.short, 2);
      }
      characterDied(s, r, f.id, 'age');
    }
  }
}
