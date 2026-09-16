/* views/settings.js — appearance, study defaults, and everything about your data. */
import { el, icon, downloadFile, plural } from '../utils.js';
import * as data from '../data.js';
import * as store from '../storage.js';
import { toast, confirmDialog, optionRow, switchToggle, segmented } from '../ui.js';
import { ACCENTS, applyAppearance } from '../theme.js';
import { openShortcutsDialog } from './dialogs.js';
import { checkboxRow, selectRow, numberRow, typeRows } from './options.js';
import { navigate } from '../router.js';

export function render(mount) {
  const host = el('div', {});
  mount.appendChild(host);
  let s = { ...data.getSettings() };

  const save = async (patch) => {
    s = await data.saveSettings(patch);
    applyAppearance(s);
  };

  host.append(
    el('div', { class: 'page-head' },
      el('div', { class: 'page-head__text' },
        el('h1', {}, 'Settings'),
        el('p', { class: 'page-head__sub' }, 'Everything is stored in this browser only.'))),
    appearancePanel(s, save),
    defaultsPanel(s, save),
    dataPanel(),
    aboutPanel(),
  );

  return { destroy() {} };
}

/* ---------------- appearance ---------------- */
function appearancePanel(s, save) {
  const swatches = el('div', { class: 'swatches' }, ...ACCENTS.map(a => {
    const btn = el('button', {
      class: 'swatch', type: 'button', 'aria-pressed': String(s.accentHue === a.hue),
      'aria-label': `Accent colour ${a.name}`, title: a.name,
      style: { background: `hsl(${a.hue} 62% 58%)` },
      onclick: () => {
        swatches.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        save({ accentHue: a.hue });
      },
    });
    return btn;
  }));

  return el('div', { class: 'panel' },
    el('h2', {}, 'Appearance'),
    el('p', { class: 'panel__sub' }, 'Applies everywhere in StudyLab.'),
    el('div', { class: 'opt-list' },
      optionRow({
        label: 'Theme', sub: 'System follows your device',
        control: () => segmented(
          [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
          s.theme, v => save({ theme: v }), 'Theme'),
      }),
      optionRow({ label: 'Accent colour', control: () => swatches }),
      optionRow({
        label: 'Text size', sub: 'Scales the whole interface',
        control: (id) => {
          const out = el('span', { class: 'study__counter', style: { minWidth: '4ch' } }, `${Math.round(s.fontScale * 100)}%`);
          return el('span', { class: 'row', style: { gap: '10px' } },
            el('input', {
              class: 'range', type: 'range', min: '0.85', max: '1.35', step: '0.05', value: String(s.fontScale),
              'aria-labelledby': id, style: { width: '160px' },
              oninput: (e) => { const v = Number(e.target.value); out.textContent = `${Math.round(v * 100)}%`; save({ fontScale: v }); },
            }), out);
        },
      }),
      selectRow('Study card font', 'Used for terms, definitions and questions', s.readFont,
        [['sans', 'Sans-serif (default)'], ['serif', 'Serif'], ['mono', 'Monospace'], ['dys', 'Higher legibility']],
        v => save({ readFont: v })),
      optionRow({
        label: 'Reduce motion', sub: 'Turn off flips, slides and fades',
        control: (id) => switchToggle(s.reduceMotion, v => save({ reduceMotion: v }), id),
      }),
      optionRow({
        label: 'Confirm before deleting', sub: 'Ask before removing a set',
        control: (id) => switchToggle(s.confirmDelete, v => save({ confirmDelete: v }), id),
      }),
    ));
}

/* ---------------- study defaults ---------------- */
/** Collapsed by default: three full option groups at once is a wall of rows. */
function collapsible(title, summaryText, rows) {
  const kept = rows.filter(Boolean);
  return el('details', { class: 'fold' },
    el('summary', { class: 'fold__summary' },
      el('span', { class: 'fold__title' }, title),
      el('span', { class: 'fold__hint' }, summaryText)),
    el('div', { class: 'opt-list fold__body' }, ...kept));
}

function defaultsPanel(s, save) {
  const learn = JSON.parse(JSON.stringify(s.learn));
  const test = JSON.parse(JSON.stringify(s.test));
  const flash = { ...s.flashcards };

  const commit = () => save({ learn, test, flashcards: flash });

  return el('div', { class: 'panel' },
    el('h2', {}, 'Study defaults'),
    el('p', { class: 'panel__sub' }, 'Starting options for every set. You can still change them inside any mode, and those changes are remembered too.'),

    collapsible('Flashcards', 'Front side, shuffle, progress tracking', [
      selectRow('Front of card', '', flash.front,
        [['term', 'Term'], ['definition', 'Definition'], ['random', 'Random']], v => { flash.front = v; commit(); }),
      checkboxRow('Shuffle by default', '', flash.shuffle, v => { flash.shuffle = v; commit(); }),
      checkboxRow('Track know / still learning', '', flash.trackProgress, v => { flash.trackProgress = v; commit(); }),
    ]),

    collapsible('Learn', 'Question types, rounds, mastery, grading', [
      selectRow('Answer with', '', learn.answerWith,
        [['definition', 'The definition'], ['term', 'The term'], ['both', 'Mix of both']], v => { learn.answerWith = v; commit(); }),
      ...typeRows(learn.types, [
        ['multiple', 'Multiple choice', ''],
        ['written', 'Written', ''],
        ['truefalse', 'True or false', ''],
        ['flashcard', 'Flashcard', ''],
      ], v => { learn.types = v; commit(); }),
      numberRow('Terms per round', '', learn.roundSize, 3, 20, v => { learn.roundSize = v; commit(); }),
      numberRow('Correct answers to master', '', learn.masteryTarget, 1, 5, v => { learn.masteryTarget = v; commit(); }),
      checkboxRow('Smart grading', 'Ignore capitals, punctuation and accents', learn.smartGrading, v => { learn.smartGrading = v; commit(); }),
      checkboxRow('Accept typos', '', learn.acceptTypos, v => { learn.acceptTypos = v; commit(); }),
    ]),

    collapsible('Test', 'Question count, types, feedback, timing', [
      numberRow('Questions per test', '', test.questionCount, 1, 100, v => { test.questionCount = v; commit(); }),
      ...typeRows(test.types, [
        ['written', 'Written', ''],
        ['multiple', 'Multiple choice', ''],
        ['truefalse', 'True or false', ''],
        ['matching', 'Matching', ''],
      ], v => { test.types = v; commit(); }),
      checkboxRow('Instant feedback', '', test.instantFeedback, v => { test.instantFeedback = v; commit(); }),
      numberRow('Time limit (minutes)', '0 for no limit', test.timeLimit, 0, 180, v => { test.timeLimit = v; commit(); }),
    ]),
  );
}

/* ---------------- data ---------------- */
function dataPanel() {
  const backendNote = el('p', { class: 'panel__sub' }, 'Checking storage…');
  const usageBar = el('div', { class: 'bar__fill' });
  const usageNote = el('div', { class: 'field__hint' });
  const persistBtn = el('button', { class: 'btn btn--sm', type: 'button', onclick: askPersist }, 'Make storage permanent');

  const panel = el('div', { class: 'panel' },
    el('h2', {}, 'Your data'),
    backendNote,
    el('div', { class: 'bar', style: { margin: '12px 0 6px' } }, usageBar),
    usageNote,
    el('div', { class: 'row', style: { marginTop: '16px' } },
      el('button', { class: 'btn btn--primary', type: 'button', onclick: exportBackup }, icon('download'), 'Download a backup'),
      el('a', { class: 'btn', href: '#/import' }, icon('upload'), 'Restore a backup'),
      persistBtn),
    el('div', { class: 'row', style: { marginTop: '16px' } },
      el('button', { class: 'btn btn--danger', type: 'button', onclick: wipe }, icon('trash'), 'Delete everything')),
  );

  (async () => {
    const backend = store.getBackend();
    const persisted = await store.isPersisted();
    backendNote.replaceChildren(document.createTextNode(
      backend === 'idb'
        ? 'Your sets live in this browser’s IndexedDB. They survive reloads, restarts and going offline — but they are tied to this browser on this device.'
        : backend === 'ls'
          ? 'IndexedDB is not available here, so StudyLab is using localStorage instead. That works, but the limit is around 5 MB — keep backups.'
          : 'Storage is blocked in this browser (private mode, or site data disabled). Your work will be lost when you close the tab — download a backup before you leave.'));
    if (backend === 'memory') backendNote.style.color = 'var(--c-bad)';
    if (persisted) { persistBtn.disabled = true; persistBtn.textContent = 'Storage is already permanent'; }

    const { usage, quota } = await store.estimateUsage();
    const pct = quota ? Math.min(100, (usage / quota) * 100) : 0;
    usageBar.style.width = pct + '%';
    if (pct > 85) usageBar.classList.add('bar__fill--bad');
    usageNote.textContent = quota
      ? `${fmtBytes(usage)} used of about ${fmtBytes(quota)} available · ${plural(data.getIndex().length, 'set')} · ${plural(data.getIndex().reduce((n, r) => n + r.count, 0), 'card')}`
      : `${plural(data.getIndex().length, 'set')} saved`;
  })();

  async function askPersist() {
    const result = await store.requestPersistence();
    if (result === 'granted') { persistBtn.disabled = true; persistBtn.textContent = 'Storage is already permanent'; toast('Your data is now protected from automatic clean-up', { type: 'good', timeout: 5000 }); }
    else if (result === 'denied') toast('The browser declined. Adding StudyLab to your home screen or bookmarks usually helps.', { timeout: 6000 });
    else toast('This browser does not support permanent storage.', { timeout: 5000 });
  }

  async function exportBackup() {
    try {
      const payload = await data.exportAll();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadFile(`studylab-backup-${stamp}.json`, JSON.stringify(payload), 'application/json');
      toast('Backup downloaded', { type: 'good' });
    } catch (err) { toast(`Backup failed: ${err.message}`, { type: 'bad' }); }
  }

  async function wipe() {
    const ok = await confirmDialog({
      title: 'Delete every set and all progress?',
      message: 'This removes everything StudyLab has stored in this browser.',
      detail: 'Download a backup first if there is anything you want to keep — this cannot be undone.',
      confirmLabel: 'Delete everything', danger: true,
    });
    if (!ok) return;
    const reallySure = await confirmDialog({
      title: 'Last check',
      message: `You are about to delete ${plural(data.getIndex().length, 'set')}.`,
      confirmLabel: 'Yes, delete it all', danger: true,
    });
    if (!reallySure) return;
    try {
      await store.clearStore('sets');
      await store.clearStore('progress');
      await data.rebuildIndex([]);
      toast('Everything deleted', { type: 'good' });
      navigate('/');
    } catch (err) { toast(`Could not delete: ${err.message}`, { type: 'bad' }); }
  }

  return panel;
}

function fmtBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/* ---------------- about ---------------- */
function aboutPanel() {
  return el('div', { class: 'panel' },
    el('h2', {}, 'About StudyLab'),
    el('p', { class: 'panel__sub' },
      'A study app that runs entirely in your browser. No account, no server, nothing uploaded — which also means your sets live on this device unless you export or share them.'),
    el('div', { class: 'row' },
      el('button', { class: 'btn', type: 'button', onclick: openShortcutsDialog }, 'Keyboard shortcuts'),
      el('button', {
        class: 'btn btn--ghost', type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'Reset all settings?', message: 'Appearance and study defaults go back to how they started. Your sets are not touched.', confirmLabel: 'Reset settings' });
          if (!ok) return;
          const s = await data.resetSettings();
          applyAppearance(s);
          toast('Settings reset', { type: 'good' });
          navigate('/settings');
          location.reload();
        },
      }, 'Reset settings to defaults')));
}
