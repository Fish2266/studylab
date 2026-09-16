/* views/setview.js — one set: progress at a glance, mode launcher, term list. */
import { el, icon, frag, plural, relTime, truncate, debounce } from '../utils.js';
import * as data from '../data.js';
import { toast, confirmDialog, openMenu, segBar } from '../ui.js';
import { navigate } from '../router.js';
import { openExportDialog, openShareDialog } from './dialogs.js';
import { nextReviewLabel } from '../scheduler.js';
import * as speech from '../speech.js';

const CHUNK = 60;                       // term rows rendered per batch

const MODES = [
  { id: 'flashcards', label: 'Flashcards', icon: 'cards', sub: 'Flip, sort, autoplay' },
  { id: 'learn',      label: 'Learn',      icon: 'brain', sub: 'Adaptive rounds to mastery' },
  { id: 'test',       label: 'Test',       icon: 'quiz',  sub: 'Full practice exam' },
  { id: 'match',      label: 'Match',      icon: 'bolt',  sub: 'Race the clock' },
];

export function render(mount, { params }) {
  const [setId] = params;
  const host = el('div', {}, el('div', { class: 'row', style: { padding: '40px', justifyContent: 'center' } }, el('div', { class: 'spinner' })));
  mount.appendChild(host);
  let destroyed = false;

  (async () => {
    const set = await data.getSet(setId);
    if (destroyed) return;
    if (!set) {
      host.replaceChildren(el('div', { class: 'empty' },
        el('h1', {}, 'Set not found'),
        el('p', {}, 'It may have been deleted, or this link came from a different browser.'),
        el('a', { class: 'btn btn--primary', href: '#/' }, 'Back to library')));
      return;
    }
    const progress = await data.getProgress(setId);
    if (destroyed) return;
    document.title = set.title + ' · StudyLab';
    host.replaceChildren();
    paint(host, set, progress);
  })();

  return { destroy() { destroyed = true; speech.cancel(); } };
}

function paint(host, set, progress) {
  const stats = data.summarize(set, progress);
  const due = nextReviewLabel(progress);

  const menuBtn = el('button', {
    class: 'btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'More actions',
    onclick: () => openMenu(menuBtn, [
      { label: 'Edit set', iconName: 'pencil', onClick: () => navigate(`/set/${set.id}/edit`) },
      { label: 'Duplicate', iconName: 'copy', onClick: async () => {
        const c = await data.duplicateSet(set.id);
        toast('Duplicated', { type: 'good', action: { label: 'Open', onClick: () => navigate(`/set/${c.id}`) } });
      } },
      null,
      { label: 'Export…', iconName: 'download', onClick: () => openExportDialog(set) },
      { label: 'Share link…', iconName: 'link', onClick: () => openShareDialog(set) },
      null,
      { label: 'Reset progress', iconName: 'undo', onClick: resetProgress },
      { label: 'Delete set', iconName: 'trash', danger: true, onClick: remove },
    ]),
  }, icon('dots'));

  async function resetProgress() {
    const ok = await confirmDialog({
      title: 'Reset study progress?',
      message: 'Mastery, streaks and review dates for this set go back to zero. The terms themselves are untouched.',
      confirmLabel: 'Reset progress', danger: true,
    });
    if (!ok) return;
    progress = await data.resetProgress(set.id);
    toast('Progress reset', { type: 'good' });
    rerender();
  }
  async function remove() {
    const ok = !data.getSettings().confirmDelete || await confirmDialog({
      title: `Delete “${truncate(set.title, 40)}”?`,
      message: `${plural(set.terms.length, 'term')} and all progress will be removed from this browser.`,
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    const snap = await data.deleteSet(set.id);
    navigate('/');
    toast('Set deleted', { timeout: 8000, action: { label: 'Undo', onClick: async () => { await data.restoreSet(snap.set, snap.progress); navigate(`/set/${snap.set.id}`); } } });
  }
  function rerender() { host.replaceChildren(); paint(host, set, progress); }

  const head = el('div', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('h1', {}, set.title),
      el('p', { class: 'page-head__sub' },
        plural(set.terms.length, 'term'),
        set.folder ? ' · ' + set.folder : '',
        ' · updated ' + relTime(set.updatedAt),
        due ? ' · ' + due : ''),
      set.description ? el('p', { style: { marginTop: '8px', color: 'var(--c-text-mid)' } }, set.description) : null),
    el('div', { class: 'page-head__actions' },
      el('a', { class: 'btn', href: `#/set/${set.id}/edit` }, icon('pencil'), 'Edit'),
      menuBtn),
  );

  const empty = set.terms.length === 0;

  const modeTiles = el('div', { class: 'mode-grid' }, ...MODES.map(m => el('a', {
    class: 'mode-tile', href: empty ? '#/set/' + set.id + '/edit' : `#/set/${set.id}/${m.id}`,
    'aria-disabled': empty ? 'true' : null,
    onclick: empty ? (e) => { e.preventDefault(); toast('Add some terms first'); navigate(`/set/${set.id}/edit`); } : null,
  }, icon(m.icon), el('span', {}, m.label, el('small', {}, m.sub)))));

  const progressCard = el('div', { class: 'card card__pad', style: { marginBottom: '18px' } },
    el('div', { class: 'row row--between', style: { marginBottom: '12px' } },
      el('h2', { style: { fontSize: '1rem' } }, 'Your progress'),
      el('span', { class: 'chip chip--accent' }, `${stats.pct}% mastered`)),
    segBar(stats),
    el('div', { class: 'legend', style: { marginTop: '10px' } },
      el('span', {}, el('i', { style: { background: 'var(--c-good)' } }), `${stats.mastered} mastered`),
      el('span', {}, el('i', { style: { background: 'var(--c-warn)' } }), `${stats.learning} still learning`),
      el('span', {}, el('i', { style: { background: 'var(--c-border-strong)' } }), `${stats.notStarted} not started`),
      stats.starred ? el('span', {}, el('i', { style: { background: 'var(--c-star)' } }), `${stats.starred} starred`) : null),
  );

  host.append(head, modeTiles, el('div', { style: { height: '18px' } }), empty ? emptyTerms(set) : progressCard);
  if (!empty) host.appendChild(termList(set, progress, rerender));
}

function emptyTerms(set) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty__icon' }, icon('cards')),
    el('h2', {}, 'This set has no terms yet'),
    el('p', {}, 'Add them by hand, or paste a list in from another app.'),
    el('div', { class: 'row', style: { justifyContent: 'center' } },
      el('a', { class: 'btn btn--primary', href: `#/set/${set.id}/edit` }, icon('plus'), 'Add terms'),
      el('a', { class: 'btn', href: `#/import?set=${encodeURIComponent(set.id)}` }, icon('upload'), 'Paste a list')));
}

function termList(set, progress, rerender) {
  let shown = CHUNK;
  let filter = 'all';
  let query = '';

  const listHost = el('div', { id: 'term-list' });
  const moreWrap = el('div', { style: { textAlign: 'center', marginTop: '10px' } });

  const search = el('input', { class: 'input', type: 'search', placeholder: 'Filter terms…', 'aria-label': 'Filter terms', style: { maxWidth: '220px' } });
  const onSearch = debounce(() => { query = search.value.trim().toLowerCase(); shown = CHUNK; paintRows(); }, 140);
  search.addEventListener('input', onSearch);

  const filterSeg = el('div', { class: 'segment', role: 'group', 'aria-label': 'Filter terms' },
    ...[['all', 'All'], ['learning', 'Still learning'], ['mastered', 'Mastered'], ['starred', 'Starred']].map(([v, label]) =>
      el('button', { type: 'button', 'aria-pressed': String(filter === v), onclick: (e) => {
        filter = v; shown = CHUNK;
        Array.from(e.target.parentNode.children).forEach(c => c.setAttribute('aria-pressed', String(c === e.target)));
        paintRows();
      } }, label)));

  function rows() {
    return set.terms.filter(t => {
      if (query && !(t.term.toLowerCase().includes(query) || t.definition.toLowerCase().includes(query))) return false;
      const c = progress.cards[t.id];
      if (filter === 'starred') return t.starred;
      if (filter === 'mastered') return c && c.status === 'mastered';
      if (filter === 'learning') return c && c.status === 'learning';
      return true;
    });
  }

  function paintRows() {
    const list = rows();
    listHost.replaceChildren();
    if (!list.length) {
      listHost.appendChild(el('p', { style: { color: 'var(--c-text-dim)', padding: '18px 2px' } }, 'No terms match that filter.'));
      moreWrap.replaceChildren();
      return;
    }
    listHost.appendChild(frag(...list.slice(0, shown).map(t => termRow(t, progress, set))));
    moreWrap.replaceChildren();
    if (list.length > shown) {
      moreWrap.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => { shown += CHUNK; paintRows(); } },
        `Show ${Math.min(CHUNK, list.length - shown)} more of ${list.length}`));
    }
  }

  function termRow(t, prog, theSet) {
    const c = prog.cards[t.id];
    const statusColor = !c || c.status === 'new' ? 'var(--c-border)' : c.status === 'mastered' ? 'var(--c-good)' : 'var(--c-warn)';
    const starBtn = el('button', {
      class: 'icon-btn icon-btn--sm star-btn', type: 'button',
      'aria-pressed': String(!!t.starred), 'aria-label': `Star ${truncate(t.term, 30)}`,
      onclick: async () => {
        t.starred = !t.starred;
        starBtn.setAttribute('aria-pressed', String(t.starred));
        try { await data.saveSet(theSet); } catch { toast('Could not save', { type: 'bad' }); }
      },
    }, icon('star'));

    const speakBtn = speech.supported ? el('button', {
      class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `Read ${truncate(t.term, 30)} aloud`,
      onclick: () => speech.speak(t.term, { lang: theSet.termLang }),
    }, icon('sound')) : null;

    return el('div', { class: 'term-row', style: { '--term-status': statusColor } },
      el('div', { class: 'term-row__t' }, t.term || el('span', { style: { color: 'var(--c-text-dim)' } }, '(empty)')),
      el('div', { class: 'term-row__d' }, t.definition || el('span', { style: { color: 'var(--c-text-dim)' } }, '(empty)')),
      el('div', { class: 'term-row__tools' }, speakBtn, starBtn),
    );
  }

  paintRows();
  return el('div', {},
    el('div', { class: 'toolbar', style: { margin: '26px 0 12px' } },
      el('h2', { class: 'toolbar__title' }, `Terms in this set (${set.terms.length})`),
      el('div', { class: 'toolbar__controls' }, search, filterSeg)),
    listHost, moreWrap);
}
