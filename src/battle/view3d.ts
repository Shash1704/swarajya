import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { VIEW_H, VIEW_W } from '../app';
import { UNIT_STATS, type UnitType } from '../data';
import { drawTileSymbol } from '../symbols';
import { RNG } from '../rng';
import type { Faction } from '../campaign/state';
import { type Battle, type BUnit, FIELD_H, FIELD_W } from './battle';

/**
 * The battlefield in 3D (Babylon.js). The simulation is unchanged: this only
 * draws it. The painted battle map is draped over a height-mapped ground;
 * woods, villages and walls stand on it; each regiment is a block of little
 * soldiers in its colours with its counter floating above. Labels, orders and
 * effects are drawn on the 2D canvas laid over the top, using project().
 */

/** World units of height for a hill of height 1. */
const HS = 48;
/** Height grid resolution (battle px per sample). */
const GS = 6;
const GW = Math.ceil(FIELD_W / GS) + 1;
const GH = Math.ceil(FIELD_H / GS) + 1;

let engine: Engine | null = null;

export interface FrameState {
  t: number;
  selected: Set<number>;
  /** Which enemy regiments the player can see (fog of war). */
  visible: (u: BUnit) => boolean;
  paused: boolean;
}

/** Converts a battle position to Babylon world space (y up; the player's edge nearest the camera). */
const toX = (x: number) => x - FIELD_W / 2;
const toZ = (y: number) => FIELD_H / 2 - y;

/** Mesh rotation (about y) that turns a +z-facing model to a battle facing angle. */
const yawOf = (facing: number) => Math.atan2(Math.cos(facing), -Math.sin(facing));

/** A shared mesh drawn many times (thin instances), with its matrix and colour buffers. */
class Crowd {
  mesh: Mesh;
  private mats = new Float32Array(16 * 64);
  private cols: Float32Array | null;
  n = 0;
  private tmp = new Matrix();
  private q = new Quaternion();
  private s = new Vector3();
  private p = new Vector3();

  constructor(mesh: Mesh, coloured: boolean) {
    this.mesh = mesh;
    this.cols = coloured ? new Float32Array(4 * 64) : null;
    mesh.thinInstanceSetBuffer('matrix', this.mats, 16, false);
    if (this.cols) mesh.thinInstanceSetBuffer('color', this.cols, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.alwaysSelectAsActiveMesh = true;
  }

  begin() {
    this.n = 0;
  }

  add(x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1, col?: [number, number, number], pitch = 0) {
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
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, this.q);
    this.s.set(sx, sy, sz);
    this.p.set(x, y, z);
    Matrix.ComposeToRef(this.s, this.q, this.p, this.tmp);
    this.tmp.copyToArray(this.mats, this.n * 16);
    if (this.cols) {
      const c = col ?? [1, 1, 1];
      this.cols.set([c[0], c[1], c[2], 1], this.n * 4);
    }
    this.n++;
  }

  end() {
    this.mesh.thinInstanceCount = this.n;
    this.mesh.thinInstanceBufferUpdated('matrix');
    if (this.cols) this.mesh.thinInstanceBufferUpdated('color');
  }
}

export class View3D {
  readonly canvas: HTMLCanvasElement;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private sun: DirectionalLight;
  private sky: HemisphericLight;
  private heights = new Float32Array(GW * GH);
  private b: Battle;
  private factions: [Faction, Faction];
  private crowds: Record<string, Crowd> = {};
  private counters = new Map<number, Mesh>();
  private tileMats = new Map<string, StandardMaterial>();
  private wallMeshes: { seg: number; mesh: Mesh; full: number }[] = [];
  private standards: { pole: Mesh; flag: Mesh }[] = [];

  constructor(canvas: HTMLCanvasElement, b: Battle, factions: [Faction, Faction], ground: HTMLCanvasElement, place: string) {
    this.canvas = canvas;
    this.b = b;
    this.factions = factions;
    if (!engine || engine.getRenderingCanvas() !== canvas) {
      engine?.dispose();
      engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, antialias: true }, true);
    }
    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.74, 0.8, 0.84, 1);
    scene.ambientColor = new Color3(0.35, 0.33, 0.3);

    // Camera: looking up the field from behind the player's lines.
    const cam = new ArcRotateCamera('cam', -Math.PI / 2, 0.98, 1150, new Vector3(0, 0, -40), scene);
    cam.minZ = 4;
    cam.maxZ = 9000;
    cam.fov = 0.75;
    cam.lowerBetaLimit = 0.25;
    cam.upperBetaLimit = 1.32;
    cam.lowerRadiusLimit = 160;
    cam.upperRadiusLimit = 1900;
    this.camera = cam;

    this.sky = new HemisphericLight('sky', new Vector3(0.2, 1, -0.3), scene);
    this.sky.intensity = 0.62;
    this.sky.groundColor = new Color3(0.42, 0.38, 0.3);
    this.sun = new DirectionalLight('sun', new Vector3(0.55, -1, 0.45), scene);
    this.sun.position = new Vector3(-900, 1400, -700);
    this.sun.intensity = 0.95;
    this.sun.diffuse = new Color3(1, 0.95, 0.84);

    this.buildHeights();
    const groundMesh = this.buildGround(ground, place);
    const shadows = new ShadowGenerator(2048, this.sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.bias = 0.0015;
    shadows.darkness = 0.35;
    groundMesh.receiveShadows = true;

    this.buildTrees(shadows);
    this.buildVillages(shadows);
    if (b.walls) this.buildWalls(shadows);
    this.buildCrowds(shadows);
    this.buildStandards();
  }

  // ---------------------------------------------------------------- terrain

  private buildHeights() {
    const b = this.b;
    const river = b.rivers[0];
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const p = { x: Math.min(FIELD_W, i * GS), y: Math.min(FIELD_H, j * GS) };
        let h = b.height(p) * HS;
        // The river runs in a shallow bed.
        if (river) {
          const d = b.riverDist(p);
          if (d < river.w / 2 + 14) h -= (b.onFord(p) ? 2 : 6) * (1 - Math.max(0, d - river.w / 2) / 14);
        }
        this.heights[j * GW + i] = h;
      }
    }
  }

  /** Ground height (world units) under a battle position. */
  groundY(x: number, y: number): number {
    const fx = Math.max(0, Math.min(GW - 1.001, x / GS));
    const fy = Math.max(0, Math.min(GH - 1.001, y / GS));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const H = this.heights;
    const a = H[j * GW + i] * (1 - u) + H[j * GW + i + 1] * u;
    const c = H[(j + 1) * GW + i] * (1 - u) + H[(j + 1) * GW + i + 1] * u;
    return a * (1 - v) + c * v;
  }

  private buildGround(painted: HTMLCanvasElement, place: string): Mesh {
    const scene = this.scene;
    const ground = CreateGround('ground', { width: FIELD_W, height: FIELD_H, subdivisionsX: GW - 1, subdivisionsY: GH - 1, updatable: true }, scene);
    const pos = ground.getVerticesData(VertexBuffer.PositionKind)!;
    for (let k = 0; k < pos.length; k += 3) {
      const x = pos[k] + FIELD_W / 2;
      const y = FIELD_H / 2 - pos[k + 2];
      pos[k + 1] = this.groundY(x, y);
    }
    ground.updateVerticesData(VertexBuffer.PositionKind, pos);
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, ground.getIndices()!, normals);
    ground.updateVerticesData(VertexBuffer.NormalKind, normals);

    // The painted battle map (with the place name written across it) is the ground's skin.
    const skin = document.createElement('canvas');
    skin.width = painted.width;
    skin.height = painted.height;
    const g = skin.getContext('2d')!;
    g.drawImage(painted, 0, 0);
    g.save();
    g.scale(skin.width / FIELD_W, skin.height / FIELD_H);
    g.translate(FIELD_W * 0.23, FIELD_H * 0.52);
    g.rotate(-0.28);
    g.font = 'italic 600 88px "EB Garamond", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,250,236,0.4)';
    g.fillText(place, 0, 0);
    g.restore();
    const tex = new DynamicTexture('groundTex', skin, scene, true);
    tex.update(true);
    tex.anisotropicFilteringLevel = 8;
    const mat = new StandardMaterial('groundMat', scene);
    mat.diffuseTexture = tex;
    mat.specularColor = new Color3(0.05, 0.05, 0.04);
    ground.material = mat;

    // Country beyond the field, so the edges don't fall away into the sky.
    const outer = CreateGround('outer', { width: FIELD_W * 5, height: FIELD_H * 5 }, scene);
    outer.position.y = -0.5;
    const om = new StandardMaterial('outerMat', scene);
    // The same olive as the field's own ground, so the edge melts into the haze.
    const avg = this.averageColor(painted);
    om.diffuseColor = new Color3(avg[0], avg[1], avg[2]);
    om.specularColor = Color3.Black();
    outer.material = om;
    return ground;
  }

  /** Mean colour of the painted field (sampled sparsely). */
  private averageColor(c: HTMLCanvasElement): [number, number, number] {
    const g = c.getContext('2d')!;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 997) {
      r += d[i];
      gg += d[i + 1];
      b += d[i + 2];
      n++;
    }
    return [(r / n / 255) * 0.92, (gg / n / 255) * 0.92, (b / n / 255) * 0.92];
  }

  private mat(name: string, c: [number, number, number], emissive = 0): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = new Color3(c[0], c[1], c[2]);
    m.specularColor = new Color3(0.04, 0.04, 0.04);
    if (emissive) m.emissiveColor = new Color3(c[0] * emissive, c[1] * emissive, c[2] * emissive);
    return m;
  }

  private buildTrees(shadows: ShadowGenerator) {
    const scene = this.scene;
    const crown = CreateSphere('crown', { diameter: 1, segments: 5 }, scene);
    crown.material = this.mat('leaf', [1, 1, 1]);
    const trunk = CreateCylinder('trunk', { height: 1, diameter: 1, tessellation: 5 }, scene);
    trunk.material = this.mat('bark', [0.32, 0.24, 0.16]);
    const crowns = new Crowd(crown, true);
    const trunks = new Crowd(trunk, false);
    const rng = new RNG(this.b.opts.seed + 41);
    for (const f of this.b.forests) {
      const n = Math.floor(f.r * f.r * 0.016) + 4;
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = f.r * 0.95 * Math.sqrt(rng.next());
        const x = f.x + Math.cos(a) * r;
        const y = f.y + Math.sin(a) * r;
        const gy = this.groundY(x, y);
        const h = rng.range(14, 24);
        const w = rng.range(9, 15);
        trunks.add(toX(x), gy + h * 0.25, toZ(y), 0, 2, h * 0.5, 2);
        const green = rng.range(0.75, 1);
        crowns.add(toX(x), gy + h * 0.62, toZ(y), rng.range(0, 6), w, h * 0.75, w, [0.2 * green, 0.32 * green, 0.14 * green]);
      }
    }
    crowns.end();
    trunks.end();
    shadows.addShadowCaster(crown);
    shadows.addShadowCaster(trunk);
  }

  private buildVillages(shadows: ShadowGenerator) {
    const scene = this.scene;
    const house = CreateBox('house', { size: 1 }, scene);
    house.material = this.mat('wall', [1, 1, 1]);
    const roof = CreateCylinder('roof', { height: 1, diameter: 1, tessellation: 3 }, scene);
    roof.material = this.mat('thatch', [0.55, 0.32, 0.17]);
    const houses = new Crowd(house, true);
    const roofs = new Crowd(roof, false);
    const rng = new RNG(this.b.opts.seed + 43);
    for (const v of this.b.villages) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const d = rng.range(v.r * 0.15, v.r * 0.75);
        const x = v.x + Math.cos(a) * d;
        const y = v.y + Math.sin(a) * d;
        const gy = this.groundY(x, y);
        const yaw = rng.range(0, Math.PI);
        const w = rng.range(10, 16);
        const l = rng.range(12, 20);
        houses.add(toX(x), gy + 4, toZ(y), yaw, w, 8, l, [rng.range(0.72, 0.82), rng.range(0.6, 0.66), rng.range(0.46, 0.5)]);
        // A triangular prism lying along the house for the roof.
        roofs.add(toX(x), gy + 10, toZ(y), yaw, w * 1.15, l * 1.05, 6, undefined, Math.PI / 2);
      }
    }
    houses.end();
    roofs.end();
    shadows.addShadowCaster(house);
    shadows.addShadowCaster(roof);
  }

  private buildWalls(shadows: ShadowGenerator) {
    const W = this.b.walls!;
    const scene = this.scene;
    const stone = this.mat('stone', [0.7, 0.64, 0.54]);
    const wood = this.mat('gate', [0.42, 0.28, 0.16]);
    const height = [0, 22, 34, 44][W.level];
    W.segs.forEach((s, i) => {
      const len = s.x1 - s.x0;
      const m = CreateBox(`seg${i}`, { width: len, height: 1, depth: W.t }, scene);
      m.material = s.gate ? wood : stone;
      const cx = (s.x0 + s.x1) / 2;
      const cy = W.y + W.t / 2;
      m.position.set(toX(cx), this.groundY(cx, cy), toZ(cy));
      shadows.addShadowCaster(m);
      m.receiveShadows = true;
      this.wallMeshes.push({ seg: i, mesh: m, full: s.gate ? height * 0.8 : height });
    });
    for (const tw of W.towers) {
      const cy = W.y + W.t / 2;
      const m = CreateCylinder('tower', { height: height * 1.4, diameter: W.t * 1.5, tessellation: 10 }, scene);
      m.material = stone;
      m.position.set(toX(tw.x), this.groundY(tw.x, cy) + height * 0.7, toZ(cy));
      shadows.addShadowCaster(m);
    }
  }

  // ---------------------------------------------------------------- soldiers

  private buildCrowds(shadows: ShadowGenerator) {
    const scene = this.scene;
    const make = (key: string, mesh: Mesh, coloured: boolean, c: [number, number, number] = [1, 1, 1]) => {
      mesh.material = this.mat(`${key}Mat`, c);
      this.crowds[key] = new Crowd(mesh, coloured);
      shadows.addShadowCaster(mesh);
    };
    // Foot soldier: body and head (separate so the head stays skin-coloured).
    const body = CreateCylinder('body', { height: 5.2, diameterTop: 1.6, diameterBottom: 2.4, tessellation: 6 }, scene);
    body.bakeTransformIntoVertices(Matrix.Translation(0, 2.6, 0));
    make('body', body, true);
    const head = CreateSphere('head', { diameter: 1.7, segments: 4 }, scene);
    head.bakeTransformIntoVertices(Matrix.Translation(0, 6.1, 0));
    make('head', head, false, [0.62, 0.45, 0.32]);
    const spear = CreateBox('spear', { width: 0.25, height: 11, depth: 0.25 }, scene);
    spear.bakeTransformIntoVertices(Matrix.Translation(0.9, 5, 0));
    make('spear', spear, false, [0.36, 0.28, 0.18]);
    // Horse and rider.
    const horse = CreateBox('horse', { width: 2, height: 3, depth: 6 }, scene);
    horse.bakeTransformIntoVertices(Matrix.Translation(0, 4, 0));
    const neck = CreateBox('neck', { width: 1.4, height: 3.2, depth: 1.6 }, scene);
    neck.bakeTransformIntoVertices(Matrix.RotationX(-0.5).multiply(Matrix.Translation(0, 6, 3)));
    const legs = CreateBox('legs', { width: 1.6, height: 3, depth: 4.6 }, scene);
    legs.bakeTransformIntoVertices(Matrix.Translation(0, 1.4, 0));
    const horseAll = Mesh.MergeMeshes([horse, neck, legs], true)!;
    make('horse', horseAll, true);
    const rider = CreateCylinder('rider', { height: 4, diameterTop: 1.4, diameterBottom: 2, tessellation: 6 }, scene);
    rider.bakeTransformIntoVertices(Matrix.Translation(0, 7.2, -0.4));
    const riderHead = CreateSphere('riderHead', { diameter: 1.5, segments: 4 }, scene);
    riderHead.bakeTransformIntoVertices(Matrix.Translation(0, 9.9, -0.4));
    make('rider', rider, true);
    make('riderHead', riderHead, false, [0.62, 0.45, 0.32]);
    // Elephant with its howdah.
    const eBody = CreateSphere('eBody', { diameterX: 9, diameterY: 8, diameterZ: 13, segments: 6 }, scene);
    eBody.bakeTransformIntoVertices(Matrix.Translation(0, 9, 0));
    const eHead = CreateSphere('eHead', { diameter: 6, segments: 5 }, scene);
    eHead.bakeTransformIntoVertices(Matrix.Translation(0, 10, 7.5));
    const trunk = CreateCylinder('eTrunk', { height: 7, diameterTop: 1.6, diameterBottom: 0.8, tessellation: 6 }, scene);
    trunk.bakeTransformIntoVertices(Matrix.Translation(0, 5.5, 9.6));
    const eLegs = CreateBox('eLegs', { width: 6, height: 6, depth: 9 }, scene);
    eLegs.bakeTransformIntoVertices(Matrix.Translation(0, 3, 0));
    make('elephant', Mesh.MergeMeshes([eBody, eHead, trunk, eLegs], true)!, false, [0.5, 0.48, 0.46]);
    const howdah = CreateBox('howdah', { width: 6, height: 4, depth: 6 }, scene);
    howdah.bakeTransformIntoVertices(Matrix.Translation(0, 15, -1));
    make('howdah', howdah, true);
    // Gun on its carriage.
    const barrel = CreateCylinder('barrel', { height: 12, diameterTop: 1.6, diameterBottom: 2.4, tessellation: 8 }, scene);
    barrel.bakeTransformIntoVertices(Matrix.RotationX(Math.PI / 2 - 0.15).multiply(Matrix.Translation(0, 4.4, 1)));
    const carriage = CreateBox('carriage', { width: 4, height: 2.4, depth: 9 }, scene);
    carriage.bakeTransformIntoVertices(Matrix.Translation(0, 2.4, -1));
    const wheels = CreateCylinder('wheels', { height: 6, diameter: 4.4, tessellation: 10 }, scene);
    wheels.bakeTransformIntoVertices(Matrix.RotationZ(Math.PI / 2).multiply(Matrix.Translation(0, 2.2, 0)));
    make('gun', Mesh.MergeMeshes([barrel, carriage, wheels], true)!, false, [0.3, 0.25, 0.2]);
    // Selection rings.
    const ring = CreateTorus('ring', { diameter: 1, thickness: 0.06, tessellation: 28 }, scene);
    const rm = this.mat('ringMat', [1, 0.85, 0.4], 1);
    rm.disableLighting = true;
    ring.material = rm;
    this.crowds.ring = new Crowd(ring, false);
  }

  private buildStandards() {
    for (const side of [0, 1] as const) {
      const f = this.factions[side];
      const pole = CreateCylinder(`pole${side}`, { height: 40, diameter: 0.9, tessellation: 6 }, this.scene);
      pole.material = this.mat(`poleMat${side}`, [0.3, 0.22, 0.14]);
      const flag = CreatePlane(`flag${side}`, { width: 12, height: 9, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      flag.material = this.mat(`flagMat${side}`, [f.rgb[0] / 255, f.rgb[1] / 255, f.rgb[2] / 255], 0.45);
      this.standards.push({ pole, flag });
    }
  }

  /** The regiment's counter (two-tone tile with its symbol), as a billboard texture. */
  private tileMat(side: 0 | 1, type: UnitType): StandardMaterial {
    const key = `${side}:${type}`;
    let m = this.tileMats.get(key);
    if (m) return m;
    const S = 96;
    const tex = new DynamicTexture(`tile${key}`, { width: S, height: S }, this.scene, true);
    const g = tex.getContext() as unknown as CanvasRenderingContext2D;
    const [r, gg, bl] = this.factions[side].rgb;
    g.fillStyle = `rgb(${r * 0.78},${gg * 0.78},${bl * 0.78})`;
    g.fillRect(0, 0, S, S);
    g.fillStyle = `rgb(${Math.min(255, r + (255 - r) * 0.45)},${Math.min(255, gg + (255 - gg) * 0.45)},${Math.min(255, bl + (255 - bl) * 0.45)})`;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(S, 0);
    g.lineTo(0, S);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(22,13,8,0.95)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, S - 6, S - 6);
    if (UNIT_STATS[type].tier === 'S') {
      g.strokeStyle = '#d9b44a';
      g.lineWidth = 3;
      g.strokeRect(11, 11, S - 22, S - 22);
    }
    g.save();
    g.translate(S / 2, S / 2);
    drawTileSymbol(g, type, S - 18, 'rgba(26,16,10,0.92)');
    g.restore();
    tex.update(true);
    m = new StandardMaterial(`tileMat${key}`, this.scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.disableLighting = true;
    m.backFaceCulling = false;
    this.tileMats.set(key, m);
    return m;
  }

  private counter(u: BUnit): Mesh {
    let m = this.counters.get(u.id);
    if (!m) {
      m = CreatePlane(`counter${u.id}`, { size: 15 }, this.scene);
      m.billboardMode = Mesh.BILLBOARDMODE_ALL;
      m.material = this.tileMat(u.side, u.type);
      this.counters.set(u.id, m);
    }
    return m;
  }

  // ---------------------------------------------------------------- per frame

  render(f: FrameState) {
    const b = this.b;
    const c = this.crowds;
    for (const k in c) c[k].begin();
    const light = b.light();
    const mist = b.mist();
    this.sun.intensity = 0.95 * (0.35 + 0.65 * light);
    this.sky.intensity = 0.62 * (0.5 + 0.5 * light);
    this.sun.diffuse.set(1, 0.8 + 0.15 * light, 0.62 + 0.22 * light);
    const sky: [number, number, number] = [0.74 * light + 0.12, 0.8 * light + 0.1, 0.84 * light + 0.16];
    this.scene.clearColor.set(sky[0], sky[1], sky[2], 1);
    // Always a little haze, so the far country fades into the sky; thicker in mist and rain.
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.00028 + mist * 0.0011 + (b.opts.rain ? 0.0003 : 0);
    this.scene.fogColor.set(sky[0], sky[1], sky[2]);

    for (const u of b.units) {
      const shown = (u.state === 'ok' || u.state === 'routing') && (u.side === 0 || f.visible(u));
      const tile = this.counter(u);
      tile.isVisible = shown;
      if (!shown) continue;
      this.drawRegiment(u, f.t, f.paused);
      const gy = this.standY(u, u.x, u.y);
      tile.position.set(toX(u.x), gy + (UNIT_STATS[u.type].cls === 'elephant' ? 30 : 22), toZ(u.y));
      tile.visibility = u.state === 'routing' ? 0.45 + 0.25 * Math.sin(f.t * 10) : 1;
      if (f.selected.has(u.id) && u.state === 'ok') {
        const r = UNIT_STATS[u.type].cls === 'cavalry' ? 34 : 28;
        c.ring.add(toX(u.x), gy + 1.2, toZ(u.y), 0, r * 2, 1, r * 2);
      }
    }

    // The commanders' standards ride with their regiments.
    for (const side of [0, 1] as const) {
      const { pole, flag } = this.standards[side];
      const g = b.get(b.generalIds[side]);
      const ok = !!g && g.state === 'ok' && (side === 0 || f.visible(g));
      pole.isVisible = ok;
      flag.isVisible = ok;
      if (!g || !ok) continue;
      const gy = this.groundY(g.x, g.y);
      const x = toX(g.x) + 10;
      const z = toZ(g.y);
      pole.position.set(x, gy + 20, z);
      flag.position.set(x + 6.2, gy + 34, z);
      flag.rotation.y = Math.sin(f.t * 2 + side) * 0.25;
    }

    // Walls sink to rubble as they're breached.
    const W = b.walls;
    if (W) {
      for (const wm of this.wallMeshes) {
        const s = W.segs[wm.seg];
        const h = s.hp > 0 ? wm.full * (0.55 + 0.45 * s.hp / s.maxHp) : 5;
        wm.mesh.scaling.y = h;
        const cx = (s.x0 + s.x1) / 2;
        wm.mesh.position.y = this.groundY(cx, W.y + W.t / 2) + h / 2;
      }
    }

    for (const k in c) c[k].end();
    engine!.beginFrame();
    this.scene.render();
    engine!.endFrame();
  }

  /** How far above the ground a regiment stands (up on the wall, if manning it). */
  raise(u: BUnit): number {
    return this.standY(u, u.x, u.y) - this.groundY(u.x, u.y);
  }

  /** Height a regiment stands at: on top of the wall if it's manning it, else on the ground. */
  private standY(u: BUnit, x: number, y: number): number {
    const gy = this.groundY(x, y);
    const W = this.b.walls;
    if (!W || !this.b.onWall(u)) return gy;
    const s = this.b.segAt(x);
    if (!s || s.hp <= 0) return gy + 5;
    const full = [0, 22, 34, 44][W.level];
    return gy + full * (0.55 + 0.45 * s.hp / s.maxHp);
  }

  /** Lays out a regiment's men as a block of figures, shaped by its formation. */
  private drawRegiment(u: BUnit, t: number, paused: boolean) {
    const st = UNIT_STATS[u.type];
    const cls = st.cls;
    const c = this.crowds;
    const f = this.factions[u.side];
    const col: [number, number, number] = [f.rgb[0] / 255, f.rgb[1] / 255, f.rgb[2] / 255];
    const per = cls === 'cavalry' ? 2 : cls === 'elephant' ? 1 : cls === 'artillery' ? 6 : 3;
    const cap = cls === 'cavalry' ? 18 : cls === 'elephant' ? 6 : cls === 'artillery' ? 3 : 26;
    const n = Math.max(1, Math.min(cap, Math.ceil(u.men / per)));
    // Frontage and spacing by formation.
    const tight = u.formation === 'tight' || u.formation === 'brace';
    const loose = u.formation === 'loose';
    const space = cls === 'elephant' ? 16 : cls === 'artillery' ? 16 : cls === 'cavalry' ? 6.5 : tight ? 4.2 : loose ? 8 : 5.4;
    const cols = cls === 'elephant' || cls === 'artillery' ? n : Math.max(1, Math.round(Math.sqrt(n * (tight ? 4 : 3))));
    const rows = Math.ceil(n / cols);
    const fx = Math.cos(u.facing);
    const fy = Math.sin(u.facing);
    // Right-hand vector along the front.
    const rx = -fy;
    const ry = fx;
    const yaw = yawOf(u.facing);
    const routing = u.state === 'routing';
    const moving = (u.moving || routing) && !paused;
    let seed = u.id * 7919;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / cols);
      const colI = k % cols;
      const inRow = Math.min(cols, n - row * cols);
      let lat = (colI - (inRow - 1) / 2) * space;
      let dep = -(row - (rows - 1) / 2) * space;
      // A wedge narrows to a point at the front.
      if (u.formation === 'wedge') lat *= 0.35 + 0.65 * (row / Math.max(1, rows - 1));
      lat += (rand() - 0.5) * space * (loose ? 0.6 : 0.3);
      dep += (rand() - 0.5) * space * (loose ? 0.6 : 0.3);
      if (routing) {
        lat += (rand() - 0.5) * 40;
        dep += (rand() - 0.5) * 30;
      }
      const x = u.x + rx * lat + fx * dep;
      const y = u.y + ry * lat + fy * dep;
      const gy = this.standY(u, x, y);
      const bob = moving ? Math.abs(Math.sin(t * (cls === 'cavalry' ? 11 : 8) + k * 1.7)) * (cls === 'cavalry' ? 1.2 : 0.7) : 0;
      const lunge = u.fighting && !paused ? Math.sin(t * 9 + k * 2.3) * 1.2 : 0;
      const X = toX(x) + Math.sin(yaw) * lunge;
      const Z = toZ(y) + Math.cos(yaw) * lunge;
      const myYaw = routing ? yaw + Math.PI + (rand() - 0.5) : yaw + (rand() - 0.5) * 0.25;
      if (cls === 'cavalry') {
        c.horse.add(X, gy + bob, Z, myYaw, 1, 1, 1, [0.42 + rand() * 0.15, 0.3 + rand() * 0.08, 0.2]);
        c.rider.add(X, gy + bob, Z, myYaw, 1, 1, 1, col);
        c.riderHead.add(X, gy + bob, Z, myYaw);
      } else if (cls === 'elephant') {
        c.elephant.add(X, gy + bob * 0.5, Z, myYaw);
        c.howdah.add(X, gy + bob * 0.5, Z, myYaw, 1, 1, 1, col);
      } else if (cls === 'artillery') {
        c.gun.add(X, gy, Z, yaw);
        for (const side of [-1, 1]) {
          const cx = X + Math.cos(yaw) * side * 5 - Math.sin(yaw) * 3;
          const cz = Z - Math.sin(yaw) * side * 5 - Math.cos(yaw) * 3;
          c.body.add(cx, gy, cz, yaw, 1, 1, 1, col);
          c.head.add(cx, gy, cz, yaw);
        }
      } else {
        c.body.add(X, gy + bob, Z, myYaw, 1, 1, 1, col);
        c.head.add(X, gy + bob, Z, myYaw);
        // Spearmen carry their spears upright, or levelled in a hedge.
        if (st.role === 'pike' || u.type === 'paik') {
          c.spear.add(X, gy + bob + (u.formation === 'brace' ? 3 : 0), Z, myYaw, 1, 1, 1, undefined, u.formation === 'brace' ? 1.25 : 0.05);
        }
      }
    }
  }

  // ---------------------------------------------------------------- picking and projection

  /** Screen (logical view) coordinates of a battle position, `lift` world units above the ground. */
  project(x: number, y: number, lift = 0): [number, number] | null {
    const w = engine!.getRenderWidth();
    const h = engine!.getRenderHeight();
    const p = Vector3.Project(new Vector3(toX(x), this.groundY(x, y) + lift, toZ(y)), Matrix.Identity(),
      this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
    if (p.z < 0 || p.z > 1) return null;
    return [(p.x * VIEW_W) / w, (p.y * VIEW_H) / h];
  }

  /** How many screen pixels one world unit spans at a battle position (for sizing labels). */
  scaleAt(x: number, y: number): number {
    const a = this.project(x, y, 0);
    const b = this.project(x, y, 20);
    return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) / 20 : 0.5;
  }

  /** The battle position under a screen point, or null if it's off the field (sky). */
  pick(sx: number, sy: number): { x: number; y: number } | null {
    const w = engine!.getRenderWidth();
    const h = engine!.getRenderHeight();
    const px = (sx * w) / VIEW_W;
    const py = (sy * h) / VIEW_H;
    const view = this.camera.getViewMatrix();
    const proj = this.camera.getProjectionMatrix();
    const near = Vector3.Unproject(new Vector3(px, py, 0), w, h, Matrix.Identity(), view, proj);
    const far = Vector3.Unproject(new Vector3(px, py, 1), w, h, Matrix.Identity(), view, proj);
    const dir = far.subtract(near).normalize();
    // March along the ray until it dips below the ground, then refine.
    let prev = near.clone();
    for (let d = 0; d < 6000; d += 6) {
      const p = near.add(dir.scale(d));
      const bx = p.x + FIELD_W / 2;
      const by = FIELD_H / 2 - p.z;
      const gy = bx >= 0 && by >= 0 && bx <= FIELD_W && by <= FIELD_H ? this.groundY(bx, by) : 0;
      if (p.y <= gy) {
        let lo = prev;
        let hi = p;
        for (let k = 0; k < 8; k++) {
          const mid = lo.add(hi).scale(0.5);
          const mx = mid.x + FIELD_W / 2;
          const my = FIELD_H / 2 - mid.z;
          if (mid.y <= this.groundY(mx, my)) hi = mid;
          else lo = mid;
        }
        const x = hi.x + FIELD_W / 2;
        const y = FIELD_H / 2 - hi.z;
        return { x: Math.max(0, Math.min(FIELD_W, x)), y: Math.max(0, Math.min(FIELD_H, y)) };
      }
      prev = p;
    }
    return null;
  }

  // ---------------------------------------------------------------- camera

  zoom(dy: number) {
    const c = this.camera;
    c.radius = Math.max(c.lowerRadiusLimit!, Math.min(c.upperRadiusLimit!, c.radius * Math.exp(dy * 0.0012)));
  }

  /** Pans by a screen-space drag (view pixels). */
  panScreen(dx: number, dy: number) {
    const k = this.camera.radius * 0.0016;
    this.panGround(-dx * k, dy * k / Math.max(0.4, Math.cos(this.camera.beta - 0.3)));
  }

  /** Moves the camera target across the ground: right and forward relative to the view. */
  panGround(right: number, fwd: number) {
    const c = this.camera;
    const a = c.alpha;
    // Camera looks from (cos a, sin a) toward the target: forward is the opposite of that.
    const fx = -Math.cos(a);
    const fz = -Math.sin(a);
    const rx = fz;
    const rz = -fx;
    const t = c.target;
    t.x = Math.max(-FIELD_W / 2, Math.min(FIELD_W / 2, t.x + rx * right + fx * fwd));
    t.z = Math.max(-FIELD_H / 2, Math.min(FIELD_H / 2, t.z + rz * right + fz * fwd));
    c.target = t;
  }

  rotate(da: number) {
    this.camera.alpha += da;
  }

  tilt(db: number) {
    const c = this.camera;
    c.beta = Math.max(c.lowerBetaLimit!, Math.min(c.upperBetaLimit!, c.beta + db));
  }

  resize() {
    engine?.resize();
  }

  dispose() {
    this.scene.dispose();
  }
}
