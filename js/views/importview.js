/* views/importview.js — bring cards in from Quizlet, Anki, spreadsheets, Notion,
 * plain lists, or a StudyLab backup. Everything is previewed before it is saved.
 */
import { el, icon, debounce, plural, readFileText, truncate, setChildren } from '../utils.js';
import * as data from '../data.js';
import { toast, confirmDialog, segmented } from '../ui.js';
import { navigate } from '../router.js';
import { parseAny, findDuplicates } from '../importers.js';

const SAMPLE = `photosynthesis\tHow plants turn light into chemical energy
mitochondrion\tThe organelle that produces most of a cell's ATP
osmosis\tMovement of water across a semi-permeable membrane`;

const HOW_TO = [
  ['Quizlet', 'Open your set, choose Export, keep "Between term and definition: Tab" and "Between rows: New line", then copy everything and paste it here.'],
  ['Anki', 'File, then Export. Choose "Notes in Plain Text (.txt)" and untick "Include HTML". Drop the .txt file here.'],
  ['Excel / Google Sheets', 'Put terms in column A and definitions in column B, then download as CSV and drop it here.'],
  ['Notion / Obsidian', 'Copy a two-column Markdown table straight into the paste box.'],
  ['Brainscape, Cram, Knowt', 'Export as CSV, then drop the file here.'],
];

export function render(mount, { path }) {
  const targetId = new URLSearchParams((path.split('?')[1] || '')).get('set');
  const host = el('div', {});
  mount.appendChild(host);
  let destroyed = false;

  (async () => {
    const target = targetId ? await data.getSet(targetId) : null;
    if (destroyed) return;
    build(host, target);
  })();

  return { destroy() { destroyed = true; } };
}

function build(host, target) {
  let raw = '';
  let parsed = { terms: [], warnings: [], title: '', format: '' };
  let source = 'paste';

  const cfg = {
    format: 'auto',
    delimiter: 'auto',
    rowSep: '\n',
    swap: false,
    skipHeader: false,
    stripHtml: true,
  };

  /* ---------- inputs ---------- */
  const textarea = el('textarea', {
    class: 'textarea', rows: '10', spellcheck: 'false',
    placeholder: 'Paste your cards here, one per line…\n\nterm<TAB>definition',
    'aria-label': 'Paste cards',
  });
  const reparse = debounce(() => { raw = textarea.value; runParse(); }, 200);
  textarea.addEventListener('input', reparse);

  const fileInput = el('input', {
    type: 'file', accept: '.csv,.tsv,.txt,.json,.md,.text,text/plain,text/csv,application/json',
    style: { display: 'none' },
    onchange: (e) => { const f = e.target.files && e.target.files[0]; if (f) loadFile(f); },
  });
  const dropzone = el('div', {
    class: 'dropzone', role: 'button', tabindex: '0',
    onclick: () => fileInput.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
  }, icon('upload'),
    el('div', {}, el('strong', {}, 'Drop a file here'), el('div', { class: 'field__hint' }, 'or click to browse — CSV, TSV, TXT, JSON or Markdown')));

  ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('is-over'); }));
  dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  async function loadFile(file) {
    if (file.size > 12 * 1024 * 1024) { toast('That file is larger than 12 MB — try splitting it.', { type: 'bad', timeout: 6000 }); return; }
    try {
      const text = await readFileText(file);
      raw = text;
      textarea.value = text.length > 400000 ? text.slice(0, 400000) : text;
      if (/\.json$/i.test(file.name)) cfg.format = 'auto';
      if (!titleInput.value.trim()) titleInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      fileNote.textContent = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`;
      runParse();
      toast('File loaded — check the preview below', { type: 'good' });
    } catch (err) {
      toast(`Could not read that file: ${err.message}`, { type: 'bad' });
    }
  }
  const fileNote = el('p', { class: 'field__hint' });

  /* ---------- parse options ---------- */
  const delimSel = el('select', { class: 'select', style: { width: 'auto' }, 'aria-label': 'Separator between term and definition',
    onchange: e => { cfg.delimiter = e.target.value; runParse(); } },
    el('option', { value: 'auto' }, 'Detect automatically'),
    el('option', { value: '\t' }, 'Tab'),
    el('option', { value: ',' }, 'Comma'),
    el('option', { value: ';' }, 'Semicolon'),
    el('option', { value: '|' }, 'Pipe'),
    el('option', { value: 'dash' }, 'Dash or colon'),
  );
  const swapBox = check('Swap term and definition', false, v => { cfg.swap = v; runParse(); });
  const headerBox = check('First row is a header', false, v => { cfg.skipHeader = v; runParse(); });
  const htmlBox = check('Strip HTML tags (Anki)', true, v => { cfg.stripHtml = v; runParse(); });

  function check(label, value, onChange) {
    const input = el('input', { type: 'checkbox', checked: value, onchange: e => onChange(e.target.checked) });
    return el('label', { class: 'checkline' }, input, el('span', { class: 'checkline__txt' }, label));
  }

  /* ---------- target ---------- */
  const titleInput = el('input', { class: 'input', type: 'text', placeholder: 'Set title', maxlength: '300' });
  titleInput.value = target ? target.title : '';
  const targetNote = el('p', { class: 'field__hint' });

  /* ---------- preview ---------- */
  const summary = el('div', { class: 'row', style: { gap: '8px', marginBottom: '10px' } });
  const warnBox = el('div', {});
  const table = el('div', { class: 'tbl__scroll' });
  const importBtn = el('button', { class: 'btn btn--primary btn--lg', type: 'button', disabled: true, onclick: doImport }, icon('check'), 'Import');

  function runParse() {
    parsed = parseAny(raw, cfg);
    const n = parsed.terms.length;
    if (parsed.title && !titleInput.value.trim()) titleInput.value = parsed.title;

    setChildren(summary,
      el('span', { class: n ? 'chip chip--good' : 'chip' }, n ? `${plural(n, 'card')} ready` : 'Nothing detected yet'),
      parsed.format ? el('span', { class: 'chip' }, `Read as ${formatName(parsed.format)}`) : null,
    );
    const dupes = findDuplicates(parsed.terms);
    if (dupes.length) summary.appendChild(el('span', { class: 'chip chip--warn' }, `${plural(dupes.length, 'duplicate term')}`));

    warnBox.replaceChildren(...parsed.warnings.map(w =>
      el('p', { class: 'field__hint', style: { color: 'var(--c-warn)' } }, w)));

    const rows = parsed.terms.slice(0, 60);
    table.replaceChildren(el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', { style: { width: '42%' } }, 'Term'), el('th', {}, 'Definition'))),
      el('tbody', {}, ...rows.map(t => el('tr', {},
        el('td', {}, t.term || blank()), el('td', {}, t.definition || blank()))))));
    if (parsed.terms.length > rows.length) {
      table.appendChild(el('p', { class: 'field__hint', style: { padding: '8px 10px' } },
        `…and ${parsed.terms.length - rows.length} more`));
    }
    table.hidden = !n;
    importBtn.disabled = n === 0;
    importBtn.replaceChildren(icon('check'), document.createTextNode(
      target ? `Add ${plural(n, 'card')} to “${truncate(target.title, 24)}”` : `Create set with ${plural(n, 'card')}`));
    targetNote.textContent = target
      ? `These cards will be appended to “${target.title}” (${plural(target.terms.length, 'existing card')}).`
      : 'A new set will be created in your library.';
  }
  const blank = () => el('span', { style: { color: 'var(--c-text-dim)' } }, '(empty)');
  const formatName = (f) => ({ json: 'JSON', markdown: 'a Markdown table', delimited: 'a delimited list', custom: 'custom separators', empty: 'nothing' }[f] || f);

  async function doImport() {
    if (!parsed.terms.length) return;
    importBtn.disabled = true;
    try {
      if (target) {
        target.terms.push(...parsed.terms.map(data.newTerm));
        await data.saveSet(target);
        toast(`Added ${plural(parsed.terms.length, 'card')}`, { type: 'good' });
        navigate(`/set/${target.id}`);
      } else {
        const set = data.newSet({ title: titleInput.value.trim() || 'Imported set', terms: parsed.terms });
        await data.saveSet(set);
        toast(`Created “${truncate(set.title, 30)}”`, { type: 'good' });
        navigate(`/set/${set.id}`);
      }
    } catch (err) {
      importBtn.disabled = false;
      toast(err.quota ? 'Storage is full — export a backup and remove some sets first.' : `Import failed: ${err.message}`, { type: 'bad', timeout: 7000 });
    }
  }

  /* ---------- backup restore ---------- */
  const backupInput = el('input', {
    type: 'file', accept: '.json,application/json', style: { display: 'none' },
    onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const text = await readFileText(f);
        const payload = JSON.parse(text);
        const setCount = Array.isArray(payload.sets) ? payload.sets.length : (Array.isArray(payload) ? payload.length : 0);
        if (!setCount) throw new Error('No sets found in that backup.');
        const replace = await confirmDialog({
          title: `Restore ${plural(setCount, 'set')}?`,
          message: 'Choose "Add to library" to keep what you already have, or "Replace everything" to start from this backup.',
          confirmLabel: 'Add to library', cancelLabel: 'Replace everything',
        });
        const mode = replace ? 'merge' : 'replace';
        if (mode === 'replace') {
          const sure = await confirmDialog({
            title: 'Replace your whole library?',
            message: 'Every set and all progress currently in this browser will be deleted first. This cannot be undone.',
            confirmLabel: 'Replace everything', danger: true,
          });
          if (!sure) return;
        }
        const n = await data.importBackup(payload, { mode });
        toast(`Restored ${plural(n, 'set')}`, { type: 'good' });
        navigate('/');
      } catch (err) {
        toast(`Could not restore that backup: ${err.message}`, { type: 'bad', timeout: 7000 });
      }
    },
  });

  /* ---------- layout ---------- */
  const sourceSwitch = segmented(
    [{ value: 'paste', label: 'Paste text' }, { value: 'file', label: 'Upload a file' }],
    source,
    (v) => {
      source = v;
      pastePane.hidden = v !== 'paste';
      filePane.hidden = v !== 'file';
    },
    'Import source');

  const pastePane = el('div', {},
    textarea,
    el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: () => { textarea.value = SAMPLE; raw = SAMPLE; runParse(); } }, 'Try an example'),
      el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: () => { textarea.value = ''; raw = ''; runParse(); } }, 'Clear')),
  );
  const filePane = el('div', { hidden: true }, dropzone, fileInput, fileNote);

  host.append(
    el('div', { class: 'page-head' },
      el('div', { class: 'page-head__text' },
        el('h1', {}, target ? 'Add cards to a set' : 'Import a set'),
        el('p', { class: 'page-head__sub' }, 'Paste or drop cards from Quizlet, Anki, a spreadsheet or anywhere else.')),
    ),

    el('div', { class: 'panel' },
      el('div', { class: 'row row--between', style: { marginBottom: '12px' } },
        el('h2', {}, '1. Where are the cards coming from?'), sourceSwitch),
      pastePane, filePane,
    ),

    el('div', { class: 'panel' },
      el('h2', {}, '2. How should they be read?'),
      el('p', { class: 'panel__sub' }, 'StudyLab guesses these, but you can correct it and the preview updates instantly.'),
      el('div', { class: 'grid2', style: { alignItems: 'start' } },
        el('label', { class: 'field', style: { marginBottom: '0' } },
          el('span', { class: 'field__label' }, 'Separator between the two sides'), delimSel),
        el('div', { class: 'field', style: { marginBottom: '0' } },
          el('span', { class: 'field__label' }, 'Adjustments'),
          swapBox, headerBox, htmlBox)),
    ),

    el('div', { class: 'panel' },
      el('h2', {}, '3. Check the preview'),
      summary, warnBox, table,
      target ? null : el('label', { class: 'field', style: { marginTop: '14px' } },
        el('span', { class: 'field__label' }, 'Set title'), titleInput),
      targetNote,
      el('div', { class: 'row', style: { marginTop: '14px' } }, importBtn,
        el('a', { class: 'btn', href: target ? `#/set/${target.id}` : '#/' }, 'Cancel')),
    ),

    el('details', { class: 'panel' },
      el('summary', { style: { cursor: 'pointer', fontWeight: '650' } }, 'How to export from other apps'),
      el('div', { class: 'opt-list', style: { marginTop: '12px' } },
        ...HOW_TO.map(([app, how]) => el('div', {},
          el('div', { class: 'opt-row__label' }, app),
          el('div', { class: 'opt-row__sub' }, how))))),

    el('div', { class: 'panel' },
      el('h2', {}, 'Restore a StudyLab backup'),
      el('p', { class: 'panel__sub' }, 'Bring a whole library back from a backup file — sets, folders and study progress together.'),
      el('button', { class: 'btn', type: 'button', onclick: () => backupInput.click() }, icon('upload'), 'Choose a backup file'),
      backupInput),
  );

  runParse();
  requestAnimationFrame(() => textarea.focus({ preventScroll: true }));
}
