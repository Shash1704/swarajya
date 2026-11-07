import './style.css';
import { app, VIEW_H, VIEW_W } from './app';
import { CampaignScene } from './campaign/scene';
import { newGame } from './campaign/state';
import { h, hideModal, showModal } from './ui';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const stage = document.getElementById('stage')!;
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext('2d')!;

// Scale the fixed-resolution canvas to fit the stage while keeping its aspect ratio.
function fit() {
  const pad = 20;
  const scale = Math.min((stage.clientWidth - pad) / VIEW_W, (stage.clientHeight - pad) / VIEW_H);
  const s = Math.max(0.2, scale || 1);
  canvas.style.width = `${Math.floor(VIEW_W * s)}px`;
  canvas.style.height = `${Math.floor(VIEW_H * s)}px`;
}
new ResizeObserver(fit).observe(stage);
fit();

function toView(e: MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) * VIEW_W) / r.width, ((e.clientY - r.top) * VIEW_H) / r.height];
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = toView(e);
  app.scene?.pointerDown?.(x, y, e.button, e);
});
canvas.addEventListener('pointermove', (e) => {
  const [x, y] = toView(e);
  app.scene?.pointerMove?.(x, y, e);
});
canvas.addEventListener('pointerup', (e) => {
  const [x, y] = toView(e);
  app.scene?.pointerUp?.(x, y, e.button, e);
});
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
  'Swarajya: Winter 1670',
  h('div', {},
    h('p', {}, 'Five years ago, at Purandar, Shivaji surrendered twenty-three forts to the Mughal general Jai Singh. Now Aurangzeb is distracted, and the Marathas are ready to take them back.'),
    h('ul', { class: 'help' },
      h('li', {}, 'You lead the Marathas (saffron) from Raigad. Kondhana (Sinhagad), Purandar and Shivneri are in Mughal hands.'),
      h('li', {}, 'Besiege walled towns: starve them out, or storm them. Mavalas scale walls from the first day.'),
      h('li', {}, 'Raid for chauth, sack rich towns like Surat, and stay out of the Mughal field armies’ way until you are ready.'),
      h('li', {}, 'Battles are real-time with pause: deploy, then press Space to begin.'),
    ),
    h('p', { class: 'muted' }, `Map seed ${seed}. Drag to pan, scroll to zoom.`),
  ),
  [{ label: 'Har Har Mahadev!', primary: true, onClick: hideModal }],
);
