/**
 * Historical battles, fought on their own from the start menu: the armies, regiments,
 * commanders and formations as the sources describe them, scaled down to the game's
 * regiments. The player may re-form the Maratha regiments before sounding the attack.
 */
import { app } from './app';
import { BattleScene } from './battle/scene';
import type { Spot } from './battle/battle';
import { type Reg, type Scenario, SCENARIOS } from './historical-data';
import { type CUnit, type Faction, newUnit } from './campaign/state';
import { h, hideModal, showModal } from './ui';

function units(regs: Reg[]): { units: CUnit[]; spots: Spot[] } {
  return {
    units: regs.map(([type, label]) => ({ ...newUnit(type), label })),
    spots: regs.map(([, , x, y, face]) => ({ x, y, face })),
  };
}

/** Fights one historical battle, then calls `back` (to show the list again). */
export function fightHistorical(sc: Scenario, marathas: Faction, back: () => void) {
  const returnTo = app.scene;
  const mine = units(sc.mine);
  const theirs = units(sc.theirs);
  const enemy: Faction = { ...marathas, id: 99, name: sc.enemyName, short: sc.enemyShort, color: sc.enemyColor, rgb: sc.enemyRgb };
  const peshwa: Faction = { ...marathas, name: 'Maratha Empire (the Peshwa)', short: 'Marathas' };
  app.setScene(new BattleScene({
    mode: 'field', playerUnits: mine.units, enemyUnits: theirs.units, playerAttacks: sc.playerAttacks,
    title: `${sc.title}, ${sc.date}`, seed: sc.id.length * 7919 + 1728, terrain: 'plains', rain: false,
    walls: 0, ladders: false, ram: false, place: sc.place.split(',')[0],
    playerGeneral: sc.playerGeneral, enemyGeneral: sc.enemyGeneral, playerFaction: peshwa, enemyFaction: enemy,
    leaders: sc.leaders, leaderNotes: sc.leaderNotes,
    placement: [mine.spots, theirs.spots], zone0: sc.zone0, thirst: sc.thirst, generals: sc.generals,
    doneLabel: 'What really happened',
    onDone: (won, draw) => {
      if (returnTo) app.setScene(returnTo);
      showModal(`${sc.title}: the history`, h('div', {},
        h('p', {}, draw ? 'Your battle ended in a draw.' : won ? 'You won the battle, as Bajirao did.' : 'You lost the battle that Bajirao won.'),
        h('p', {}, sc.history),
      ), [{ label: 'Back to the historical battles', primary: true, onClick: () => { hideModal(); back(); } }]);
    },
  }));
}

/** The list of historical battles. */
export function showHistorical(marathas: Faction, back: () => void) {
  const again = () => showHistorical(marathas, back);
  showModal('Historical battles', h('div', {},
    h('p', { class: 'muted' }, 'Fight the great battles of the Marathas with the armies that fought them, scaled to the game\'s regiments. Your regiments start where they stood. Before you begin you may re-form them: select regiments and right-click to move them, or right-drag to draw a new line. Then press Space or Begin.'),
    ...SCENARIOS.map((sc) => h('div', { class: 'card', style: 'margin:10px 0' },
      h('h3', {}, `${sc.title}`),
      h('div', { class: 'muted' }, `${sc.date} · ${sc.place} · ${sc.playerGeneral} against ${sc.enemyGeneral}`),
      ...sc.brief.map((p) => h('p', {}, p)),
      h('p', {}, h('b', {}, 'Marathas: '), sc.marathas),
      h('p', {}, h('b', {}, `${sc.enemyShort}: `), sc.enemy),
      h('div', { class: 'btns' }, h('button', {
        class: 'primary', onclick: () => { hideModal(); fightHistorical(sc, marathas, again); },
      }, `⚔ Fight as ${sc.playerGeneral}`)),
    )),
  ), [{ label: 'Back', onClick: () => { hideModal(); back(); } }], { wide: true });
}
