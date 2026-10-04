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

function toView(e: PointerEvent): [number, number] {
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
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  app.scene?.keyDown?.(e);
});

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
  'Banners of the Realm',
  h('div', {},
    h('p', {}, 'Four crowns contest a fractured land. You rule the Kingdom of Aldmere (blue).'),
    h('ul', { class: 'help' },
      h('li', {}, 'On the campaign map, march armies between provinces, take land for gold, and recruit regiments.'),
      h('li', {}, 'When armies clash, command the battle yourself. Plan orders while paused, then watch the round play out.'),
      h('li', {}, 'Destroy the three rival realms to win.'),
    ),
    h('p', { class: 'muted' }, `Map seed ${seed}. Add ?seed=${seed} to the URL to replay this map.`),
  ),
  [{ label: 'Raise your banner', primary: true, onClick: hideModal }],
);
