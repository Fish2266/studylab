/* utils.js — DOM helpers, text tools, small algorithms. No dependencies. */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Create an element. Children are appended as text nodes unless they are Nodes,
 * so user content can never be interpreted as markup.
 *   el('div', {class:'x', onclick:fn, dataset:{id:1}}, 'text', el('b',{},'hi'))
 */
export function el(tag, props = null, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') {
        // setProperty, not Object.assign, so custom properties (--x) work too.
        for (const [prop, val] of Object.entries(v)) {
          if (val === null || val === undefined) continue;
          if (prop.startsWith('--')) node.style.setProperty(prop, String(val));
          else node.style[prop] = val;
        }
      }
      else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
      else if (k === 'html') node.innerHTML = v;                 // callers must pass trusted markup
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') node[k] = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(node, children);
  return node;
}
export function append(parent, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}
export function frag(...children) { return append(document.createDocumentFragment(), children); }

/**
 * Replace a node's children, skipping null/undefined/false.
 * Native replaceChildren() renders `null` as the text "null", which is an easy
 * mistake to make with conditional children — use this instead.
 */
export function setChildren(parent, ...children) {
  parent.replaceChildren();
  return append(parent, children);
}

/** Inline SVG icon from a shared sprite of path data. */
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  check: '<path d="m5 13 4.5 4.5L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  x: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  left: '<path d="M15 5 8 12l7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  right: '<path d="m9 5 7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  star: '<path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.77L12 16.9l-5.2 2.72 1-5.77-4.2-4.1 5.8-.85Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" fill="none"/>',
  shuffle: '<path d="M3 6h3.5l3 4m0 0 3 4H17m-7.5-4H17M3 18h3.5l2-2.7M17 3l3.5 3L17 9M17 15l3.5 3L17 21" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  sound: '<path d="M5 9.5v5h3l4 3.5V6L8 9.5H5Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" fill="none"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.5 7.5 0 0 1 0 10.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  play: '<path d="M7 4.8 19 12 7 19.2V4.8Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" fill="none"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  cog: '<circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5m15.4-6.6-1.6 1.6M7.7 16.3l-1.6 1.6m11.8 0-1.6-1.6M7.7 7.7 6.1 6.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  trash: '<path d="M4 7h16M10 7V4.8h4V7m-7 0 .9 12.3A1.8 1.8 0 0 0 9.7 21h4.6a1.8 1.8 0 0 0 1.8-1.7L17 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  pencil: '<path d="M4 20.2h4L19 9.2a2.5 2.5 0 0 0-3.5-3.5L4.5 16.7v3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.4" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M15.5 5.6V5A2 2 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8a2 2 0 0 0 2 2h.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  download: '<path d="M12 3.5v11m0 0 4-4m-4 4-4-4M4 17v2.2A1.8 1.8 0 0 0 5.8 21h12.4a1.8 1.8 0 0 0 1.8-1.8V17" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  upload: '<path d="M12 20.5v-11m0 0-4 4m4-4 4 4M4 7V4.8A1.8 1.8 0 0 1 5.8 3h12.4A1.8 1.8 0 0 1 20 4.8V7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  dots: '<circle cx="12" cy="5.5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="18.5" r="1.7" fill="currentColor"/>',
  cards: '<rect x="3" y="6.5" width="13" height="10" rx="2.2" stroke="currentColor" stroke-width="1.8" fill="none" opacity=".55"/><rect x="8" y="9.5" width="13" height="10" rx="2.2" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  brain: '<path d="M12 2.8a6.2 6.2 0 0 0-3.7 11.2c.62.46.98 1.18.98 1.95v.55h5.44v-.55c0-.77.36-1.49.98-1.95A6.2 6.2 0 0 0 12 2.8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" fill="none"/><path d="M9.6 19h4.8M10.4 21.5h3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  quiz: '<path d="M6.5 3.5h11A1.5 1.5 0 0 1 19 5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M8.6 8.3h6.8M8.6 12h6.8M8.6 15.7h3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  bolt: '<path d="M13.2 2.5 4.8 13.4h5.6l-.6 8.1 8.4-10.9h-5.6l.6-8.1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" fill="none"/>',
  search: '<circle cx="11" cy="11" r="6.6" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  folder: '<path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h3.9l2 2.4h7.7a1.7 1.7 0 0 1 1.7 1.7v8.9a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V7.2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  grip: '<circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/>',
  undo: '<path d="M4 9h9.5a5.5 5.5 0 1 1 0 11H7M4 9l4-4M4 9l4 4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  swap: '<path d="M7 4 3.5 7.5 7 11M3.5 7.5H17M17 20l3.5-3.5L17 13m3.5 3.5H7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  warn: '<path d="M12 4.2 2.9 19.8h18.2L12 4.2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M12 9.6v4.2M12 16.8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 7.2V12l3.2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
};
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', cls ? `ico ${cls}` : 'ico');
  svg.innerHTML = ICONS[name] || '';                             // static, trusted strings only
  return svg;
}

/* ---------- ids, timing ---------- */
let idCounter = 0;
export function uid(prefix = 'i') {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
export function debounce(fn, ms = 250) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  return wrapped;
}

/* ---------- math / arrays ---------- */
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
/** Deterministic PRNG so shuffles can be reproduced (test retakes, share links). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function sample(arr, n, rng = Math.random) { return shuffle(arr, rng).slice(0, n); }
/* ---------- text ---------- */
export function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
/** Remove HTML markup (Anki/Quizlet exports often carry it) but keep the text. */
export function htmlToText(s) {
  if (!/[<&]/.test(s)) return s;
  const t = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  const ta = document.createElement('textarea');
  ta.innerHTML = t;                                              // decode entities only; never inserted into the DOM
  return ta.value.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
}
export function truncate(s, n) { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts, m = 60000, h = 3600000, d = 86400000;
  if (diff < m) return 'just now';
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * d) return `${Math.floor(diff / d)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: diff > 300 * d ? 'numeric' : undefined });
}
export function mmss(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/* ---------- files ---------- */
export function downloadFile(filename, content, mime = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('Could not read file'));
    fr.readAsText(file);
  });
}
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the execCommand path */ }
  const ta = el('textarea', { style: { position: 'fixed', opacity: '0', top: '0' } });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/* ---------- a11y ---------- */
let liveTimer;
export function announce(msg) {
  const region = document.getElementById('live-region');
  if (!region) return;
  clearTimeout(liveTimer);
  region.textContent = '';
  liveTimer = setTimeout(() => { region.textContent = msg; }, 60);
}
/** True when the event target is a text field — used to ignore global hotkeys. */
export function isTyping(e) {
  const t = e.target;
  if (!t || !t.tagName) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}
export function trapFocus(container, e) {
  const items = $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', container)
    .filter(n => n.offsetParent !== null || n === document.activeElement);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
/** Grow a textarea to fit its content without causing layout thrash on every keystroke. */
export function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight + 2, 400) + 'px';
}
