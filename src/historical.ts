/**
 * Historical battles, fought on their own from the start menu: the armies, regiments,
 * commanders and formations as the sources describe them, scaled down to the game's
 * regiments. Fight either side; you may re-form your regiments before the battle begins.
 */
import { app } from './app';
import { BattleScene } from './battle/scene';
import { historicalSetup, type Scenario, SCENARIOS } from './historical-data';
import type { Faction } from './campaign/state';
import { h, hideModal, showModal } from './ui';

/** The two sides' names: the first side's commander and the second's. */
export const sideNames = (sc: Scenario): [string, string] => [sc.ourShort ?? 'Marathas', sc.enemyShort];

/** Fights one historical battle as side 0 (the first) or 1 (the second), then calls `back`. */
export function fightHistorical(sc: Scenario, side: 0 | 1, marathas: Faction, back: () => void) {
  const returnTo = app.scene;
  const flip = side === 1;
  const first: Faction = { ...marathas, id: 98, name: sc.ourName ?? 'Maratha Empire (the Peshwa)', short: sc.ourShort ?? 'Marathas',
    color: sc.ourColor ?? marathas.color, rgb: sc.ourRgb ?? marathas.rgb };
  const second: Faction = { ...marathas, id: 99, name: sc.enemyName, short: sc.enemyShort, color: sc.enemyColor, rgb: sc.enemyRgb };
  const names = sideNames(sc);
  app.setScene(new BattleScene({
    ...historicalSetup(sc, side),
    mode: 'field', title: `${sc.title}, ${sc.date}`, seed: sc.id.length * 7919 + 1728, terrain: sc.terrain ?? 'plains', rain: false,
    walls: 0, ladders: false, ram: false, place: '', // the real place names are written on the map itself
    playerGeneral: flip ? sc.enemyGeneral : sc.playerGeneral, enemyGeneral: flip ? sc.playerGeneral : sc.enemyGeneral,
    playerFaction: flip ? second : first, enemyFaction: flip ? first : second,
    doneLabel: 'What really happened',
    onDone: (won, draw) => {
      if (returnTo) app.setScene(returnTo);
      const me = names[side];
      const victor = names[sc.winner];
      const line = draw ? 'Your battle ended in a draw.'
        : won ? (side === sc.winner ? `You won, as the ${victor} did.` : `You won as the ${me}, and changed history: the ${victor} won this battle.`)
        : (side === sc.winner ? `You lost the battle the ${victor} won.` : `You lost, as the ${me} did.`);
      showModal(`${sc.title}: the history`, h('div', {},
        h('p', {}, line),
        h('p', {}, sc.history),
      ), [{ label: 'Back to the historical battles', primary: true, onClick: () => { hideModal(); back(); } }]);
    },
  }));
}

/** The commander's name after a side, unless it only repeats the side ("the Muslims of Medina"). */
const who = (general: string) => (general.startsWith('the ') ? '' : ` (${general})`);

/** The list of historical battles. */
export function showHistorical(marathas: Faction, back: () => void) {
  const again = () => showHistorical(marathas, back);
  showModal('Historical battles', h('div', {},
    h('p', { class: 'muted' }, 'Fight great battles of history with the armies that fought them, scaled to the game\'s regiments, on either side. Your regiments start where they stood. Before you begin you may re-form them: select regiments and right-click to move them, or right-drag to draw a new line. Then press Space or Begin.'),
    ...SCENARIOS.map((sc) => {
      const [n0, n1] = sideNames(sc);
      return h('div', { class: 'card', style: 'margin:10px 0' },
        h('h3', {}, `${sc.title}`),
        h('div', { class: 'muted' }, `${sc.date} · ${sc.place} · ${sc.playerGeneral} against ${sc.enemyGeneral}`),
        ...sc.brief.map((p) => h('p', {}, p)),
        h('p', {}, h('b', {}, `${n0}: `), sc.marathas),
        h('p', {}, h('b', {}, `${n1}: `), sc.enemy),
        sc.tactics ? h('details', {},
          h('summary', {}, 'How each side fought (the computer fights its side the same way)'),
          ...([0, 1] as const).map((k) => h('p', {}, h('b', {}, `${[n0, n1][k]}: `), sc.tactics![k].map((t) => t.note).join('; ') + '.'))) : '',
        h('div', { class: 'btns' },
          h('button', { class: 'primary', onclick: () => { hideModal(); fightHistorical(sc, 0, marathas, again); } }, `⚔ Fight as the ${n0}${who(sc.playerGeneral)}`),
          h('button', { onclick: () => { hideModal(); fightHistorical(sc, 1, marathas, again); } }, `⚔ Fight as the ${n1}${who(sc.enemyGeneral)}`)),
      );
    }),
  ), [{ label: 'Back', onClick: () => { hideModal(); back(); } }], { wide: true });
}
