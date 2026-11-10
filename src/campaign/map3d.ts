import type { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { VIEW_H, VIEW_W } from '../app';
import { CELL, MH, MW, WH, WW } from '../geo';
import { engineFor } from '../three/engine';
import { groundGrain, plasterTexture, stoneTexture, waterRipples } from '../three/textures';
import type { Army, GameState } from './state';

/**
 * The campaign map in 3D (Babylon.js): India in relief from the map's own
 * elevation, the painted map (realm colours, borders, rivers) draped over it,
 * a rippling sea, and little forts, towns and ports at every settlement, with a
 * company of soldiers under each army's banner. The 2D canvas on top still
 * draws banners, names and routes; this only replaces the flat map layer.
 */

/** Height (world px) of the highest ground. */
const HS = 55;
/** Map cells per terrain vertex. */
const K = 2;
const GW = Math.ceil(MW / K) + 1;
const GH = Math.ceil(MH / K) + 1;
const WATER = 0.8;

const toX = (x: number) => x - WW / 2;
const toZ = (y: number) => WH / 2 - y;

/** Thin-instance helper: one mesh drawn many times with per-instance matrices (and colours). */
class Many {
  private mats = new Float32Array(16 * 32);
  private cols: Float32Array | null;
  private n = 0;
  private m = new Matrix();
  private q = new Quaternion();
  constructor(readonly mesh: Mesh, coloured: boolean) {
    this.cols = coloured ? new Float32Array(4 * 32) : null;
    mesh.thinInstanceSetBuffer('matrix', this.mats, 16, false);
    if (this.cols) mesh.thinInstanceSetBuffer('color', this.cols, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.alwaysSelectAsActiveMesh = true;
  }
  begin() {
    this.n = 0;
  }
  add(x: number, y: number, z: number, yaw: number, s: [number, number, number], col?: [number, number, number]) {
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
    Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, this.q);
    Matrix.ComposeToRef(new Vector3(s[0], s[1], s[2]), this.q, new Vector3(x, y, z), this.m);
    this.m.copyToArray(this.mats, this.n * 16);
    if (this.cols) this.cols.set([...(col ?? [1, 1, 1]), 1], this.n * 4);
    this.n++;
  }
  end() {
    this.mesh.thinInstanceCount = this.n;
    this.mesh.thinInstanceBufferUpdated('matrix');
    if (this.cols) this.mesh.thinInstanceBufferUpdated('color');
  }
}

export class Map3D {
  private engine: Engine;
  private scene: Scene;
  readonly camera: ArcRotateCamera;
  private heights = new Float32Array(GW * GH);
  private skin: HTMLCanvasElement;
  private skinTex: DynamicTexture;
  private skinScale: number;
  private ripples: Texture;
  private water: Mesh;
  private troops: { body: Many; head: Many; horse: Many };

  constructor(canvas: HTMLCanvasElement, state: GameState) {
    this.engine = engineFor(canvas);
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.62, 0.74, 0.82, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.00024;
    scene.fogColor = new Color3(0.62, 0.74, 0.82);

    const cam = new ArcRotateCamera('mapCam', -Math.PI / 2, 0.82, 620, Vector3.Zero(), scene);
    cam.minZ = 2;
    cam.maxZ = 12000;
    cam.fov = 0.7;
    cam.lowerBetaLimit = 0.15;
    cam.upperBetaLimit = 1.25;
    cam.lowerRadiusLimit = 90;
    cam.upperRadiusLimit = 3400;
    this.camera = cam;

    const sky = new HemisphericLight('mapSky', new Vector3(0.1, 1, -0.2), scene);
    sky.intensity = 0.78;
    sky.groundColor = new Color3(0.4, 0.38, 0.32);
    const sun = new DirectionalLight('mapSun', new Vector3(0.6, -0.8, 0.5), scene);
    sun.intensity = 0.7;
    sun.diffuse = new Color3(1, 0.95, 0.85);

    // The painted map is the ground's skin: as sharp as the GPU allows, up to 2 texels per world px.
    const maxTex = this.engine.getCaps().maxTextureSize;
    this.skinScale = Math.min(2, (maxTex * 0.98) / Math.max(WW, WH));
    this.skin = document.createElement('canvas');
    this.skin.width = Math.round(WW * this.skinScale);
    this.skin.height = Math.round(WH * this.skinScale);
    this.skinTex = new DynamicTexture('mapSkin', this.skin, scene, true);
    this.skinTex.anisotropicFilteringLevel = 8;

    this.buildHeights(state);
    this.buildGround();
    this.ripples = waterRipples(scene);
    this.water = this.buildWater();
    this.buildSettlements(state);
    const body = CreateCylinder('tBody', { height: 2.6, diameterTop: 0.8, diameterBottom: 1.2, tessellation: 6 }, scene);
    body.bakeTransformIntoVertices(Matrix.Translation(0, 1.3, 0));
    body.material = this.mat('tBodyM', [1, 1, 1]);
    const head = CreateSphere('tHead', { diameter: 0.9, segments: 4 }, scene);
    head.bakeTransformIntoVertices(Matrix.Translation(0, 3.05, 0));
    head.material = this.mat('tHeadM', [0.62, 0.45, 0.32]);
    const horse = CreateBox('tHorse', { width: 1, height: 1.5, depth: 3 }, scene);
    horse.bakeTransformIntoVertices(Matrix.Translation(0, 1.6, 0));
    horse.material = this.mat('tHorseM', [1, 1, 1]);
    this.troops = { body: new Many(body, true), head: new Many(head, false), horse: new Many(horse, true) };
  }

  // ---------------------------------------------------------------- terrain

  private buildHeights(state: GameState) {
    const { elev } = state.map;
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        // Average the cells around the vertex so ridges are smooth rather than stepped.
        let sum = 0;
        let n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const cx = Math.max(0, Math.min(MW - 1, i * K + dx));
            const cy = Math.max(0, Math.min(MH - 1, j * K + dy));
            sum += elev[cy * MW + cx];
            n++;
          }
        }
        const e = sum / n;
        // Land rises from just above the waterline; the sea floor falls away below it.
        let h = e > 0 ? WATER + 0.6 + Math.pow(e, 1.25) * HS : e * 30;
        // Towards the map's edges the land settles down, so there is no cliff where the map ends.
        const edge = Math.min(i, j, GW - 1 - i, GH - 1 - j);
        if (edge < 14 && h > WATER) h = WATER + 0.6 + (h - WATER - 0.6) * (edge / 14);
        this.heights[j * GW + i] = h;
      }
    }
  }

  /** Ground height (world units) under a map position. */
  groundY(x: number, y: number): number {
    const fx = Math.max(0, Math.min(GW - 1.001, x / (CELL * K)));
    const fy = Math.max(0, Math.min(GH - 1.001, y / (CELL * K)));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const H = this.heights;
    const a = H[j * GW + i] * (1 - u) + H[j * GW + i + 1] * u;
    const c = H[(j + 1) * GW + i] * (1 - u) + H[(j + 1) * GW + i + 1] * u;
    return a * (1 - v) + c * v;
  }

  /** Height of the surface (land or sea) at a map position. */
  surfaceY(x: number, y: number): number {
    return Math.max(WATER, this.groundY(x, y));
  }

  private buildGround() {
    const scene = this.scene;
    const w = (GW - 1) * CELL * K;
    const h = (GH - 1) * CELL * K;
    const ground = CreateGround('land', { width: w, height: h, subdivisionsX: GW - 1, subdivisionsY: GH - 1, updatable: true }, scene);
    ground.position.set(w / 2 - WW / 2, 0, WH / 2 - h / 2);
    const pos = ground.getVerticesData(VertexBuffer.PositionKind)!;
    for (let k = 0; k < pos.length; k += 3) {
      const x = pos[k] + w / 2;
      const y = h / 2 - pos[k + 2];
      pos[k + 1] = this.groundY(x, y);
    }
    ground.updateVerticesData(VertexBuffer.PositionKind, pos);
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, ground.getIndices()!, normals);
    ground.updateVerticesData(VertexBuffer.NormalKind, normals);
    // The skin covers exactly the map; the mesh can overhang it by a cell or two.
    this.skinTex.uScale = w / WW;
    this.skinTex.vScale = h / WH;
    this.skinTex.vOffset = 1 - h / WH;
    const mat = new StandardMaterial('landMat', scene);
    mat.diffuseTexture = this.skinTex;
    const grain = groundGrain(scene);
    grain.uScale = 90;
    grain.vScale = 90;
    mat.bumpTexture = grain;
    mat.bumpTexture.level = 0.45;
    mat.specularColor = new Color3(0.06, 0.06, 0.05);
    // A little self-light keeps the realm colours bright, as on the painted map.
    mat.emissiveColor = new Color3(0.3, 0.29, 0.27);
    ground.material = mat;
    // Sea floor beyond the map, the same deep blue as the painted sea, so there is no seam.
    const floor = CreateGround('seaFloor', { width: WW * 4, height: WH * 4 }, scene);
    floor.position.y = -26;
    const fm = new StandardMaterial('seaFloorMat', scene);
    fm.diffuseColor = new Color3(104 / 255, 152 / 255, 190 / 255);
    fm.emissiveColor = new Color3(0.2, 0.25, 0.3);
    fm.specularColor = Color3.Black();
    floor.material = fm;
  }

  private buildWater(): Mesh {
    const scene = this.scene;
    const sea = CreateGround('sea', { width: WW * 4, height: WH * 4, subdivisions: 2 }, scene);
    sea.position.y = WATER;
    const m = new StandardMaterial('seaMat', scene);
    // Deep blue, nearly opaque, so the open sea and the painted sea read as one water.
    m.diffuseColor = new Color3(0.36, 0.56, 0.7);
    m.specularColor = new Color3(0.55, 0.6, 0.62);
    m.specularPower = 90;
    m.alpha = 0.9;
    m.bumpTexture = this.ripples;
    this.ripples.uScale = 70;
    this.ripples.vScale = 70;
    this.ripples.level = 0.6;
    sea.material = m;
    return sea;
  }

  private mat(name: string, c: [number, number, number], tex?: Texture): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = new Color3(c[0], c[1], c[2]);
    if (tex) m.diffuseTexture = tex;
    m.specularColor = new Color3(0.05, 0.05, 0.05);
    return m;
  }

  /** Forts get towers and a curtain wall, cities a huddle of houses, ports a quay; capitals are larger. */
  private buildSettlements(state: GameState) {
    const scene = this.scene;
    const stone = this.mat('fortStone', [1, 1, 1], stoneTexture(scene));
    const plaster = this.mat('plaster', [1, 1, 1], plasterTexture(scene));
    const tower = CreateCylinder('mTower', { height: 1, diameter: 1, tessellation: 8 }, scene);
    tower.material = stone;
    const wall = CreateCylinder('mWall', { height: 1, diameter: 1, tessellation: 10 }, scene);
    wall.material = stone;
    const house = CreateBox('mHouse', { size: 1 }, scene);
    house.material = plaster;
    const roof = CreateCylinder('mRoof', { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 4 }, scene);
    roof.material = this.mat('mRoofM', [0.55, 0.3, 0.18]);
    const quay = CreateBox('mQuay', { size: 1 }, scene);
    quay.material = this.mat('mQuayM', [0.45, 0.34, 0.22]);
    const towers = new Many(tower, false);
    const walls = new Many(wall, false);
    const houses = new Many(house, false);
    const roofs = new Many(roof, false);
    const quays = new Many(quay, false);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const p of state.provinces) {
      const y0 = this.surfaceY(p.x, p.y);
      const X = toX(p.x);
      const Z = toZ(p.y);
      const big = p.capitalOf >= 0 ? 1.4 : 1;
      if (p.kind === 'fort') {
        const r = (2.2 + p.walls * 0.5) * big;
        walls.add(X, y0 + 0.7, Z, 0, [r * 2, 1.4, r * 2]);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + 0.4;
          towers.add(X + Math.cos(a) * r, y0 + 1.4, Z + Math.sin(a) * r, 0, [0.9, 2.8, 0.9]);
        }
        towers.add(X, y0 + 2.2 * big, Z, 0, [1.6 * big, 4.4 * big, 1.6 * big]);
      } else {
        const n = Math.round((4 + Math.min(6, p.wealth / 2)) * big);
        for (let k = 0; k < n; k++) {
          const a = rand() * Math.PI * 2;
          const d = rand() * 3.2 * big;
          const hx = X + Math.cos(a) * d;
          const hz = Z + Math.sin(a) * d;
          const yaw = rand() * Math.PI;
          const s = 0.9 + rand() * 0.7;
          houses.add(hx, y0 + 0.6 * s, hz, yaw, [1.4 * s, 1.2 * s, 1.8 * s]);
          roofs.add(hx, y0 + 1.6 * s, hz, yaw + Math.PI / 4, [1.9 * s, 0.9 * s, 1.9 * s]);
        }
        if (p.walls > 0) walls.add(X, y0 + 0.5, Z, 0, [8 * big, 1, 8 * big]);
        if (p.kind === 'port') quays.add(X - 4, WATER + 0.3, Z - 3, 0.4, [6, 0.6, 1.6]);
      }
    }
    // Villages: three or four huts each, out in the countryside.
    for (const v of state.villages) {
      const y0 = this.surfaceY(v.x, v.y);
      const n = 3 + (v.wealth > 14 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        const d = 0.6 + rand() * 1.6;
        const hx = toX(v.x) + Math.cos(a) * d;
        const hz = toZ(v.y) + Math.sin(a) * d;
        const yaw = rand() * Math.PI;
        houses.add(hx, y0 + 0.4, hz, yaw, [0.9, 0.8, 1.1]);
        roofs.add(hx, y0 + 1.1, hz, yaw + Math.PI / 4, [1.3, 0.6, 1.3]);
      }
    }
    for (const m of [towers, walls, houses, roofs, quays]) m.end();
  }

  // ---------------------------------------------------------------- per frame

  /** Repaints the map skin (realm colours change, a province is selected...). */
  paint(draw: (g: CanvasRenderingContext2D, scale: number) => void) {
    const g = this.skin.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#26476e';
    g.fillRect(0, 0, this.skin.width, this.skin.height);
    draw(g, this.skinScale);
    this.skinTex.update(true);
  }

  render(t: number, armies: Army[], color: (owner: number) => [number, number, number], cavalry: (a: Army) => boolean) {
    // The sea moves.
    this.ripples.uOffset = (t * 0.012) % 1;
    this.ripples.vOffset = (t * 0.007) % 1;
    // A company of men under each banner, facing its line of march.
    const { body, head, horse } = this.troops;
    body.begin();
    head.begin();
    horse.begin();
    for (const a of armies) {
      const n = Math.min(9, 3 + Math.floor(a.units.length / 3));
      const next = a.route[0];
      const yaw = next ? Math.atan2(next.x - a.x, -(next.y - a.y)) : Math.PI;
      const c = color(a.owner);
      const mounted = cavalry(a);
      const moving = a.route.length > 0;
      for (let k = 0; k < n; k++) {
        const row = Math.floor(k / 3);
        const col = (k % 3) - 1;
        const lx = col * 2.6;
        const lz = -row * 3 - 2.5;
        const x = toX(a.x) + Math.cos(yaw) * lx + Math.sin(yaw) * lz;
        const z = toZ(a.y) - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
        const bx = x + WW / 2;
        const by = WH / 2 - z;
        const y = this.surfaceY(bx, by) + (moving ? Math.abs(Math.sin(t * 8 + k)) * 0.3 : 0);
        const S = 1.1;
        if (mounted) {
          horse.add(x, y, z, yaw, [S, S, S], [0.45, 0.32, 0.22]);
          body.add(x, y + 1.6 * S, z, yaw, [0.9 * S, 0.9 * S, 0.9 * S], c);
          head.add(x, y + 1.6 * S, z, yaw, [0.9 * S, 0.9 * S, 0.9 * S]);
        } else {
          body.add(x, y, z, yaw, [S, S, S], c);
          head.add(x, y, z, yaw, [S, S, S]);
        }
      }
    }
    body.end();
    head.end();
    horse.end();
    this.engine.beginFrame();
    this.scene.render();
    this.engine.endFrame();
  }

  // ---------------------------------------------------------------- picking, projection, camera

  project(x: number, y: number, lift = 0): [number, number] {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const p = Vector3.Project(new Vector3(toX(x), this.surfaceY(x, y) + lift, toZ(y)), Matrix.Identity(),
      this.camera.getViewMatrix().multiply(this.camera.getProjectionMatrix()), this.camera.viewport.toGlobal(w, h));
    if (p.z < 0 || p.z > 1) return [-9999, -9999];
    return [(p.x * VIEW_W) / w, (p.y * VIEW_H) / h];
  }

  /** Screen pixels per world px at the centre of the view: the 3D counterpart of the 2D zoom. */
  zoomScale(): number {
    const t = this.camera.target;
    const x = t.x + WW / 2;
    const y = WH / 2 - t.z;
    const a = this.project(x - 10, y);
    const b = this.project(x + 10, y);
    return Math.max(0.2, Math.hypot(a[0] - b[0], a[1] - b[1]) / 20);
  }

  pick(sx: number, sy: number): [number, number] | null {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const px = (sx * w) / VIEW_W;
    const py = (sy * h) / VIEW_H;
    const view = this.camera.getViewMatrix();
    const proj = this.camera.getProjectionMatrix();
    const near = Vector3.Unproject(new Vector3(px, py, 0), w, h, Matrix.Identity(), view, proj);
    const far = Vector3.Unproject(new Vector3(px, py, 1), w, h, Matrix.Identity(), view, proj);
    const dir = far.subtract(near).normalize();
    const step = Math.max(1, this.camera.radius / 300);
    let prev = near.clone();
    for (let d = 0; d < 14000; d += step) {
      const p = near.add(dir.scale(d));
      const bx = p.x + WW / 2;
      const by = WH / 2 - p.z;
      if (p.y <= this.surfaceY(bx, by)) {
        let lo = prev;
        let hi = p;
        for (let k = 0; k < 10; k++) {
          const mid = lo.add(hi).scale(0.5);
          if (mid.y <= this.surfaceY(mid.x + WW / 2, WH / 2 - mid.z)) hi = mid;
          else lo = mid;
        }
        return [hi.x + WW / 2, WH / 2 - hi.z];
      }
      prev = p;
    }
    return null;
  }

  zoomBy(factor: number) {
    const c = this.camera;
    c.radius = Math.max(c.lowerRadiusLimit!, Math.min(c.upperRadiusLimit!, c.radius / factor));
  }

  setTarget(x: number, y: number) {
    // Move the target in place: assigning a new one would keep the camera where it is and change the zoom.
    this.camera.target.set(toX(Math.max(0, Math.min(WW, x))), 0, toZ(Math.max(0, Math.min(WH, y))));
  }

  panGround(right: number, fwd: number) {
    const c = this.camera;
    const fx = -Math.cos(c.alpha);
    const fz = -Math.sin(c.alpha);
    const t = c.target;
    const x = t.x + fz * right + fx * fwd;
    const z = t.z - fx * right + fz * fwd;
    c.target.set(Math.max(-WW / 2, Math.min(WW / 2, x)), 0, Math.max(-WH / 2, Math.min(WH / 2, z)));
  }

  panScreen(dx: number, dy: number) {
    const k = this.camera.radius * 0.0014;
    this.panGround(-dx * k, (dy * k) / Math.max(0.4, Math.cos(this.camera.beta - 0.3)));
  }

  rotate(da: number) {
    this.camera.alpha += da;
  }

  tilt(db: number) {
    const c = this.camera;
    c.beta = Math.max(c.lowerBetaLimit!, Math.min(c.upperBetaLimit!, c.beta + db));
  }

  resize() {
    this.engine.resize();
  }

  dispose() {
    this.scene.dispose();
  }
}
