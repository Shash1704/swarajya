import './style.css';
import { app, VIEW_H, VIEW_W } from './app';
import { CampaignScene } from './campaign/scene';
import { newGame } from './campaign/state';
import { h, hideModal, showModal } from './ui';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const canvas3d = document.getElementById('view3d') as HTMLCanvasElement;
const stage = document.getElementById('stage')!;
const ctx = canvas.getContext('2d')!;

// Fit the canvas to the stage, keeping the 3:2 logical view, and back it with
// enough device pixels that lines and text stay sharp on high-DPI screens.
function fit() {
  const pad = 20;
  const scale = Math.min((stage.clientWidth - pad) / VIEW_W, (stage.clientHeight - pad) / VIEW_H);
  const s = Math.max(0.2, scale || 1);
  const cssW = Math.floor(VIEW_W * s);
  const cssH = Math.floor(VIEW_H * s);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  // The 3D canvas lies exactly under the 2D one.
  canvas3d.style.width = `${cssW}px`;
  canvas3d.style.height = `${cssH}px`;
  canvas3d.style.left = `${canvas.offsetLeft}px`;
  canvas3d.style.top = `${canvas.offsetTop}px`;
  app.scene?.resize?.();
}
new ResizeObserver(fit).observe(stage);
fit();

function toView(e: MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) * VIEW_W) / r.width, ((e.clientY - r.top) * VIEW_H) / r.height];
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Touch screens: one finger works like the left mouse button (tap to select, drag
// to pan or box-select), a long press acts as a right-click (give orders), and two
// fingers pinch to zoom.
const touches = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
let press: { timer: number; x: number; y: number; fired: boolean } | null = null;
const LONG_PRESS_MS = 450;

const touchSpread = () => {
  const [a, b] = [...touches.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
};
const cancelPress = () => {
  if (press) clearTimeout(press.timer);
  press = null;
};

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = toView(e);
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      cancelPress();
      pinchDist = touchSpread().d;
      return;
    }
    press = {
      x: e.clientX, y: e.clientY, fired: false,
      timer: window.setTimeout(() => {
        if (!press) return;
        press.fired = true;
        navigator.vibrate?.(15);
        app.scene?.pointerDown?.(x, y, 2, e);
      }, LONG_PRESS_MS),
    };
  }
  app.scene?.pointerDown?.(x, y, e.button, e);
});
canvas.addEventListener('pointermove', (e) => {
  const [x, y] = toView(e);
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      const { d, cx, cy } = touchSpread();
      const r = canvas.getBoundingClientRect();
      if (pinchDist > 0 && d > 0) {
        // Reuse the scroll-wheel zoom: deltaY such that exp(-dy * 0.0015) = d / pinchDist.
        const dy = -Math.log(d / pinchDist) / 0.0015;
        app.scene?.wheel?.(((cx - r.left) * VIEW_W) / r.width, ((cy - r.top) * VIEW_H) / r.height, dy, e as unknown as WheelEvent);
      }
      pinchDist = d;
      return;
    }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
  }
  app.scene?.pointerMove?.(x, y, e);
});
const release = (e: PointerEvent) => {
  const [x, y] = toView(e);
  if (e.pointerType === 'touch') {
    const pinching = touches.size >= 2;
    touches.delete(e.pointerId);
    if (pinching) return;
    const longPressed = press?.fired;
    cancelPress();
    // After a long press the finger lifting should not also count as a tap.
    app.scene?.pointerUp?.(x, y, longPressed ? 2 : e.button, e);
    return;
  }
  app.scene?.pointerUp?.(x, y, e.button, e);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [x, y] = toView(e);
  app.scene?.wheel?.(x, y, e.deltaY, e);
}, { passive: false });
const typing = (e: KeyboardEvent) => ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement | null)?.tagName ?? '');
window.addEventListener('keydown', (e) => {
  if (!typing(e)) app.scene?.keyDown?.(e);
});
window.addEventListener('keyup', (e) => app.scene?.keyUp?.(e));

let last = performance.now();
function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  app.scene?.update(dt);
  ctx.setTransform(canvas.width / VIEW_W, 0, 0, canvas.height / VIEW_H, 0, 0);
  app.scene?.draw(ctx);
  requestAnimationFrame(frame);
}

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
app.setScene(new CampaignScene(newGame(seed)));
// ?debug exposes the app on window for poking at state from the devtools console.
if (params.has('debug')) Object.assign(window, { banners: app });
requestAnimationFrame(frame);

showModal(
  'Swarajya: January 1670',
  h('div', {},
    h('p', {}, 'Five years ago, at Purandar, Shivaji surrendered twenty-three forts to the Mughal general Jai Singh. Now Aurangzeb is distracted, and the Marathas are ready to take them back.'),
    h('ul', { class: 'help' },
      h('li', {}, 'Time flows in real time. Press Space to pause or resume, and 1/2/3 to change speed. Every realm marches, fights and besieges at the same moment.'),
      h('li', {}, 'Select your saffron army, then right-click a town to march on it, or an enemy army to hunt it down.'),
      h('li', {}, 'Before an enemy town, choose: besiege it, storm it, or raid its villages. Starving garrisons surrender; captured towns can be sacked or occupied.'),
      h('li', {}, 'When armies meet, battle is joined: command it yourself (real-time with pause), auto-resolve it, or try to escape.'),
      h('li', {}, 'On a phone or tablet: tap to select, drag to pan, pinch to zoom, and long-press where you would right-click.'),
    ),
    h('p', { class: 'muted' }, `Map seed ${seed}. Drag to pan, scroll to zoom. The world is paused until you press Space.`),
  ),
  [{ label: 'Har Har Mahadev!', primary: true, onClick: hideModal }],
);
