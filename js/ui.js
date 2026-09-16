/* ui.js — toasts, modals, confirm dialogs and popup menus. */
import { el, $, icon, uid, trapFocus, announce } from './utils.js';

/* ---------- toasts ---------- */
const MAX_TOASTS = 4;
export function toast(message, { type = '', timeout = 3800, action = null } = {}) {
  const host = $('#toasts');
  if (!host) return () => {};
  while (host.children.length >= MAX_TOASTS) host.firstElementChild.remove();

  let closed = false;
  const node = el('div', { class: `toast${type ? ' toast--' + type : ''}` }, el('span', {}, message));
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 600);               // belt and braces if animation is suppressed
  };
  if (action) {
    node.appendChild(el('button', { class: 'toast__act', type: 'button', onclick: () => { close(); action.onClick(); } }, action.label));
  } else {
    node.appendChild(el('button', { class: 'toast__x', type: 'button', 'aria-label': 'Dismiss', onclick: close }, '×'));
  }
  host.appendChild(node);
  announce(message);
  const timer = timeout ? setTimeout(close, timeout) : null;
  return close;
}

/* ---------- modal ---------- */
let openModals = 0;
/**
 * Show a modal. `build(api)` receives { close, body, foot } and returns nothing;
 * resolves with whatever value is passed to close().
 */
export function modal({ title, build, width = '', dismissable = true, labelledBy } = {}) {
  return new Promise(resolve => {
    const titleId = labelledBy || uid('mt');
    const prevFocus = document.activeElement;
    const body = el('div', { class: 'modal__body' });
    const foot = el('div', { class: 'modal__foot' });

    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      openModals--;
      if (openModals === 0) document.body.style.overflow = '';
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch { /* detached */ } }
      resolve(value);
    };

    const head = el('div', { class: 'modal__head' },
      el('h2', { id: titleId }, title || ''),
      dismissable ? el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close(undefined) }, icon('x')) : null,
    );
    const dialog = el('div', {
      class: `modal${width === 'wide' ? ' modal--wide' : ''}`,
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
    }, title ? head : null, body, foot);

    const backdrop = el('div', { class: 'modal-backdrop' }, dialog);
    if (dismissable) backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(undefined); });

    const onKey = (e) => {
      if (!backdrop.isConnected) return;
      if (backdrop !== document.querySelector('.modal-backdrop:last-of-type')) return;  // only the topmost
      if (e.key === 'Escape' && dismissable) { e.stopPropagation(); e.preventDefault(); close(undefined); }
      else if (e.key === 'Tab') trapFocus(dialog, e);
    };
    document.addEventListener('keydown', onKey, true);

    build({ close, body, foot, dialog });

    $('#modal-root').appendChild(backdrop);
    openModals++;
    document.body.style.overflow = 'hidden';

    const target = dialog.querySelector('[data-autofocus]') ||
                   dialog.querySelector('input:not([type=hidden]), textarea, select, button.btn--primary, button');
    requestAnimationFrame(() => { if (target) target.focus(); });
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, detail = null } = {}) {
  return modal({
    title,
    build: ({ close, body, foot }) => {
      if (message) body.appendChild(el('p', {}, message));
      if (detail) body.appendChild(el('p', { class: 'field__hint' }, detail));
      foot.append(
        el('button', { class: 'btn', type: 'button', onclick: () => close(false) }, cancelLabel),
        el('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button', 'data-autofocus': '', onclick: () => close(true) }, confirmLabel),
      );
    },
  }).then(v => v === true);
}

export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save', multiline = false } = {}) {
  return modal({
    title,
    build: ({ close, body, foot }) => {
      const input = multiline
        ? el('textarea', { class: 'textarea', placeholder, 'data-autofocus': '', style: { fontFamily: 'var(--font)', fontSize: '1rem' } })
        : el('input', { class: 'input', type: 'text', placeholder, 'data-autofocus': '' });
      input.value = value;
      const form = el('form', { onsubmit: e => { e.preventDefault(); close(input.value); } },
        el('label', { class: 'field' }, el('span', { class: 'field__label' }, label || ''), input));
      body.appendChild(form);
      foot.append(
        el('button', { class: 'btn', type: 'button', onclick: () => close(undefined) }, 'Cancel'),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => close(input.value) }, confirmLabel),
      );
    },
  });
}

/* ---------- popup menu ---------- */
let activeMenu = null;
export function closeMenu() {
  if (!activeMenu) return;
  const { node, trigger } = activeMenu;
  node.remove();
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  activeMenu = null;
  document.removeEventListener('keydown', menuKey, true);
}
function menuKey(e) {
  if (!activeMenu) return;
  const items = Array.from(activeMenu.node.querySelectorAll('button'));
  if (e.key === 'Escape') { e.preventDefault(); const t = activeMenu.trigger; closeMenu(); t && t.focus(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next] && items[next].focus();
  } else if (e.key === 'Tab') { closeMenu(); }
}
/** items: [{label, iconName, onClick, danger}] — `null` inserts a divider. */
export function openMenu(trigger, items) {
  if (activeMenu && activeMenu.trigger === trigger) { closeMenu(); return; }
  closeMenu();
  const node = el('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) { node.appendChild(el('hr')); continue; }
    node.appendChild(el('button', {
      type: 'button', role: 'menuitem', class: it.danger ? 'is-danger' : '',
      onclick: () => { closeMenu(); it.onClick(); },
    }, it.iconName ? icon(it.iconName) : null, el('span', {}, it.label)));
  }
  document.body.appendChild(node);

  // Position under the trigger, flipped/clamped to stay on screen.
  const r = trigger.getBoundingClientRect();
  const mw = node.offsetWidth, mh = node.offsetHeight;
  let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  node.style.left = Math.max(8, left) + 'px';
  node.style.top = top + 'px';
  node.style.position = 'fixed';

  trigger.setAttribute('aria-expanded', 'true');
  activeMenu = { node, trigger };
  document.addEventListener('keydown', menuKey, true);
  requestAnimationFrame(() => { const first = node.querySelector('button'); first && first.focus(); });
}
document.addEventListener('pointerdown', e => {
  if (activeMenu && !activeMenu.node.contains(e.target) && !activeMenu.trigger.contains(e.target)) closeMenu();
});
window.addEventListener('resize', closeMenu, { passive: true });
window.addEventListener('scroll', closeMenu, { passive: true, capture: true });

/* ---------- small building blocks ---------- */
export function switchToggle(checked, onChange, labelId) {
  const input = el('input', { type: 'checkbox', checked, onchange: e => onChange(e.target.checked) });
  if (labelId) input.setAttribute('aria-labelledby', labelId);
  return el('span', { class: 'switch' }, input, el('span', { class: 'switch__track' }), el('span', { class: 'switch__thumb' }));
}
export function optionRow({ label, sub, control }) {
  const id = uid('or');
  return el('div', { class: 'opt-row' },
    el('div', { class: 'opt-row__text' },
      el('div', { class: 'opt-row__label', id }, label),
      sub ? el('div', { class: 'opt-row__sub' }, sub) : null),
    el('div', { class: 'opt-row__ctl' }, typeof control === 'function' ? control(id) : control),
  );
}
export function segmented(options, value, onChange, ariaLabel) {
  const wrap = el('div', { class: 'segment', role: 'group', 'aria-label': ariaLabel || '' });
  for (const o of options) {
    wrap.appendChild(el('button', {
      type: 'button', 'aria-pressed': String(o.value === value),
      onclick: () => {
        if (o.value === value) return;
        Array.from(wrap.children).forEach(c => c.setAttribute('aria-pressed', 'false'));
        wrap.children[options.indexOf(o)].setAttribute('aria-pressed', 'true');
        value = o.value;
        onChange(o.value);
      },
    }, o.label));
  }
  return wrap;
}
export function statBlock(n, label, color) {
  return el('div', { class: 'stat' },
    el('div', { class: 'stat__n', style: color ? { color } : null }, String(n)),
    el('div', { class: 'stat__l' }, label));
}
export function segBar({ mastered, learning, notStarted, total }) {
  const pc = (n) => total ? (n / total) * 100 + '%' : '0%';
  return el('div', { class: 'seg-bar', role: 'img', 'aria-label': `${mastered} mastered, ${learning} learning, ${notStarted} not started` },
    el('span', { class: 'seg-master', style: { width: pc(mastered) } }),
    el('span', { class: 'seg-learn', style: { width: pc(learning) } }),
    el('span', { class: 'seg-new', style: { width: pc(notStarted) } }),
  );
}
