import { runAiTurn, type Controller } from './ai';
import {
  type Army, armyAt, autoResolve, autoResolveSiege, capture, cleanupArmies, type CUnit, endRound, type GameState,
  hostile, IND, liftSiege, log, MAX_UNITS, PLAYER, type Province, retreat, sack, startSiege,
} from './state';

/** Decisions that need the player (battles they are in, what to do with a captured town). */
export interface Hooks {
  fieldBattle(att: Army, defUnits: CUnit[], defOwner: number, p: Province): Promise<boolean>;
  siegeBattle(att: Army, p: Province): Promise<boolean>;
  chooseSack(p: Province): Promise<boolean>;
  /** Called whenever the map should redraw (ownership or armies changed). */
  changed(): void;
}

/** Auto-resolves everything: used for AI-vs-AI fights and headless tests. */
export const autoHooks = (s: GameState): Hooks => ({
  fieldBattle: async (att, def) => autoResolve(s, att.units, def),
  siegeBattle: async (att, p) => autoResolveSiege(s, att.units, p),
  chooseSack: async (p) => p.wealth >= 8,
  changed: () => {},
});

/** Campaign rules for moving, fighting, besieging and taking settlements. */
export class Flow implements Controller {
  state: GameState;
  hooks: Hooks;

  constructor(state: GameState, hooks: Hooks) {
    this.state = state;
    this.hooks = hooks;
  }

  private alive(a: Army) {
    return this.state.armies.includes(a);
  }

  private involvesPlayer(a: number, b: number) {
    return a === PLAYER || b === PLAYER;
  }

  async moveArmy(army: Army, target: number): Promise<void> {
    const s = this.state;
    const from = s.provinces[army.province];
    const to = s.provinces[target];
    if (army.mp <= 0 || !from.neighbors.includes(target)) return;
    const occ = armyAt(s, target);

    if (occ && occ.owner === army.owner) {
      if (occ.units.length + army.units.length > MAX_UNITS) {
        if (army.owner === PLAYER) log(s, `Can't merge: an army holds at most ${MAX_UNITS} regiments.`, true);
        return;
      }
      if (army.siegeOf >= 0) liftSiege(s, s.provinces[army.siegeOf]);
      occ.units.push(...army.units);
      occ.mp = Math.min(occ.mp, army.mp - 1);
      s.armies = s.armies.filter((a) => a !== army);
      this.hooks.changed();
      return;
    }
    if (occ && !hostile(s, army.owner, occ.owner)) return;
    if (!occ && to.owner !== army.owner && !hostile(s, army.owner, to.owner)) return;

    if (army.siegeOf >= 0) liftSiege(s, s.provinces[army.siegeOf]);
    army.mp -= 1;

    if (occ) {
      const won = this.involvesPlayer(army.owner, occ.owner)
        ? await this.hooks.fieldBattle(army, occ.units, occ.owner, to)
        : autoResolve(s, army.units, occ.units);
      const f = s.factions;
      if (!this.involvesPlayer(army.owner, occ.owner)) {
        log(s, won ? `The ${f[army.owner].short} defeat the ${f[occ.owner].short} at ${to.name}.` : `The ${f[army.owner].short} are repulsed at ${to.name}.`);
      }
      cleanupArmies(s);
      this.hooks.changed();
      if (!won || !this.alive(army)) return;
      if (this.alive(occ)) retreat(s, occ);
    }

    army.province = target;
    this.hooks.changed();
    if (to.owner === army.owner) return;
    army.mp = 0;

    // Enemy land: take the settlement, by storm if it is open, by siege if it is walled.
    if (to.walls > 0 && to.garrison.length > 0) {
      startSiege(s, army, to);
      this.hooks.changed();
      return;
    }
    if (to.garrison.length > 0) {
      const won = this.involvesPlayer(army.owner, to.owner)
        ? await this.hooks.fieldBattle(army, to.garrison, to.owner, to)
        : autoResolve(s, army.units, to.garrison);
      cleanupArmies(s);
      if (!won || !this.alive(army)) {
        if (this.alive(army)) army.province = from.id;
        this.hooks.changed();
        return;
      }
    }
    await this.takeSettlement(army.owner, to);
  }

  async assault(army: Army, p: Province): Promise<void> {
    const s = this.state;
    if (!p.siege || army.siegeOf !== p.id || p.siege.lastAssault === s.turn) return;
    p.siege.lastAssault = s.turn;
    army.mp = 0;
    const won = this.involvesPlayer(army.owner, p.owner)
      ? await this.hooks.siegeBattle(army, p)
      : autoResolveSiege(s, army.units, p);
    if (!this.involvesPlayer(army.owner, p.owner)) {
      log(s, won ? `The ${s.factions[army.owner].short} storm ${p.town}.` : `An assault on ${p.town} is thrown back.`);
    }
    cleanupArmies(s);
    if (won && this.alive(army)) await this.takeSettlement(army.owner, p);
    else if (!this.alive(army)) liftSiege(s, p);
    this.hooks.changed();
  }

  async takeSettlement(owner: number, p: Province) {
    const s = this.state;
    const sackIt = owner === PLAYER ? await this.hooks.chooseSack(p) : owner !== IND && p.owner === PLAYER && s.rng.chance(0.3);
    capture(s, p, owner);
    if (sackIt) sack(s, p, owner);
    this.hooks.changed();
  }

  /** Everyone else moves, then the round ends (sieges, income, seasons). */
  async endTurn() {
    const s = this.state;
    for (let f = 1; f < s.factions.length; f++) {
      if (s.over) return;
      await runAiTurn(this, f);
    }
    if (s.over) return;
    const events = endRound(s);
    for (const e of events) {
      if (e.province.owner !== e.by) await this.takeSettlement(e.by, e.province);
    }
    this.hooks.changed();
  }
}
