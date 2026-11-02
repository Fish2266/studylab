/* views/dialogs.js — shared modal flows: export, share link, keyboard help. */
import { el, icon, copyText, plural, append, setChildren } from '../utils.js';
import { modal, toast } from '../ui.js';
import { EXPORT_FORMATS, exportSet, makeShareLink } from '../share.js';
import { encodeQR, qrSvg, qrCanvas, MAX_QR_BYTES } from '../qr.js';

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
      const status = el('p', { class: 'field__hint share__status' }, 'Building link…');
      const qrBox = el('div', { class: 'share__qr', 'aria-busy': 'true' }, el('div', { class: 'spinner' }));
      const field = el('input', { class: 'input', readonly: true, 'aria-label': 'Share link', onclick: e => e.target.select() });
      const copyBtn = el('button', { class: 'btn btn--primary', type: 'button', disabled: true }, icon('copy'), 'Copy link');
      const nativeBtn = navigator.share ? el('button', { class: 'btn', type: 'button', disabled: true }, icon('link'), 'Send…') : null;
      body.append(
        qrBox,
        el('p', { class: 'share__lede' }, 'Scan with a phone camera, or send the link. The whole set travels inside it — no account, nothing uploaded.'),
        el('div', { class: 'row' }, field),
        status,
      );
      append(foot, [el('button', { class: 'btn', type: 'button', 'data-autofocus': '', onclick: () => close() }, 'Close'), nativeBtn, copyBtn]);

      makeShareLink(set).then(({ url, size, tooLong }) => {
        field.value = url;
        copyBtn.disabled = false;
        copyBtn.onclick = async () => {
          toast(await copyText(url) ? 'Link copied' : 'Could not copy — select the text instead', { type: 'good' });
        };
        if (nativeBtn) {
          nativeBtn.disabled = false;
          nativeBtn.onclick = () => navigator.share({ title: set.title, text: `Study “${set.title}” on StudyLab`, url }).catch(() => {});
        }
        paintQR(url);
        const kb = Math.round(size / 1024 * 10) / 10;
        status.textContent = tooLong
          ? `Heads-up: this link is ${Math.round(size / 1024)} KB. Some apps and browsers cut links off around 30 KB — export a file instead for very large sets.`
          : `${plural(set.terms.length, 'term')} · ${kb} KB link`;
        if (tooLong) status.style.color = 'var(--c-warn)';
      }).catch(err => {
        qrBox.remove();
        status.textContent = `Could not build a link: ${err.message}`;
        status.style.color = 'var(--c-bad)';
      });

      function paintQR(url) {
        qrBox.removeAttribute('aria-busy');
        let qr;
        try { qr = encodeQR(url, { ecl: 'M', minEcl: 'L' }); }
        catch {
          qrBox.className = 'share__qr share__qr--none';
          qrBox.replaceChildren(icon('link'), el('span', {},
            `This set is too big for a QR code (they hold about ${Math.floor(MAX_QR_BYTES / 1000 * 10) / 10} KB). Send the link instead, or share a smaller set.`));
          return;
        }
        const save = el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: () => {
          qrCanvas(qr, 10).toBlob(blob => {
            if (!blob) return;
            const a = el('a', { href: URL.createObjectURL(blob), download: `${(set.title || 'set').replace(/[^\w-]+/g, '-').slice(0, 50)}-qr.png` });
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          });
        } }, icon('download'), 'Save image');
        setChildren(qrBox,
          el('div', { class: 'share__qr-code' }, qrSvg(qr, { label: `QR code for “${set.title}”` })),
          qr.version > 25 ? el('p', { class: 'field__hint' }, 'Big set, dense code — hold the camera close and steady.') : null,
          save);
      }
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
