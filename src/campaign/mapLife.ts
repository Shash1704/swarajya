/**
 * The life of the 3D campaign map, as in Bannerlord's world map: forests of single
 * trees, walled towns, hill forts and villages in detail, each with its owner's flag;
 * lamps in the towns at night; clouds drifting over the land; and the light of the day turning to dusk and night.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { CELL, MH, MW, WH, WW } from '../geo';
import { SEA } from './mapgen';
import type { GameState } from './state';

export const toX = (x: number) => x - WW / 2;
export const toZ = (y: number) => WH / 2 - y;

/** One mesh drawn many times, each with its own place, turn, size (and colour). */
export class Many {
  private mats = new Float32Array(16 * 64);
  private cols: Float32Array | null;
  private n = 0;
  private m = new Matrix();
  private q = new Quaternion();
  private sv = new Vector3();
  private tv = new Vector3();
  constructor(readonly mesh: Mesh, coloured: boolean) {
    this.cols = coloured ? new Float32Array(4 * 64) : null;
    mesh.thinInstanceSetBuffer('matrix', this.mats, 16, false);
    if (this.cols) mesh.thinInstanceSetBuffer('color', this.cols, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.alwaysSelectAsActiveMesh = true;
  }
  begin() {
    this.n = 0;
  }
  add(x: number, y: number, z: number, yaw: number, s: [number, number, number], col?: [number, number, number], tilt = 0) {
    if ((this.n + 1) * 16 > this.mats.length) {
      const m = new Float32Array(this.mats.length * 2);
      m.set(this.mats);
      this.mats = m;
      this.mesh.thinInstanceSetBuffer('matrix', this.mats, 16, false);
      if (this.cols) {
        const c = new Float32Array(this.cols.length * 2);
        c.set(this.cols);
        this.cols = c;
        this.mesh.thinInstanceSetBuffer('color', this.cols, 4, false);
      }
    }
    Quaternion.RotationYawPitchRollToRef(yaw, tilt, 0, this.q);
    this.sv.set(s[0], s[1], s[2]);
    this.tv.set(x, y, z);
    Matrix.ComposeToRef(this.sv, this.q, this.tv, this.m);
    this.m.copyToArray(this.mats, this.n * 16);
    if (this.cols) {
      const c = col ?? [1, 1, 1];
      this.cols[this.n * 4] = c[0];
      this.cols[this.n * 4 + 1] = c[1];
      this.cols[this.n * 4 + 2] = c[2];
      this.cols[this.n * 4 + 3] = 1;
    }
    this.n++;
  }
  end() {
    this.mesh.thinInstanceCount = this.n;
    this.mesh.thinInstanceBufferUpdated('matrix');
    if (this.cols) this.mesh.thinInstanceBufferUpdated('color');
  }
}

type RGB = [number, number, number];
type Height = (x: number, y: number) => number;

/** A seeded random stream. */
const stream = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function material(scene: Scene, name: string, c: RGB, tex?: Texture, emissive = 0): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(c[0], c[1], c[2]);
  if (tex) m.diffuseTexture = tex;
  m.specularColor = new Color3(0.04, 0.04, 0.04);
  if (emissive) m.emissiveColor = new Color3(c[0] * emissive, c[1] * emissive, c[2] * emissive);
  return m;
}

// ---------------------------------------------------------------- forests

/** Single trees by the tens of thousands: jungle and woods where the land is wet, conifers in the hills, palms on the coasts, thorn scrub in the dry country. */
export function buildForests(scene: Scene, state: GameState, ground: Height) {
  const { elev, moist, prov, river } = state.map;
  const rand = stream(4242);
  const white = material(scene, 'treeWhite', [1, 1, 1]);
  const mk = (name: string, mesh: Mesh) => {
    mesh.material = white;
    return new Many(mesh, true);
  };
  const trunk = mk('tTrunk', CreateCylinder('tTrunk', { height: 1, diameterTop: 0.25, diameterBottom: 0.4, tessellation: 4 }, scene));
  const round = mk('tRound', CreateSphere('tRound', { diameter: 1, segments: 3 }, scene));
  const cone = mk('tCone', CreateCylinder('tCone', { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 6 }, scene));
  const fronds = mk('tFronds', CreateCylinder('tFronds', { height: 1, diameterTop: 1, diameterBottom: 0.1, tessellation: 5 }, scene));
  // Keep clearings round settlements and villages, so the fields and houses show.
  const blocked = new Uint8Array(MW * MH);
  const clear = (x: number, y: number, r: number) => {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const rc = Math.ceil(r / CELL);
    for (let dy = -rc; dy <= rc; dy++) {
      for (let dx = -rc; dx <= rc; dx++) {
        if (dx * dx + dy * dy > rc * rc) continue;
        const X = cx + dx;
        const Y = cy + dy;
        if (X >= 0 && Y >= 0 && X < MW && Y < MH) blocked[Y * MW + X] = 1;
      }
    }
  };
  for (const p of state.provinces) clear(p.x, p.y, 16 + p.wealth * 0.6);
  for (const v of state.villages) clear(v.x, v.y, 8);
  const nearSea = (cx: number, cy: number) => {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const X = cx + dx;
        const Y = cy + dy;
        if (X >= 0 && Y >= 0 && X < MW && Y < MH && prov[Y * MW + X] === SEA) return true;
      }
    }
    return false;
  };
  for (const m of [trunk, round, cone, fronds]) m.begin();
  for (let cy = 0; cy < MH; cy++) {
    for (let cx = 0; cx < MW; cx++) {
      const i = cy * MW + cx;
      const e = elev[i];
      if (prov[i] === SEA || e <= 0.02 || e > 0.8 || river[i] || blocked[i]) continue;
      const m = moist[i];
      // Thick forest in the wet country, a scatter of trees elsewhere.
      const dense = Math.max(0, Math.min(1, (m - 0.52) / 0.3));
      const chance = dense * 0.85 + (m > 0.32 ? 0.05 : 0.012);
      if (rand() > chance) continue;
      const x = (cx + rand()) * CELL;
      const y = (cy + rand()) * CELL;
      const Y = ground(x, y);
      const X = x - WW / 2;
      const Z = WH / 2 - y;
      const s = 0.8 + rand() * 0.6;
      const v = 0.8 + rand() * 0.35;
      if (e > 0.42) {
        // Deodar and pine on the high ground.
        trunk.add(X, Y + 0.5 * s, Z, 0, [s, s, s], [0.32, 0.24, 0.16]);
        cone.add(X, Y + 2.1 * s, Z, rand() * 6, [1.9 * s, 3.4 * s, 1.9 * s], [0.16 * v, 0.3 * v, 0.2 * v]);
      } else if (m > 0.45 && e < 0.12 && nearSea(cx, cy) && rand() < 0.7) {
        // Coconut palms along the coast.
        trunk.add(X, Y + 1.6 * s, Z, 0, [0.7 * s, 3.2 * s, 0.7 * s], [0.42, 0.34, 0.24], (rand() - 0.5) * 0.3);
        fronds.add(X, Y + 3.3 * s, Z, rand() * 6, [2.6 * s, 0.5 * s, 2.6 * s], [0.3 * v, 0.5 * v, 0.22 * v]);
      } else if (m < 0.36) {
        // Thorny babul and khejri in the dry country: low, flat crowns.
        trunk.add(X, Y + 0.6 * s, Z, 0, [0.8 * s, 1.2 * s, 0.8 * s], [0.38, 0.3, 0.2]);
        round.add(X, Y + 1.4 * s, Z, 0, [2.2 * s, 0.8 * s, 2.2 * s], [0.42 * v, 0.46 * v, 0.26 * v]);
      } else {
        // Banyan, teak and sal: big round crowns, darker in the jungle.
        const g = 0.36 - dense * 0.1;
        trunk.add(X, Y + 0.6 * s, Z, 0, [s, 1.2 * s, s], [0.34, 0.26, 0.18]);
        round.add(X, Y + 1.9 * s, Z, rand() * 6, [2.4 * s, 2 * s, 2.4 * s], [0.2 * v, (0.2 + g) * v, 0.14 * v]);
      }
    }
  }
  for (const m of [trunk, round, cone, fronds]) m.end();
}

// ---------------------------------------------------------------- settlements

export interface Settlements {
  /** Flags over every town and fort, in the owner's colours; and lamps in the towns at night. */
  update(t: number, color: (prov: number) => RGB, night: number): void;
}

/**
 * Towns behind their walls (houses with flat roofs and tiled ones, domes and minarets, a quay
 * and boats at a port), hill forts with bastions and a keep, and villages of thatched huts and
 * haystacks; a flag over each town and fort.
 */
export function buildSettlements(scene: Scene, state: GameState, ground: Height, waterY: number, tex: { stone: Texture; plaster: Texture }): Settlements {
  const rand = stream(7);
  const stone = material(scene, 'sStone', [1, 1, 1], tex.stone);
  const plaster = material(scene, 'sPlaster', [1, 1, 1], tex.plaster);
  const tinted = material(scene, 'sTinted', [1, 1, 1]);
  const mk = (mesh: Mesh, mat: StandardMaterial, coloured = false) => {
    mesh.material = mat;
    return new Many(mesh, coloured);
  };
  const wallSeg = mk(CreateBox('sWall', { size: 1 }, scene), stone);
  const tower = mk(CreateCylinder('sTower', { height: 1, diameter: 1, tessellation: 10 }, scene), stone);
  const towerCap = mk(CreateCylinder('sTowerCap', { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 10 }, scene), tinted, true);
  const keep = mk(CreateBox('sKeep', { size: 1 }, scene), stone);
  const house = mk(CreateBox('sHouse', { size: 1 }, scene), plaster, false);
  const flatRoof = mk(CreateBox('sFlatRoof', { size: 1 }, scene), tinted, true);
  const roof = mk(CreateCylinder('sRoof', { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 4 }, scene), tinted, true);
  const hut = mk(CreateCylinder('sHut', { height: 1, diameter: 1, tessellation: 8 }, scene), plaster);
  const thatch = mk(CreateCylinder('sThatch', { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 8 }, scene), tinted, true);
  const dome = mk(CreateSphere('sDome', { diameter: 1, segments: 8, slice: 0.5 }, scene), plaster);
  const drum = mk(CreateCylinder('sDrum', { height: 1, diameter: 1, tessellation: 12 }, scene), plaster);
  const minaret = mk(CreateCylinder('sMinaret', { height: 1, diameterTop: 0.6, diameterBottom: 1, tessellation: 8 }, scene), plaster);
  const quay = mk(CreateBox('sQuay', { size: 1 }, scene), tinted, true);
  const hull = mk(CreateBox('sHull', { size: 1 }, scene), tinted, true);
  const mast = mk(CreateCylinder('sMast', { height: 1, diameter: 1, tessellation: 4 }, scene), tinted, true);
  for (const m of [wallSeg, tower, towerCap, keep, house, flatRoof, roof, hut, thatch, dome, drum, minaret, quay, hull, mast]) m.begin();

  const TILE: RGB = [0.62, 0.32, 0.2];
  const THATCH: RGB = [0.72, 0.6, 0.36];
  const ROOFTOP: RGB = [0.86, 0.8, 0.68];
  const WOOD: RGB = [0.42, 0.3, 0.2];
  const lampSpots: [number, number, number][] = [];
  const flagSpots: { prov: number; x: number; y: number; z: number }[] = [];

  /** A ring of wall with towers, gated, of radius r about (X, Z). */
  const ring = (X: number, Z: number, Y: number, r: number, n: number, h: number, towersEvery: number) => {
    for (let k = 0; k < n; k++) {
      if (k === 0) continue; // the gate
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const len = 2 * r * Math.sin(Math.PI / n) + 0.2;
      const x = X + Math.cos(am) * r;
      const z = Z + Math.sin(am) * r;
      wallSeg.add(x, Y + h / 2, z, -am + Math.PI / 2, [len, h, 0.55]);
      if (k % towersEvery === 0) {
        const tx = X + Math.cos(a0) * r;
        const tz = Z + Math.sin(a0) * r;
        tower.add(tx, Y + h * 0.7, tz, 0, [1.3, h * 1.4, 1.3]);
        towerCap.add(tx, Y + h * 1.4 + 0.45, tz, 0, [1.5, 0.9, 1.5], [0.55, 0.32, 0.22]);
      }
    }
    // Gate towers either side of the opening.
    for (const a of [0, (1 / n) * Math.PI * 2]) {
      tower.add(X + Math.cos(a) * r, Y + h * 0.8, Z + Math.sin(a) * r, 0, [1.5, h * 1.6, 1.5]);
    }
  };

  for (const p of state.provinces) {
    const X = toX(p.x);
    const Z = toZ(p.y);
    const Y = Math.max(waterY, ground(p.x, p.y));
    const big = p.capitalOf >= 0 ? 1.45 : 1;
    if (p.kind === 'fort') {
      // A hill fort: a ring of bastioned walls following the hilltop, a keep and a temple or a mosque inside.
      const r = (4.2 + p.walls * 0.8) * big;
      ring(X, Z, Y, r, 9, 2 + p.walls * 0.4, 1);
      keep.add(X + 0.8, Y + 2.2 * big, Z - 0.6, 0.3, [2.6 * big, 4.4 * big, 2.2 * big]);
      flatRoof.add(X + 0.8, Y + 4.45 * big, Z - 0.6, 0.3, [2.8 * big, 0.25, 2.4 * big], ROOFTOP);
      for (let k = 0; k < 4; k++) {
        const a = rand() * Math.PI * 2;
        const d = rand() * r * 0.6;
        const hx = X + Math.cos(a) * d;
        const hz = Z + Math.sin(a) * d;
        house.add(hx, Y + 0.6, hz, rand() * 3, [1.4, 1.2, 1.7]);
        flatRoof.add(hx, Y + 1.25, hz, 0, [1.5, 0.15, 1.8], ROOFTOP);
      }
      flagSpots.push({ prov: p.id, x: X + 0.8, y: Y + 4.6 * big, z: Z - 0.6 });
      lampSpots.push([X + 0.8, Y + 3 * big, Z - 0.6]);
      continue;
    }
    // A town: houses packed inside its walls, flat roofs and tiled ones, a domed mosque or palace, minarets.
    const r = (5 + Math.min(6, p.wealth * 0.35)) * big;
    if (p.walls > 0) ring(X, Z, Y, r, 18, 1.4 + p.walls * 0.35, 3);
    const n = Math.round((14 + p.wealth * 2) * big);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const d = 1.5 + Math.sqrt(rand()) * (r - 2);
      const hx = X + Math.cos(a) * d;
      const hz = Z + Math.sin(a) * d;
      const yaw = a + (rand() - 0.5) * 0.4;
      const s = 0.8 + rand() * 0.6;
      const hy = Math.max(waterY, ground(hx + WW / 2, WH / 2 - hz));
      const h = (0.9 + rand() * 0.9) * s;
      house.add(hx, hy + h / 2, hz, yaw, [1.3 * s, h, 1.6 * s]);
      if (rand() < 0.6) flatRoof.add(hx, hy + h + 0.06, hz, yaw, [1.4 * s, 0.14, 1.7 * s], ROOFTOP);
      else roof.add(hx, hy + h + 0.4 * s, hz, yaw + Math.PI / 4, [1.9 * s, 0.8 * s, 2.2 * s], rand() < 0.5 ? TILE : THATCH);
      if (rand() < 0.6) lampSpots.push([hx, hy + h * 0.6, hz]);
    }
    // The great building at the centre: a domed mosque or palace, with minarets in the richer towns.
    const D = 3 * big;
    drum.add(X, Y + 1.1 * big, Z, 0, [D, 2.2 * big, D]);
    dome.add(X, Y + 2.2 * big, Z, 0, [D * 0.9, D * 0.9, D * 0.9]);
    if (p.wealth >= 7 || big > 1) {
      for (const [dx, dz] of [[-D * 0.75, -D * 0.75], [D * 0.75, D * 0.75]]) {
        minaret.add(X + dx, Y + 2.4 * big, Z + dz, 0, [0.45, 4.8 * big, 0.45]);
        dome.add(X + dx, Y + 4.8 * big, Z + dz, 0, [0.6, 0.6, 0.6]);
      }
    }
    lampSpots.push([X, Y + 2, Z]);
    flagSpots.push({ prov: p.id, x: X, y: Y + 2.2 * big + D * 0.45, z: Z });
    if (p.kind === 'port') {
      // A quay on the water with boats along it.
      const qx = X - r - 2;
      const qz = Z - 2;
      quay.add(qx, waterY + 0.3, qz, 0.4, [8, 0.6, 2], WOOD);
      for (let k = 0; k < 3; k++) {
        const bx = qx - 2 + k * 3;
        const bz = qz - 3 - rand() * 2;
        hull.add(bx, waterY + 0.35, bz, 0.4 + (rand() - 0.5) * 0.5, [0.9, 0.6, 3], WOOD);
        mast.add(bx, waterY + 2, bz, 0, [0.12, 3, 0.12], WOOD);
      }
    }
  }
  // Villages: round thatched huts and haystacks.
  for (const v of state.villages) {
    const n = 3 + Math.round(v.wealth / 6);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const d = 0.8 + rand() * 2.2;
      const x = v.x + Math.cos(a) * d;
      const y = v.y - Math.sin(a) * d;
      const hy = Math.max(waterY, ground(x, y));
      const s = 0.8 + rand() * 0.4;
      hut.add(toX(x), hy + 0.45 * s, toZ(y), 0, [1.2 * s, 0.9 * s, 1.2 * s]);
      thatch.add(toX(x), hy + 1.3 * s, toZ(y), 0, [1.6 * s, 0.9 * s, 1.6 * s], THATCH);
      if (k === 0) lampSpots.push([toX(x), hy + 0.6, toZ(y)]);
    }
    const hx = v.x + 3;
    const hy = Math.max(waterY, ground(hx, v.y));
    thatch.add(toX(hx), hy + 0.5, toZ(v.y), 0, [1, 1, 1], [0.86, 0.74, 0.4]);
  }
  for (const m of [wallSeg, tower, towerCap, keep, house, flatRoof, roof, hut, thatch, dome, drum, minaret, quay, hull, mast]) m.end();

  // Flags: a pole and a cloth in the owner's colours, stirring in the wind.
  const pole = mk(CreateCylinder('sPole', { height: 1, diameter: 1, tessellation: 4 }, scene), tinted, true);
  const clothMesh = CreateBox('sCloth', { size: 1 }, scene);
  const clothMat = material(scene, 'sClothMat', [1, 1, 1], undefined, 0.25);
  const cloth = mk(clothMesh, clothMat, true);
  // Lamps: little glows in windows and courtyards that show after dark.
  const lampMat = material(scene, 'sLamp', [1, 0.78, 0.38], undefined, 1);
  lampMat.disableLighting = true;
  const lamps = mk(CreateBox('sLampBox', { size: 1 }, scene), lampMat);
  lamps.begin();
  for (const [x, y, z] of lampSpots) lamps.add(x, y, z, 0, [0.75, 0.75, 0.75]);
  lamps.end();
  const lampMesh = lamps.mesh;

  return {
    update(t, color, night) {
      pole.begin();
      cloth.begin();
      for (const f of flagSpots) {
        pole.add(f.x, f.y + 1.5, f.z, 0, [0.14, 3, 0.14], WOOD);
        const sway = Math.sin(t * 2.2 + f.prov) * 0.25;
        cloth.add(f.x + Math.cos(sway) * 0.95, f.y + 2.5, f.z - Math.sin(sway) * 0.95, sway, [1.9, 1.1, 0.08], color(f.prov));
      }
      pole.end();
      cloth.end();
      lampMesh.visibility = Math.max(0, Math.min(1, (night - 0.25) * 2));
      lampMesh.isVisible = night > 0.25;
    },
  };
}

// ---------------------------------------------------------------- sky

export interface Sky {
  /** Drifts the clouds, and fades them out as the camera comes down close to the ground. */
  update(t: number, cameraRadius: number): void;
}

/** Big soft clouds drifting high over the land. */
export function buildClouds(scene: Scene): Sky {
  const tex = new DynamicTexture('cloudTex', 256, scene, true);
  const g = tex.getContext() as CanvasRenderingContext2D;
  g.clearRect(0, 0, 256, 256);
  const rand = stream(31);
  for (let k = 0; k < 26; k++) {
    const x = 50 + rand() * 156;
    const y = 70 + rand() * 116;
    const r = 24 + rand() * 40;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  tex.hasAlpha = true;
  tex.update();
  const mat = new StandardMaterial('cloudMat', scene);
  mat.diffuseTexture = tex;
  mat.opacityTexture = tex;
  mat.emissiveColor = new Color3(0.9, 0.9, 0.92);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.alpha = 0.55;
  const clouds: { mesh: Mesh; x: number; z: number; v: number }[] = [];
  for (let k = 0; k < 22; k++) {
    const size = 160 + rand() * 200;
    const mesh = CreatePlane(`cloud${k}`, { size }, scene);
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.y = rand() * Math.PI * 2;
    mesh.material = mat;
    mesh.position.y = 150 + rand() * 60;
    mesh.isPickable = false;
    clouds.push({ mesh, x: rand() * WW * 1.3, z: (rand() - 0.5) * WH * 1.1, v: 4 + rand() * 6 });
  }
  return {
    update(t, radius) {
      // Clouds show from high up and thin away as the camera comes down to the ground.
      const a = Math.max(0, Math.min(1, (radius - 1000) / 900)) * 0.5;
      mat.alpha = a;
      for (const c of clouds) {
        c.mesh.isVisible = a > 0.01;
        // Drifting east, and round again from the west.
        const x = ((c.x + t * c.v) % (WW * 1.3)) - WW * 0.65;
        c.mesh.position.x = x;
        c.mesh.position.z = c.z;
      }
    },
  };
}

/** The light of the hour: 0..1 through the day, noon at 0.5. */
export function daylight(phase: number) {
  const sun = Math.sin((phase - 0.25) * Math.PI * 2); // -1 midnight .. 1 noon
  const day = Math.max(0, Math.min(1, sun * 1.6 + 0.45));
  const dusk = Math.max(0, 1 - Math.abs(sun) * 3.2) * (sun > -0.3 ? 1 : 0);
  return { sun, day, dusk, night: 1 - day };
}

