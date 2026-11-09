import { dateLabel, type GameState, yearOf } from './state';

/**
 * The chronicle of the player's life, as a court bakhar-writer would keep it:
 * every battle, siege, conquest, raid, prisoner, bargain and promotion, with
 * the date and the place. Characters have heard of these deeds.
 */

export type ChronKind = 'battle' | 'defeat' | 'siege' | 'conquest' | 'raid' | 'diplomacy' | 'rank' | 'capture' | 'court' | 'escape' | 'event';

export interface ChronEntry {
  day: number;
  kind: ChronKind;
  text: string;
}

export const CHRON_ICON: Record<ChronKind, string> = {
  battle: '⚔', defeat: '☠', siege: '🏰', conquest: '🚩', raid: '🔥', diplomacy: '🤝', rank: '⭐', capture: '⛓', court: '👑', escape: '🏃', event: '📜',
};

export function chronicle(s: GameState, kind: ChronKind, text: string) {
  s.chronicle.push({ day: s.day, kind, text });
  if (s.chronicle.length > 600) s.chronicle.splice(0, s.chronicle.length - 600);
}

/** A tally of the player's deeds. */
export function deeds(s: GameState) {
  const c = s.chronicle;
  const n = (k: ChronKind) => c.filter((e) => e.kind === k).length;
  return { won: n('battle'), lost: n('defeat'), taken: n('conquest'), raids: n('raid'), prisoners: n('capture'), sieges: n('siege') };
}

/** What men say of the player: the latest notable deeds, for the characters. */
export function reputationLines(s: GameState, max = 5): string[] {
  return s.chronicle.filter((e) => e.kind !== 'court' && e.kind !== 'event').slice(-max).map((e) => `${dateLabel(e.day)}: ${e.text}`);
}

/** Entries grouped by year, newest year first. */
export function byYear(s: GameState): [number, ChronEntry[]][] {
  const m = new Map<number, ChronEntry[]>();
  for (const e of s.chronicle) {
    const y = yearOf(e.day);
    if (!m.has(y)) m.set(y, []);
    m.get(y)!.push(e);
  }
  return [...m].sort((a, b) => b[0] - a[0]);
}
