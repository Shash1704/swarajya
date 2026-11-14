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
import { buildClouds, buildForests, buildSettlements, daylight, Many, type Settlements, type Sky, toX, toZ } from './mapLife';

/**
 * The campaign map in 3D (Babylon.js): India in relief from the map's own
 * elevation, the painted map (realm colours, borders, rivers) draped over it,
 * a rippling sea, and little forts, towns and ports at every settlement, with a
 * company of soldiers under each army's banner. The 2D canvas on top still
 * draws banners, names and routes; this only replaces the flat map layer.
 */

/** Height (world px) of the highest ground. */
const HS = 64;
/** Map cells per terrain vertex. */
const K = 2;
const GW = Math.ceil(MW / K) + 1;
const GH = Math.ceil(MH / K) + 1;
const WATER = 0.8;

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
  private troops: { body: Many; head: Many; horse: Many; flag: Many; pole: Many };
  private towns: Settlements;
  private sky: Sky;
  private sun: DirectionalLight;
  private hemi: HemisphericLight;
  private landMat!: StandardMaterial;

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
    cam.upperBetaLimit = 1.32;
    cam.lowerRadiusLimit = 32;
    cam.upperRadiusLimit = 5200;
    this.camera = cam;

    const sky = new HemisphericLight('mapSky', new Vector3(0.1, 1, -0.2), scene);
    sky.intensity = 0.78;
    sky.groundColor = new Color3(0.4, 0.38, 0.32);
    const sun = new DirectionalLight('mapSun', new Vector3(0.6, -0.8, 0.5), scene);
    sun.intensity = 0.7;
    sun.diffuse = new Color3(1, 0.95, 0.85);
    this.sun = sun;
    this.hemi = sky;

    // The painted map is the ground's skin: as sharp as the GPU allows, up to 2 texels per world px.
    const maxTex = this.engine.getCaps().maxTextureSize;
    // Sharp enough to read, small enough not to eat the GPU's memory on a map this size.
    this.skinScale = Math.min(2, (maxTex * 0.98) / Math.max(WW, WH), 4300 / Math.max(WW, WH));
    this.skin = document.createElement('canvas');
    this.skin.width = Math.round(WW * this.skinScale);
    this.skin.height = Math.round(WH * this.skinScale);
    this.skinTex = new DynamicTexture('mapSkin', this.skin, scene, true);
    this.skinTex.anisotropicFilteringLevel = 8;

    this.buildHeights(state);
    this.buildGround();
    this.ripples = waterRipples(scene);
    this.water = this.buildWater();
    const ground = (x: number, y: number) => this.groundY(x, y);
    this.towns = buildSettlements(scene, state, ground, WATER, { stone: stoneTexture(scene), plaster: plasterTexture(scene) });
    buildForests(scene, state, ground);
    this.sky = buildClouds(scene);
    const body = CreateCylinder('tBody', { height: 2.6, diameterTop: 0.8, diameterBottom: 1.2, tessellation: 6 }, scene);
    body.bakeTransformIntoVertices(Matrix.Translation(0, 1.3, 0));
    body.material = this.mat('tBodyM', [1, 1, 1]);
    const head = CreateSphere('tHead', { diameter: 0.9, segments: 4 }, scene);
    head.bakeTransformIntoVertices(Matrix.Translation(0, 3.05, 0));
    head.material = this.mat('tHeadM', [0.62, 0.45, 0.32]);
    const horse = CreateBox('tHorse', { width: 1, height: 1.5, depth: 3 }, scene);
    horse.bakeTransformIntoVertices(Matrix.Translation(0, 1.6, 0));
    horse.material = this.mat('tHorseM', [1, 1, 1]);
    const flag = CreateBox('tFlag', { width: 2.2, height: 1.4, depth: 0.1 }, scene);
    flag.material = this.mat('tFlagM', [1, 1, 1]);
    (flag.material as StandardMaterial).emissiveColor = new Color3(0.25, 0.25, 0.25);
    const pole = CreateCylinder('tPole', { height: 1, diameter: 0.18, tessellation: 4 }, scene);
    pole.material = this.mat('tPoleM', [0.35, 0.26, 0.18]);
    this.troops = { body: new Many(body, true), head: new Many(head, false), horse: new Many(horse, true), flag: new Many(flag, true), pole: new Many(pole, false) };
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
    this.landMat = mat;
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

  /**
   * t: real seconds (for motion); hour: 0..1 through the day of the light (noon at 0.5).
   */
  render(t: number, hour: number, state: GameState, color: (owner: number) => [number, number, number], cavalry: (a: Army) => boolean) {
    const armies = state.armies;
    // The camera looks at the ground under its target (the hills are high now), and never sinks into a hillside.
    const cam = this.camera;
    const gx = cam.target.x + WW / 2;
    const gz = WH / 2 - cam.target.z;
    const want = this.surfaceY(gx, gz);
    cam.target.y += (want - cam.target.y) * 0.2;
    const cp = cam.position;
    const under = this.surfaceY(cp.x + WW / 2, WH / 2 - cp.z) + 6;
    if (cp.y < under) cam.beta = Math.max(cam.lowerBetaLimit!, cam.beta - 0.02);
    // The sea moves.
    this.ripples.uOffset = (t * 0.012) % 1;
    this.ripples.vOffset = (t * 0.007) % 1;
    // The light of the hour: the sun swings over, dusk reddens the sky, and at night the lamps are lit.
    const L = daylight(hour);
    const az = hour * Math.PI * 2;
    this.sun.direction.set(Math.cos(az) * 0.7, -Math.max(0.25, L.sun), Math.sin(az) * 0.5 + 0.3);
    this.sun.intensity = 0.1 + 0.62 * L.day;
    this.sun.diffuse.set(1, 0.95 - L.dusk * 0.3, 0.85 - L.dusk * 0.45);
    this.hemi.intensity = 0.42 + 0.36 * L.day;
    this.hemi.diffuse.set(0.75 + 0.25 * L.day, 0.8 + 0.2 * L.day, 1);
    const mix = (d: number[], k: number[], n: number[]) => [0, 1, 2].map((i) => (d[i] * L.day + n[i] * L.night) * (1 - L.dusk * 0.6) + k[i] * L.dusk * 0.6);
    const skyC = mix([0.62, 0.74, 0.82], [0.86, 0.6, 0.45], [0.16, 0.2, 0.32]);
    this.scene.clearColor.set(skyC[0], skyC[1], skyC[2], 1);
    this.scene.fogColor.set(skyC[0], skyC[1], skyC[2]);
    const glow = 0.12 + 0.18 * L.day;
    this.landMat.emissiveColor.set(glow, glow * 0.97, glow * 0.92 + 0.03 * L.night);
    this.towns.update(t, (p) => color(state.provinces[p].owner), L.night);
    this.sky.update(t, this.camera.radius);
    // A company of men under each banner, facing its line of march, with its standard.
    const { body, head, horse, flag, pole } = this.troops;
    body.begin();
    head.begin();
    horse.begin();
    flag.begin();
    pole.begin();
    for (const a of armies) {
      if (a.follows !== undefined) continue; // marching with another army's host
      const n = Math.min(15, 4 + Math.floor(a.units.length / 2));
      const next = a.route[0];
      const yaw = next ? Math.atan2(next.x - a.x, -(next.y - a.y)) : Math.PI;
      const c = color(a.owner);
      const mounted = cavalry(a);
      const moving = a.route.length > 0;
      // The standard rides at the head of the column.
      {
        const fy = this.surfaceY(a.x, a.y);
        const fx = toX(a.x) + Math.sin(yaw) * 1.5;
        const fz = toZ(a.y) + Math.cos(yaw) * 1.5;
        pole.add(fx, fy + 3.5, fz, 0, [1, 7, 1]);
        const sway = Math.sin(t * 2.4 + a.id) * 0.25;
        flag.add(fx + Math.cos(yaw + sway) * 1.1, fy + 6.2, fz - Math.sin(yaw + sway) * 1.1, yaw + Math.PI / 2 + sway, [1, 1, 1], c);
      }
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
    flag.end();
    pole.end();
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
    this.camera.target.set(toX(Math.max(0, Math.min(WW, x))), this.surfaceY(x, y), toZ(Math.max(0, Math.min(WH, y))));
  }

  panGround(right: number, fwd: number) {
    const c = this.camera;
    const fx = -Math.cos(c.alpha);
    const fz = -Math.sin(c.alpha);
    const t = c.target;
    const x = t.x + fz * right + fx * fwd;
    const z = t.z - fx * right + fz * fwd;
    c.target.set(Math.max(-WW / 2, Math.min(WW / 2, x)), c.target.y, Math.max(-WH / 2, Math.min(WH / 2, z)));
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
