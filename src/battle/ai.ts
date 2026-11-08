import { isLarge, UNIT_STATS } from '../data';
import { type Battle, type BUnit, FIELD_H, FIELD_W } from './battle';

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

type Pt = { x: number; y: number };
const centroid = (list: BUnit[]): Pt => ({
  x: list.reduce((s, u) => s + u.x, 0) / list.length,
  y: list.reduce((s, u) => s + u.y, 0) / list.length,
});

/** Keeps a waypoint well inside the battlefield. */
const inField = (p: Pt): Pt => ({ x: Math.max(40, Math.min(FIELD_W - 40, p.x)), y: Math.max(40, Math.min(FIELD_H - 40, p.y)) });

/** Orders a move, going round by the nearest ford if a river lies in the way. */
function march(b: Battle, u: BUnit, dest: Pt) {
  const to = inField(dest);
  const via = b.fordRoute(u, to);
  if (!via.length) {
    u.order = { kind: 'move', x: to.x, y: to.y };
    return;
  }
  // Keep a march already under way rather than restarting it every replan.
  if (u.order.kind === 'path' && u.order.i < u.order.pts.length) {
    const last = u.order.pts[u.order.pts.length - 1];
    if (Math.hypot(last[0] - to.x, last[1] - to.y) < 40) return;
  }
  u.order = { kind: 'path', pts: [...via, [to.x, to.y]], i: 0 };
}

/** Attack a target, through a ford if a river lies between. */
function engage(b: Battle, u: BUnit, t: BUnit) {
  const via = b.fordRoute(u, t);
  if (via.length && dist(u, t) > 80) {
    if (u.order.kind === 'path' && u.order.then === t.id && u.order.i < u.order.pts.length) return;
    u.order = { kind: 'path', pts: via, i: 0, then: t.id };
  } else u.order = { kind: 'attack', target: t.id };
}

/** The best hill to defend near our own lines, if there is one. */
function defensiveHill(b: Battle, home: Pt, enemy: Pt): Pt | null {
  let best: Pt | null = null;
  let bs = 0;
  for (const h of b.hills) {
    const dHome = dist(h, home);
    // Worth it only if it is closer to us than to them and not a long march away.
    if (dHome > 360 || dist(h, enemy) < dHome) continue;
    const score = h.h * h.r / (1 + dHome / 200);
    if (score > bs) {
      bs = score;
      best = { x: h.x, y: h.y };
    }
  }
  return best;
}

/**
 * Field battle AI. The foot keep a line and advance together; a defender
 * takes the high ground and waits; missile troops shoot from behind the line;
 * horse wait on the wings, then ride around a flank along curving paths to hit
 * archers, guns and the rear of engaged regiments. Broken regiments fall back to rally.
 */
function planField(b: Battle, side: 0 | 1, mine: BUnit[], foes: BUnit[]) {
  const attacking = side === b.attacker;
  const myStr = strength(mine);
  const foeStr = strength(foes);
  const M = centroid(mine);
  const E = centroid(foes);
  let ax = E.x - M.x;
  let ay = E.y - M.y;
  const L = Math.hypot(ax, ay) || 1;
  ax /= L;
  ay /= L;
  const px = -ay; // lateral axis along our front
  const py = ax;
  const lateral = (p: Pt, o: Pt) => (p.x - o.x) * px + (p.y - o.y) * py;
  const nearestGap = Math.min(...foes.map((f) => Math.min(...mine.map((m) => dist(m, f)))));
  const foesEngaged = foes.filter((f) => f.fighting).length;

  // A defender (or a much weaker side with time on its hands) holds good ground and lets the enemy come.
  const patient = !attacking && b.time < 360 && nearestGap > 200 && myStr < foeStr * 1.4;
  const cls = (u: BUnit) => UNIT_STATS[u.type].cls;
  const role = (u: BUnit) => UNIT_STATS[u.type].role;

  // Broken regiments fall back behind the line to recover their nerve.
  const shaken = (u: BUnit) => !u.fighting && u.morale < u.maxMorale * 0.3;
  for (const u of mine) if (shaken(u)) march(b, u, { x: M.x - ax * 120, y: M.y - ay * 120 });

  // The commander's regiment stays behind the line: losing him would shake the whole army.
  const general = mine.length > 3 ? mine.find((u) => u.id === b.generalIds[side]) : undefined;
  if (general && !shaken(general)) {
    const threat = closest(general, foes);
    if (threat && dist(general, threat) < 140) engage(b, general, threat);
    else march(b, general, { x: M.x - ax * 130, y: M.y - ay * 130 });
  }
  const free = (u: BUnit) => u !== general && !shaken(u);
  const line = mine.filter((u) => free(u) && (cls(u) === 'infantry' || cls(u) === 'elephant'));
  const shooters = mine.filter((u) => free(u) && cls(u) === 'missile');
  const horse = mine.filter((u) => free(u) && cls(u) === 'cavalry');
  const guns = mine.filter((u) => cls(u) === 'artillery');

  // Endgame: with the main lines gone, or nothing happening, the survivors close in and finish it.
  const idle = foesEngaged === 0 && !mine.some((u) => u.fighting);
  if (!line.length || (idle && b.time > 420)) {
    for (const u of mine) {
      if (shaken(u) || cls(u) === 'artillery') continue;
      const t = closest(u, foes);
      if (t) engage(b, u, t);
    }
    return;
  }

  // ---- where the line should stand
  let anchor: Pt;
  if (patient) {
    anchor = defensiveHill(b, M, E) ?? M;
  } else {
    // Advance as one body: the anchor moves toward the enemy no faster than the slowest regiment.
    const lc = line.length ? centroid(line) : M;
    const slow = Math.min(...(line.length ? line : mine).map((u) => UNIT_STATS[u.type].speed));
    const stopShort = Math.max(0, dist(lc, E) - 110);
    const step = Math.min(stopShort, slow * 2.2);
    anchor = { x: lc.x + ax * step, y: lc.y + ay * step };
  }

  // ---- the line: keep left-to-right order, close up, engage what is in front
  const ordered = [...line].sort((a, c) => lateral(a, M) - lateral(c, M));
  const gap = 60;
  ordered.forEach((u, k) => {
    const off = (k - (ordered.length - 1) / 2) * gap;
    const slot = { x: anchor.x + px * off, y: anchor.y + py * off };
    // Enemies close in front of this regiment: go for the one most directly ahead.
    const near = foes.filter((f) => dist(u, f) < (patient ? 150 : 190));
    if (near.length || u.fighting) {
      const t = closest(u, near.length ? near : foes, (e) => {
        let w = 1 + Math.abs(lateral(e, u)) / 120;
        if (role(u) === 'pike' && isLarge(e.type)) w *= 0.6;
        if (role(u) === 'beast' && cls(e) === 'infantry') w *= 0.7;
        if (b.inRiver(e)) w *= 0.7; // catch them in the water
        return w;
      });
      if (t) {
        engage(b, u, t);
        return;
      }
    }
    if (patient && dist(u, slot) < 25) u.order = { kind: 'hold' };
    else march(b, u, slot);
  });

  // ---- missile troops: a step behind the line, shooting what they can reach
  shooters.forEach((u, k) => {
    const st = UNIT_STATS[u.type];
    const meleeThreat = closest(u, foes.filter((f) => UNIT_STATS[f.type].range === 0));
    if (meleeThreat && dist(u, meleeThreat) < 90 && st.weapon !== 'gun' && !u.fighting) {
      march(b, u, { x: u.x - ax * 90, y: u.y - ay * 90 });
      return;
    }
    const inRange = foes.filter((f) => dist(u, f) <= st.range * b.rangeMod(u));
    if (inRange.length) {
      const t = closest(u, inRange, (e) => (st.weapon === 'rocket' || st.weapon === 'gun') && cls(e) === 'elephant' ? 0.4
        : st.weapon === 'rocket' && isLarge(e.type) ? 0.6 : b.inRiver(e) ? 0.7 : 1);
      if (t) {
        u.order = { kind: 'attack', target: t.id };
        return;
      }
    }
    const off = (k - (shooters.length - 1) / 2) * 62;
    march(b, u, { x: anchor.x - ax * 70 + px * off, y: anchor.y - ay * 70 + py * off });
  });

  // ---- guns: stay back and shoot, edging forward when nothing is in range
  for (const u of guns) {
    const st = UNIT_STATS[u.type];
    const t = closest(u, foes.filter((f) => dist(u, f) <= st.range));
    u.order = t ? { kind: 'attack', target: t.id } : attacking ? { kind: 'move', x: u.x + ax * 40, y: u.y + ay * 40 } : { kind: 'hold' };
  }

  // ---- horse: wings first, then sweeping flank attacks along curved paths
  const lineHalf = ((ordered.length - 1) / 2) * gap + 90;
  const enemyHalf = Math.max(120, Math.max(...foes.map((f) => Math.abs(lateral(f, E)))));
  horse.forEach((u, k) => {
    const st = UNIT_STATS[u.type];
    const wing = lateral(u, M) >= 0 ? 1 : -1;
    // Keep a flank attack that is already under way.
    if (u.order.kind === 'path' && u.order.then !== undefined && u.order.i < u.order.pts.length) {
      const t = b.get(u.order.then);
      if (t && t.state === 'ok') return;
    }
    if (u.fighting) return;
    if (st.role === 'skirmish') {
      const t = closest(u, foes, (e) => (e.morale < e.maxMorale * 0.4 ? 0.5 : 1));
      if (t) u.order = { kind: 'attack', target: t.id };
      return;
    }
    // Soft targets (archers, guns) or the backs of regiments already locked in combat.
    const soft = foes.filter((f) => cls(f) === 'missile' || cls(f) === 'artillery');
    const backs = foes.filter((f) => f.fighting && cls(f) !== 'cavalry' && role(f) !== 'pike');
    const ready = st.role === 'raider' ? soft.length > 0 || foesEngaged > 0 : foesEngaged > 0 || nearestGap < 160 || b.time > 120;
    const enemyHorse = foes.filter((f) => cls(f) === 'cavalry' && dist(f, M) < 260);
    if (enemyHorse.length && (st.role === 'shock' || patient)) {
      // Meet their horse before it reaches our archers.
      const t = closest(u, enemyHorse);
      if (t) engage(b, u, t);
      return;
    }
    if (!ready || patient) {
      const off = wing * (lineHalf + 50 + Math.floor(k / 2) * 55);
      march(b, u, { x: anchor.x + px * off, y: anchor.y + py * off });
      return;
    }
    const pool = st.role === 'raider' ? (soft.length ? soft : backs) : (backs.length ? backs : soft);
    const t = closest(u, pool.length ? pool : foes, (e) => (role(e) === 'pike' ? 3 : 1) * (1 + Math.abs(lateral(e, E) - wing * enemyHalf) / 400));
    if (!t) return;
    // Ride wide round the enemy's flank, then in from the side or rear.
    const out = inField({ x: E.x + px * wing * (enemyHalf + 170), y: E.y + py * wing * (enemyHalf + 170) });
    const behind = inField({ x: t.x + ax * 110 + px * wing * 60, y: t.y + ay * 110 + py * wing * 60 });
    const pts: [number, number][] = [];
    for (const p of [out, behind]) {
      const via = b.fordRoute(pts.length ? { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] } : u, p);
      pts.push(...via, [Math.max(30, Math.min(FIELD_W - 30, p.x)), p.y]);
    }
    if (dist(u, t) < 140) engage(b, u, t);
    else u.order = { kind: 'path', pts, i: 0, then: t.id };
  });
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
