import { isLarge, UNIT_STATS } from '../data';
import { type Battle, type BUnit, FIELD_W } from './battle';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function closest(u: BUnit, list: BUnit[], weight: (e: BUnit) => number = () => 1): BUnit | null {
  let best: BUnit | null = null;
  let bd = Infinity;
  for (const e of list) {
    const d = dist(u, e) * weight(e);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

const strength = (list: BUnit[]) => list.reduce((s, u) => s + u.men * UNIT_STATS[u.type].value, 0);

/** Re-plans orders for one side. Called every second or two of battle time. */
export function planSide(b: Battle, side: 0 | 1) {
  const mine = b.units.filter((u) => u.side === side && u.state === 'ok' && !u.climbing);
  const foes = b.units.filter((u) => u.side !== side && u.state === 'ok');
  if (!foes.length || !mine.length) return;
  if (b.walls) {
    if (side === b.attacker) planSiegeAttack(b, mine, foes);
    else planSiegeDefense(b, mine, foes);
  } else {
    planField(b, side, mine, foes);
  }
}

function planField(b: Battle, side: 0 | 1, mine: BUnit[], foes: BUnit[]) {
  const attacking = side === b.attacker;
  const weaker = strength(mine) < strength(foes) * 0.9;
  // A weaker defender waits for the enemy to come to it, unless it is being shot to pieces.
  const nearest = Math.min(...foes.map((f) => Math.min(...mine.map((m) => dist(m, f)))));
  const patient = !attacking && weaker && nearest > 230 && b.time < 240;

  for (const u of mine) {
    const st = UNIT_STATS[u.type];
    const near = closest(u, foes)!;
    const dN = dist(u, near);
    if (st.cls === 'artillery') {
      u.order = { kind: 'hold' };
      continue;
    }
    if (st.cls === 'missile') {
      const meleeClose = closest(u, foes.filter((f) => UNIT_STATS[f.type].range === 0));
      if (meleeClose && dist(u, meleeClose) < 90 && st.weapon !== 'gun') {
        // Fall back from charging enemies toward friends.
        const d = Math.max(1, dist(u, meleeClose));
        u.order = { kind: 'move', x: u.x + ((u.x - meleeClose.x) / d) * 90, y: u.y + ((u.y - meleeClose.y) / d) * 90 };
      } else if (dN <= st.range * 0.95 || patient) {
        const pref = st.weapon === 'rocket' ? closest(u, foes, (e) => (isLarge(e.type) ? 0.5 : 1)) : near;
        u.order = pref && dist(u, pref) <= st.range ? { kind: 'attack', target: pref.id } : { kind: 'hold' };
      } else {
        const k = (st.range * 0.85) / dN;
        u.order = { kind: 'move', x: near.x + (u.x - near.x) * k, y: near.y + (u.y - near.y) * k };
      }
      continue;
    }
    if (patient && dN > 200) {
      u.order = { kind: 'hold' };
      continue;
    }
    let t: BUnit | null;
    const role = (e: BUnit) => UNIT_STATS[e.type].role;
    const ecls = (e: BUnit) => UNIT_STATS[e.type].cls;
    if (st.role === 'pike') {
      t = closest(u, foes, (e) => (isLarge(e.type) ? 0.6 : 1));
    } else if (st.role === 'raider') {
      t = closest(u, foes, (e) => (ecls(e) === 'missile' || ecls(e) === 'artillery' ? 0.45 : role(e) === 'pike' ? 2.5 : 1.2));
    } else if (st.role === 'shock') {
      t = closest(u, foes, (e) => (role(e) === 'pike' ? 2.5 : ecls(e) === 'elephant' ? 2 : ecls(e) === 'missile' ? 0.7 : 1));
    } else if (st.role === 'skirmish') {
      t = closest(u, foes, (e) => (e.state === 'ok' && e.morale < e.maxMorale * 0.4 ? 0.5 : 1));
    } else if (st.role === 'beast') {
      t = closest(u, foes, (e) => (ecls(e) === 'infantry' ? 0.7 : UNIT_STATS[e.type].weapon === 'gun' || UNIT_STATS[e.type].weapon === 'rocket' ? 1.6 : 1));
    } else {
      t = closest(u, foes, (e) => (UNIT_STATS[e.type].cls === 'missile' ? 0.8 : 1));
    }
    if (t) u.order = { kind: 'attack', target: t.id };
  }
}

function planSiegeAttack(b: Battle, mine: BUnit[], foes: BUnit[]) {
  const W = b.walls!;
  const gateIdx = W.segs.findIndex((s) => s.gate);
  const gateUp = W.segs[gateIdx].hp > 0;
  const anyGap = W.segs.some((s) => s.hp <= 0);
  const inside = foes.filter((f) => b.region(f.y) !== 'out');
  const outside = foes.filter((f) => b.region(f.y) === 'out');
  const plazaGoal = { kind: 'move' as const, x: W.plaza.x, y: W.plaza.y };

  // Target for guns: the gate, else the nearest standing wall section.
  let gunSeg = gateIdx;
  if (!gateUp) {
    let bd = Infinity;
    W.segs.forEach((s, i) => {
      const d = Math.abs((s.x0 + s.x1) / 2 - FIELD_W / 2);
      if (s.hp > 0 && d < bd && d > 1) {
        bd = d;
        gunSeg = i;
      }
    });
  }

  for (const u of mine) {
    const st = UNIT_STATS[u.type];
    const near = closest(u, foes)!;
    if (outside.length && dist(u, closest(u, outside)!) < 160) {
      u.order = { kind: 'attack', target: closest(u, outside)!.id };
      continue;
    }
    if (st.cls === 'artillery') {
      // Once there is a way in, the guns turn on the defenders.
      u.order = anyGap ? { kind: 'hold' } : { kind: 'breach', seg: gunSeg };
      continue;
    }
    if (st.cls === 'missile') {
      // Stand off below the walls and shoot the defenders on them.
      const d = dist(u, near);
      if (d <= st.range * 0.9) u.order = { kind: 'attack', target: near.id };
      else u.order = { kind: 'move', x: Math.max(60, Math.min(FIELD_W - 60, near.x + (u.x - near.x) * 0.4)), y: W.y + W.t + st.range * 0.6 };
      continue;
    }
    const inWalls = b.region(u.y) !== 'out';
    if (inWalls || anyGap) {
      const t = inside.length ? closest(u, inside) : null;
      u.order = t && dist(u, t) < 220 ? { kind: 'attack', target: t.id } : plazaGoal;
      continue;
    }
    if (st.cls === 'elephant' || (b.opts.ram && st.cls === 'infantry' && st.climb < 2)) {
      u.order = { kind: 'breach', seg: gateIdx };
      continue;
    }
    if (st.cls === 'infantry' && b.opts.ladders) {
      u.order = plazaGoal; // route() sends them up the ladders
      continue;
    }
    if (st.cls === 'infantry') {
      u.order = { kind: 'breach', seg: gateIdx };
      continue;
    }
    // Horse waits out of bowshot until there is a way in.
    u.order = { kind: 'move', x: u.x, y: Math.max(u.y, W.y + W.t + 300) };
  }
}

function planSiegeDefense(b: Battle, mine: BUnit[], foes: BUnit[]) {
  const W = b.walls!;
  const breached = foes.filter((f) => b.region(f.y) !== 'out' || f.climbing);
  const threatened = W.capture > 0;
  for (const u of mine) {
    const st = UNIT_STATS[u.type];
    if (st.cls === 'missile' || st.cls === 'artillery') {
      const t = closest(u, foes);
      u.order = t && dist(u, t) <= st.range * b.rangeMod(u) ? { kind: 'attack', target: t.id } : { kind: 'hold' };
      continue;
    }
    if (breached.length) {
      const t = closest(u, breached, (e) => (dist(e, W.plaza) < W.plaza.r * 1.5 ? 0.5 : 1));
      if (t) {
        u.order = { kind: 'attack', target: t.id };
        continue;
      }
    }
    if (threatened) {
      u.order = { kind: 'move', x: W.plaza.x + (u.x - W.plaza.x) * 0.3, y: W.plaza.y };
      continue;
    }
    u.order = { kind: 'hold' };
  }
}
