/* views/dialogs.js — shared modal flows: export, share link, keyboard help. */
import { el, icon, copyText, plural } from '../utils.js';
import { modal, toast } from '../ui.js';
import { EXPORT_FORMATS, exportSet, makeShareLink } from '../share.js';

export function openExportDialog(set) {
  return modal({
    title: `Export “${set.title}”`,
    build: ({ close, body, foot }) => {
      let chosen = 'json';
      const preview = el('pre', {
        class: 'textarea', style: { maxHeight: '160px', overflow: 'auto', whiteSpace: 'pre-wrap', margin: '0' },
        'aria-label': 'Export preview',
      });
      const update = () => {
        const f = EXPORT_FORMATS.find(x => x.id === chosen);
        const text = f.fn(set);
        preview.textContent = text.length > 1200 ? text.slice(0, 1200) + '\n…' : text;
      };
      const list = el('div', { class: 'stack' }, ...EXPORT_FORMATS.map(f => {
        const input = el('input', { type: 'radio', name: 'exp', value: f.id, checked: f.id === chosen,
          onchange: () => { chosen = f.id; update(); } });
        return el('label', { class: 'checkline' }, input,
          el('span', { class: 'checkline__txt' }, f.label, el('span', { class: 'checkline__sub' }, f.hint)));
      }));
      body.append(list, el('div', { class: 'field__label', style: { marginTop: '14px' } }, 'Preview'), preview);
      foot.append(
        el('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        el('button', { class: 'btn', type: 'button', onclick: async () => {
          const f = EXPORT_FORMATS.find(x => x.id === chosen);
          toast(await copyText(f.fn(set)) ? 'Copied to clipboard' : 'Could not copy', { type: 'good' });
        } }, icon('copy'), 'Copy'),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => { exportSet(set, chosen); close(); toast('File downloaded', { type: 'good' }); } }, icon('download'), 'Download'),
      );
      update();
    },
  });
}

export function openShareDialog(set) {
  return modal({
    title: 'Share this set',
    build: ({ close, body, foot }) => {
      const status = el('p', { class: 'field__hint' }, 'Building link…');
      const field = el('input', { class: 'input', readonly: true, 'aria-label': 'Share link' });
      const copyBtn = el('button', { class: 'btn btn--primary', type: 'button', disabled: true }, icon('copy'), 'Copy link');
      body.append(
        el('p', {}, 'The whole set is packed into the link itself, so anyone who opens it gets a copy — no account, no server, nothing uploaded.'),
        el('div', { class: 'row' }, field),
        status,
      );
      foot.append(el('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Close'), copyBtn);

      makeShareLink(set).then(({ url, size, tooLong }) => {
        field.value = url;
        copyBtn.disabled = false;
        copyBtn.onclick = async () => {
          toast(await copyText(url) ? 'Link copied' : 'Could not copy — select the text instead', { type: 'good' });
        };
        status.textContent = tooLong
          ? `Heads-up: this link is ${Math.round(size / 1024)} KB. Some apps and browsers cut links off around 30 KB — export a file instead for very large sets.`
          : `${plural(set.terms.length, 'term')} · ${Math.round(size / 1024 * 10) / 10} KB link`;
        if (tooLong) status.style.color = 'var(--c-warn)';
        field.focus(); field.select();
      }).catch(err => {
        status.textContent = `Could not build a link: ${err.message}`;
        status.style.color = 'var(--c-bad)';
      });
    },
  });
}

const SHORTCUTS = [
  ['Everywhere', [
    ['Go to library', ['G', 'L']], ['Create a set', ['G', 'C']], ['Settings', ['G', 'S']],
    ['Toggle theme', ['T']], ['This help', ['?']], ['Close dialog', ['Esc']],
  ]],
  ['Flashcards', [
    ['Flip card', ['Space']], ['Previous / next', ['←', '→']], ['Star card', ['S']],
    ['Still learning', ['1']], ['Know it', ['2']], ['Shuffle', ['X']], ['Play / pause', ['P']],
    ['Read aloud', ['A']], ['Fullscreen', ['F']],
  ]],
  ['Learn & Test', [
    ['Pick choice', ['1', '2', '3', '4']], ['Submit answer', ['Enter']],
    ['Skip / don’t know', ['Shift', 'Enter']], ['Override — I was right', ['O']],
    ['Next question', ['Enter']], ['Options', ['O', 'P']],
  ]],
];

export function openShortcutsDialog() {
  return modal({
    title: 'Keyboard shortcuts',
    build: ({ close, body, foot }) => {
      body.appendChild(el('div', { class: 'kbd-list' }, ...SHORTCUTS.map(([group, rows]) =>
        el('section', { class: 'kbd-group' },
          el('h3', { class: 'kbd-group__title' }, group),
          el('dl', {}, ...rows.map(([label, keys]) =>
            el('div', { class: 'kbd-row' },
              el('dt', { title: label }, label),
              el('dd', {}, ...keys.map(k => el('kbd', {}, k)))))),
        ))));
      foot.appendChild(el('button', { class: 'btn btn--primary', type: 'button', onclick: () => close() }, 'Got it'));
    },
  });
}
