/* views/options.js — the shared "study options" sheet used by every mode.
 * Rows write into a draft object; nothing is committed until Apply, so Cancel
 * genuinely cancels.
 */
import { el, append } from '../utils.js';
import { modal, switchToggle, optionRow } from '../ui.js';

export function optionGroup(title, rows) {
  const kept = rows.filter(Boolean);
  if (!kept.length) return null;
  return el('div', { style: { marginBottom: '18px' } },
    el('div', { class: 'section-title' }, title),
    el('div', { class: 'opt-list' }, ...kept));
}

export function checkboxRow(label, sub, value, onChange) {
  return optionRow({ label, sub, control: (id) => switchToggle(value, onChange, id) });
}

export function selectRow(label, sub, value, options, onChange) {
  return optionRow({
    label, sub,
    control: (id) => {
      const sel = el('select', { class: 'select', 'aria-labelledby': id, onchange: e => onChange(e.target.value) },
        ...options.map(([v, text]) => el('option', { value: v }, text)));
      sel.value = value;
      return sel;
    },
  });
}

export function rangeRow(label, value, min, max, step, onChange, format) {
  const out = el('span', { class: 'study__counter', style: { minWidth: '3ch', textAlign: 'right' } },
    format ? format(value) : String(value));
  return optionRow({
    label,
    control: (id) => el('span', { class: 'row', style: { gap: '10px' } },
      el('input', {
        class: 'range', type: 'range', min, max, step, value, 'aria-labelledby': id,
        style: { width: '160px' },
        oninput: e => { const v = Number(e.target.value); out.textContent = format ? format(v) : String(v); onChange(v); },
      }), out),
  });
}

export function numberRow(label, sub, value, min, max, onChange) {
  return optionRow({
    label, sub,
    control: (id) => {
      const input = el('input', {
        class: 'input', type: 'number', min, max, value, 'aria-labelledby': id, style: { width: '96px', minWidth: '0' },
        onchange: e => {
          let v = Math.round(Number(e.target.value));
          if (!Number.isFinite(v)) v = min;
          v = Math.min(max, Math.max(min, v));
          e.target.value = String(v);
          onChange(v);
        },
      });
      return input;
    },
  });
}

/**
 * A group of checkboxes that must keep at least one item selected
 * (e.g. Learn question types) — unchecking the last one is refused.
 */
export function typeRows(types, labels, onChange) {
  const draft = { ...types };
  const boxes = new Map();
  const rows = labels.map(([key, label, sub]) => optionRow({
    label, sub,
    control: (id) => {
      const toggle = switchToggle(draft[key], (v) => {
        const enabled = Object.values({ ...draft, [key]: v }).filter(Boolean).length;
        if (enabled === 0) {
          const input = boxes.get(key);
          input.checked = true;
          return;
        }
        draft[key] = v;
        onChange({ ...draft });
      }, id);
      boxes.set(key, toggle.querySelector('input'));
      return toggle;
    },
  }));
  return rows;
}

export function openOptions({ title, groups, onApply, onReset, applyLabel = 'Apply' }) {
  return modal({
    title, width: 'wide',
    build: ({ close, body, foot }) => {
      append(body, groups);
      append(foot, [
        onReset ? el('button', {
          class: 'btn btn--ghost', type: 'button',
          style: { marginRight: 'auto' },
          onclick: () => { close(); onReset(); },
        }, 'Reset to defaults') : null,
        el('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => { close(true); onApply(); } }, applyLabel),
      ]);
    },
  });
}
