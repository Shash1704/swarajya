type Child = Node | string | number | null | undefined | false;

/** Tiny DOM builder: h('div', { class: 'card', onclick: fn }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'disabled') (el as HTMLButtonElement).disabled = Boolean(v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

export function clear<T extends HTMLElement>(el: T): T {
  el.replaceChildren();
  return el;
}

/** Replaces an element's children, skipping null/false entries. */
export function fill<T extends HTMLElement>(el: T, ...children: Child[]): T {
  clear(el);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

export function swatch(color: string): HTMLElement {
  return h('span', { class: 'swatch', style: `background:${color}` });
}

export function bar(frac: number, color = 'var(--gold)'): HTMLElement {
  const pct = Math.max(0, Math.min(1, frac)) * 100;
  return h('div', { class: 'bar' }, h('i', { style: `width:${pct.toFixed(0)}%;background:${color}` }));
}

export const ui = {
  get top() { return document.getElementById('topbar')!; },
  get side() { return document.getElementById('side')!; },
  get modal() { return document.getElementById('modal')!; },
};

export interface ModalButton {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export function showModal(title: string, body: Node | string, buttons: ModalButton[], opts: { wide?: boolean } = {}) {
  const m = clear(ui.modal);
  m.append(
    h('div', { class: `dialog${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
      h('h2', {}, title),
      typeof body === 'string' ? h('p', {}, body) : body,
      h('div', { class: 'actions' },
        ...buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: b.onClick }, b.label)),
      ),
    ),
  );
  m.classList.remove('hidden');
  (m.querySelector('button.primary') as HTMLButtonElement | null)?.focus({ preventScroll: true });
}

export function hideModal() {
  ui.modal.classList.add('hidden');
  clear(ui.modal);
}

export function modalOpen(): boolean {
  return !ui.modal.classList.contains('hidden');
}
