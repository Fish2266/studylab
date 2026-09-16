/* views/library.js — the home screen: search, filter and manage every saved set. */
import { el, icon, frag, relTime, plural, debounce, truncate } from '../utils.js';
import * as data from '../data.js';
import { toast, confirmDialog, openMenu } from '../ui.js';
import { navigate } from '../router.js';
import { openExportDialog, openShareDialog } from './dialogs.js';

const PAGE = 24;                     // rows rendered per chunk — keeps 1000-set libraries smooth

export function render(mount) {
  const s = data.getSettings();
  let query = '';
  let folder = '';
  let sort = s.library.sort;
  let view = s.library.view;
  let shown = PAGE;

  const results = el('div', { class: 'set-grid', id: 'lib-results' });
  const count = el('p', { class: 'page-head__sub' });
  const moreWrap = el('div', { style: { textAlign: 'center', marginTop: '18px' } });

  const search = el('input', {
    class: 'input', type: 'search', placeholder: 'Search sets and terms…',
    'aria-label': 'Search sets', style: { maxWidth: '280px' }, id: 'lib-search',
  });
  const onSearch = debounce(() => { query = search.value.trim().toLowerCase(); shown = PAGE; paint(); }, 160);
  search.addEventListener('input', onSearch);

  const sortSel = el('select', { class: 'select', 'aria-label': 'Sort sets', style: { width: 'auto' }, onchange: e => {
    sort = e.target.value; data.saveSettings({ library: { sort } }); paint();
  } },
    el('option', { value: 'updated' }, 'Recently updated'),
    el('option', { value: 'created' }, 'Recently created'),
    el('option', { value: 'title' }, 'Title A–Z'),
    el('option', { value: 'size' }, 'Most terms'),
  );
  sortSel.value = sort;

  const folderSel = el('select', { class: 'select', 'aria-label': 'Filter by folder', style: { width: 'auto' }, onchange: e => { folder = e.target.value; shown = PAGE; paint(); } });

  const viewToggle = el('div', { class: 'segment', role: 'group', 'aria-label': 'Layout' },
    ...[['grid', 'Grid'], ['list', 'List']].map(([v, label]) => el('button', {
      type: 'button', 'aria-pressed': String(view === v),
      onclick: (e) => {
        view = v;
        Array.from(e.target.parentNode.children).forEach(c => c.setAttribute('aria-pressed', String(c === e.target)));
        data.saveSettings({ library: { view } });
        paint();
      },
    }, label)),
  );

  mount.append(
    el('div', { class: 'page-head' },
      el('div', { class: 'page-head__text' }, el('h1', {}, 'Your library'), count),
      el('div', { class: 'page-head__actions' },
        el('a', { class: 'btn', href: '#/import' }, icon('upload'), 'Import'),
        el('a', { class: 'btn btn--primary', href: '#/create' }, icon('plus'), 'Create set'),
      ),
    ),
    el('div', { class: 'toolbar', style: { marginBottom: '16px' } },
      el('div', { class: 'toolbar__controls', style: { marginRight: 'auto' } }, search, sortSel, folderSel),
      viewToggle),
    results,
    moreWrap,
  );

  function filtered() {
    const idx = data.getIndex();
    let rows = idx;
    if (folder) rows = rows.filter(r => r.folder === folder);
    if (query) rows = rows.filter(r => r.title.toLowerCase().includes(query) || r.description.toLowerCase().includes(query));
    const by = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      created: (a, b) => b.createdAt - a.createdAt,
      title: (a, b) => a.title.localeCompare(b.title),
      size: (a, b) => b.count - a.count,
    }[sort] || ((a, b) => b.updatedAt - a.updatedAt);
    return rows.slice().sort(by);
  }

  function paintFolders() {
    const list = data.folders();
    folderSel.replaceChildren(el('option', { value: '' }, 'All folders'), ...list.map(f => el('option', { value: f }, f)));
    folderSel.value = folder;
    folderSel.hidden = list.length === 0;
  }

  function paint() {
    paintFolders();
    const rows = filtered();
    const total = data.getIndex().length;
    count.textContent = total === 0 ? 'No sets yet'
      : `${plural(rows.length, 'set')}${rows.length !== total ? ` of ${total}` : ''} · ${plural(rows.reduce((n, r) => n + r.count, 0), 'term')}`;

    results.className = view === 'list' ? 'stack' : 'set-grid';
    results.replaceChildren();

    if (!total) { mountEmpty(); return; }
    if (!rows.length) {
      results.appendChild(el('div', { class: 'empty' },
        el('h2', {}, 'No matches'),
        el('p', {}, `Nothing matched “${truncate(query, 40)}”.`),
        el('button', { class: 'btn', type: 'button', onclick: () => { search.value = ''; query = ''; folder = ''; paint(); } }, 'Clear filters')));
      moreWrap.replaceChildren();
      return;
    }

    const slice = rows.slice(0, shown);
    results.appendChild(frag(...slice.map(r => setCard(r, view))));

    moreWrap.replaceChildren();
    if (rows.length > shown) {
      moreWrap.appendChild(el('button', { class: 'btn', type: 'button', onclick: () => { shown += PAGE; paint(); } },
        `Show ${Math.min(PAGE, rows.length - shown)} more`));
    }
  }

  function mountEmpty() {
    moreWrap.replaceChildren();
    results.className = '';
    results.replaceChildren(el('div', { class: 'empty' },
      el('div', { class: 'empty__icon' }, icon('cards')),
      el('h2', {}, 'Nothing here yet'),
      el('p', {}, 'Create a set from scratch, or bring one in from Quizlet, Anki, a spreadsheet or a plain text list.'),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        el('a', { class: 'btn btn--primary', href: '#/create' }, icon('plus'), 'Create a set'),
        el('a', { class: 'btn', href: '#/import' }, icon('upload'), 'Import'),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: addSample }, 'Add a sample set'),
      ),
    ));
  }

  async function addSample() {
    const set = data.newSet({
      title: 'Sample — Solar System',
      description: 'A short demo set so you can try Flashcards, Learn and Test right away.',
      terms: [
        { term: 'Mercury', definition: 'The smallest planet and the closest to the Sun' },
        { term: 'Venus', definition: 'The hottest planet, wrapped in thick carbon-dioxide clouds' },
        { term: 'Earth', definition: 'The only planet known to support life' },
        { term: 'Mars', definition: 'The red planet, home to the tallest volcano in the solar system' },
        { term: 'Jupiter', definition: 'The largest planet; a gas giant with a centuries-old storm' },
        { term: 'Saturn', definition: 'The gas giant famous for its bright ring system' },
        { term: 'Uranus', definition: 'An ice giant that rotates on its side' },
        { term: 'Neptune', definition: 'The windiest planet and the farthest from the Sun' },
      ],
    });
    await data.saveSet(set);
    toast('Sample set added', { type: 'good' });
    navigate(`/set/${set.id}`);
  }

  function setCard(row, mode) {
    const menuBtn = el('button', {
      class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `Actions for ${row.title}`,
      'aria-haspopup': 'menu', 'aria-expanded': 'false',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openMenu(menuBtn, cardMenu(row)); },
    }, icon('dots'));

    const meta = el('div', { class: 'set-card__meta' },
      el('span', { class: 'chip' }, plural(row.count, 'term')),
      row.folder ? el('span', { class: 'chip' }, icon('folder'), row.folder) : null,
      el('span', {}, 'Edited ' + relTime(row.updatedAt)),
    );

    if (mode === 'list') {
      return el('div', { class: 'set-card', style: { flexDirection: 'row', alignItems: 'center', gap: '14px' } },
        el('a', { class: 'set-card__link', href: `#/set/${row.id}`, 'aria-label': `Open ${row.title}` }),
        el('div', { style: { flex: '1', minWidth: '0' } },
          el('div', { class: 'set-card__title' }, row.title),
          row.description ? el('p', { class: 'set-card__desc' }, row.description) : null),
        meta, el('div', { class: 'set-card__menu' }, menuBtn));
    }
    return el('div', { class: 'set-card' },
      el('a', { class: 'set-card__link', href: `#/set/${row.id}`, 'aria-label': `Open ${row.title}` }),
      el('div', { class: 'set-card__top' },
        el('div', { class: 'set-card__title' }, row.title),
        el('div', { class: 'set-card__menu' }, menuBtn)),
      row.description ? el('p', { class: 'set-card__desc' }, row.description) : null,
      meta);
  }

  function cardMenu(row) {
    return [
      { label: 'Study', iconName: 'brain', onClick: () => navigate(`/set/${row.id}`) },
      { label: 'Edit', iconName: 'pencil', onClick: () => navigate(`/set/${row.id}/edit`) },
      null,
      { label: 'Duplicate', iconName: 'copy', onClick: () => dup(row) },
      { label: 'Export…', iconName: 'download', onClick: async () => { const set = await data.getSet(row.id); set && openExportDialog(set); } },
      { label: 'Share link…', iconName: 'link', onClick: async () => { const set = await data.getSet(row.id); set && openShareDialog(set); } },
      null,
      { label: 'Delete', iconName: 'trash', danger: true, onClick: () => remove(row) },
    ];
  }

  async function dup(row) {
    try {
      const copy = await data.duplicateSet(row.id);
      paint();
      toast(`Duplicated “${truncate(copy.title, 30)}”`, { type: 'good', action: { label: 'Open', onClick: () => navigate(`/set/${copy.id}`) } });
    } catch { toast('Could not duplicate that set', { type: 'bad' }); }
  }

  async function remove(row) {
    if (data.getSettings().confirmDelete) {
      const ok = await confirmDialog({
        title: `Delete “${truncate(row.title, 40)}”?`,
        message: `This removes ${plural(row.count, 'term')} and its study progress from this browser.`,
        detail: 'You will have a few seconds to undo.',
        confirmLabel: 'Delete', danger: true,
      });
      if (!ok) return;
    }
    try {
      const snapshot = await data.deleteSet(row.id);
      paint();
      toast('Set deleted', {
        timeout: 8000,
        action: { label: 'Undo', onClick: async () => { await data.restoreSet(snapshot.set, snapshot.progress); paint(); toast('Set restored', { type: 'good' }); } },
      });
    } catch { toast('Could not delete that set', { type: 'bad' }); }
  }

  paint();
  requestAnimationFrame(() => { if (data.getIndex().length > 6) search.focus({ preventScroll: true }); });

  return { destroy() { onSearch.cancel(); } };
}
