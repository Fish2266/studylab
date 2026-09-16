/* views/editor.js — create and edit a set.
 *
 * Rows are rendered in chunks and all row interaction is handled by one
 * delegated listener on the container, so a 2,000-term set still edits smoothly.
 * Edits autosave after a pause; leaving with unsaved work asks first.
 */
import { el, icon, frag, autoGrow, debounce, plural } from '../utils.js';
import * as data from '../data.js';
import { toast, confirmDialog, promptDialog, openMenu, modal } from '../ui.js';
import { navigate, setGuard } from '../router.js';

const CHUNK = 40;

export function render(mount, { params, path }) {
  const isNew = path === '/create';
  const host = el('div', {});
  mount.appendChild(host);
  let destroyed = false;
  let teardown = null;

  (async () => {
    let set;
    if (isNew) {
      set = data.newSet({ terms: [{}, {}, {}, {}] });
    } else {
      set = await data.getSet(params[0]);
      if (destroyed) return;
      if (!set) {
        host.appendChild(el('div', { class: 'empty' }, el('h1', {}, 'Set not found'),
          el('a', { class: 'btn btn--primary', href: '#/' }, 'Back to library')));
        return;
      }
      if (!set.terms.length) set.terms.push(data.newTerm({}));
    }
    if (destroyed) return;
    teardown = build(host, set, isNew);
  })();

  return {
    destroy() {
      destroyed = true;
      setGuard(null);
      if (teardown) teardown();
    },
  };
}

function build(host, set, isNew) {
  let dirty = isNew;
  let saving = false;
  let shown = CHUNK;

  const status = el('span', { class: 'field__hint', style: { marginLeft: 'auto' }, role: 'status' },
    isNew ? 'Not saved yet' : 'All changes saved');
  const rowsHost = el('div', { id: 'edit-rows' });
  const moreWrap = el('div', { style: { textAlign: 'center', margin: '10px 0' } });

  /* ---- persistence ---- */
  const autosave = debounce(() => { if (dirty && !isNew) save({ quiet: true }); }, 1200);
  function markDirty() {
    dirty = true;
    status.textContent = 'Unsaved changes...';
    status.style.color = 'var(--c-warn)';
    autosave();
  }
  async function save({ quiet = false, navigateTo = null } = {}) {
    if (saving) return false;
    saving = true;
    autosave.cancel();
    set.title = titleInput.value.trim() || 'Untitled set';
    set.description = descInput.value.trim();
    set.folder = folderInput.value.trim();
    set.termLang = langTerm.value.trim();
    set.defLang = langDef.value.trim();
    // Drop rows the user left completely blank rather than saving noise.
    const kept = set.terms.filter(t => t.term.trim() || t.definition.trim());
    if (kept.length !== set.terms.length) { set.terms = kept.length ? kept : [data.newTerm({})]; paintRows(); }
    try {
      await data.saveSet(set);
      dirty = false;
      status.textContent = 'All changes saved';
      status.style.color = '';
      if (!quiet) toast('Saved', { type: 'good', timeout: 1800 });
      if (navigateTo) navigate(navigateTo);
      return true;
    } catch (err) {
      status.textContent = 'Could not save';
      status.style.color = 'var(--c-bad)';
      toast(err.quota ? 'Storage is full. Export a backup, then delete some sets.' : `Could not save: ${err.message}`,
        { type: 'bad', timeout: 7000 });
      return false;
    } finally { saving = false; }
  }

  setGuard(async () => {
    if (!dirty) return true;
    const hasContent = set.terms.some(t => t.term.trim() || t.definition.trim()) || titleInput.value.trim();
    if (!hasContent) return true;
    // Three outcomes, because "dismiss the dialog" must not silently discard work.
    const choice = await modal({
      title: 'You have unsaved changes',
      build: ({ close, body, foot }) => {
        body.appendChild(el('p', {}, 'Save this set before leaving, or discard what you have changed?'));
        foot.append(
          el('button', { class: 'btn btn--ghost', type: 'button', style: { marginRight: 'auto' }, onclick: () => close('discard') }, 'Discard changes'),
          el('button', { class: 'btn', type: 'button', onclick: () => close('stay') }, 'Keep editing'),
          el('button', { class: 'btn btn--primary', type: 'button', 'data-autofocus': '', onclick: () => close('save') }, 'Save and leave'),
        );
      },
    });
    if (choice === 'save') return await save({ quiet: true });
    if (choice === 'discard') { dirty = false; return true; }
    return false;                                      // dismissed, or "Keep editing"
  });

  const onBeforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBeforeUnload);

  /* ---- header fields ---- */
  const titleInput = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Biology, chapter 4', maxlength: '300', oninput: markDirty });
  titleInput.value = isNew ? '' : set.title;
  const descInput = el('input', { class: 'input', type: 'text', placeholder: 'Optional description', maxlength: '2000', oninput: markDirty });
  descInput.value = set.description;
  const folderInput = el('input', { class: 'input', type: 'text', placeholder: 'Optional folder', list: 'folder-list', maxlength: '120', oninput: markDirty });
  folderInput.value = set.folder;
  const langTerm = el('input', { class: 'input', type: 'text', placeholder: 'e.g. en', maxlength: '20', oninput: markDirty });
  langTerm.value = set.termLang;
  const langDef = el('input', { class: 'input', type: 'text', placeholder: 'e.g. es', maxlength: '20', oninput: markDirty });
  langDef.value = set.defLang;

  const datalist = el('datalist', { id: 'folder-list' }, ...data.folders().map(f => el('option', { value: f })));

  /* ---- rows ---- */
  const indexOfId = (id) => set.terms.findIndex(t => t.id === id);

  function rowNode(t, i) {
    const termTa = el('textarea', { class: 'input autogrow', rows: '1', 'data-f': 'term', 'aria-label': `Term ${i + 1}`, placeholder: 'Term' });
    const defTa = el('textarea', { class: 'input autogrow', rows: '1', 'data-f': 'definition', 'aria-label': `Definition ${i + 1}`, placeholder: 'Definition' });
    termTa.value = t.term;
    defTa.value = t.definition;
    const node = el('div', { class: 'edit-row', 'data-id': t.id },
      el('div', { class: 'edit-row__n' }, String(i + 1)),
      el('div', { class: 'cell-term' }, termTa),
      el('div', { class: 'cell-def' }, defTa),
      el('div', { class: 'term-row__tools' },
        el('button', { class: 'icon-btn icon-btn--sm drag-handle', type: 'button', 'data-a': 'drag', 'aria-label': `Reorder row ${i + 1}`, title: 'Drag to reorder' }, icon('grip')),
        el('button', { class: 'icon-btn icon-btn--sm star-btn', type: 'button', 'data-a': 'star', 'aria-pressed': String(!!t.starred), 'aria-label': `Star row ${i + 1}` }, icon('star')),
        el('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'data-a': 'more', 'aria-label': `More options for row ${i + 1}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('dots')),
        el('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'data-a': 'del', 'aria-label': `Delete row ${i + 1}` }, icon('trash')),
      ),
    );
    if (t.hint !== undefined && t.hint !== '') {
      const hintInput = el('input', { class: 'input', type: 'text', placeholder: 'Hint', 'data-f': 'hint', 'aria-label': `Hint for row ${i + 1}`, style: { gridColumn: '2 / -1', fontSize: '.86rem' } });
      hintInput.value = t.hint;
      node.appendChild(hintInput);
    }
    return node;
  }

  function paintRows() {
    rowsHost.replaceChildren(frag(...set.terms.slice(0, shown).map(rowNode)));
    paintMore();
    // Size the textareas once per paint rather than once per keystroke.
    requestAnimationFrame(() => { rowsHost.querySelectorAll('.autogrow').forEach(autoGrow); });
  }
  function paintMore() {
    moreWrap.replaceChildren();
    if (set.terms.length > shown) {
      moreWrap.appendChild(el('button', {
        class: 'btn', type: 'button',
        onclick: () => { shown += CHUNK; paintRows(); },
      }, `Show ${Math.min(CHUNK, set.terms.length - shown)} more of ${set.terms.length}`));
    }
  }
  /** Renumber visible rows in place — cheaper than re-rendering them. */
  function renumber(from = 0) {
    const rows = rowsHost.children;
    for (let i = from; i < rows.length; i++) {
      const row = rows[i];
      row.querySelector('.edit-row__n').textContent = String(i + 1);
      row.querySelector('[data-f="term"]').setAttribute('aria-label', `Term ${i + 1}`);
      row.querySelector('[data-f="definition"]').setAttribute('aria-label', `Definition ${i + 1}`);
    }
  }

  rowsHost.addEventListener('input', (e) => {
    const field = e.target.dataset && e.target.dataset.f;
    if (!field) return;
    const row = e.target.closest('.edit-row');
    const t = set.terms[indexOfId(row.dataset.id)];
    if (!t) return;
    t[field] = e.target.value;
    if (e.target.classList.contains('autogrow')) autoGrow(e.target);
    markDirty();
  });

  rowsHost.addEventListener('keydown', (e) => {
    if (!e.target.dataset || !e.target.dataset.f) return;
    const row = e.target.closest('.edit-row');
    const i = indexOfId(row.dataset.id);
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.target.dataset.f === 'term') row.querySelector('[data-f="definition"]').focus();
      else addRow(i + 1);
    } else if (e.key === 'Backspace' && !e.target.value && set.terms.length > 1) {
      const otherSel = e.target.dataset.f === 'term' ? '[data-f="definition"]' : '[data-f="term"]';
      const other = row.querySelector(otherSel);
      if (other && !other.value) { e.preventDefault(); deleteRow(i, { focusPrev: true, silent: true }); }
    }
  });

  rowsHost.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-a]');
    if (!btn) return;
    const row = btn.closest('.edit-row');
    const i = indexOfId(row.dataset.id);
    const t = set.terms[i];
    if (!t) return;
    const action = btn.dataset.a;
    if (action === 'del') deleteRow(i);
    else if (action === 'star') { t.starred = !t.starred; btn.setAttribute('aria-pressed', String(t.starred)); markDirty(); }
    else if (action === 'more') openMenu(btn, [
      { label: t.hint ? 'Edit hint' : 'Add hint', iconName: 'pencil', onClick: async () => {
        const v = await promptDialog({ title: 'Hint', label: 'Shown when the learner asks for help', value: t.hint || '' });
        if (v === undefined) return;
        t.hint = v.trim(); markDirty(); paintRows();
      } },
      { label: 'Swap this card over', iconName: 'swap', onClick: () => {
        const tmp = t.term; t.term = t.definition; t.definition = tmp;
        markDirty(); paintRows();
      } },
      { label: 'Duplicate row', iconName: 'copy', onClick: () => {
        set.terms.splice(i + 1, 0, data.newTerm({ term: t.term, definition: t.definition, hint: t.hint, starred: t.starred }));
        markDirty(); paintRows();
      } },
      null,
      { label: 'Move to top', iconName: 'undo', onClick: () => move(i, 0) },
      { label: 'Move to bottom', iconName: 'undo', onClick: () => move(i, set.terms.length - 1) },
    ]);
  });

  /* drag to reorder, pointer-based so it also works on touch */
  rowsHost.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-a="drag"]');
    if (!handle) return;
    e.preventDefault();
    const row = handle.closest('.edit-row');
    const dragId = row.dataset.id;
    row.classList.add('is-dragging');
    try { handle.setPointerCapture(e.pointerId); } catch { /* not captured */ }

    const clearOver = () => rowsHost.querySelectorAll('.is-over').forEach(n => n.classList.remove('is-over'));
    const rowUnder = (x, y) => {
      const node = document.elementFromPoint(x, y);
      return node && node.closest ? node.closest('.edit-row') : null;
    };
    const onMove = (ev) => {
      const target = rowUnder(ev.clientX, ev.clientY);
      clearOver();
      if (target && target !== row) target.classList.add('is-over');
    };
    const onUp = (ev) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      row.classList.remove('is-dragging');
      const target = rowUnder(ev.clientX, ev.clientY);
      clearOver();
      if (target && target !== row) move(indexOfId(dragId), indexOfId(target.dataset.id));
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });

  function move(from, to) {
    if (from < 0 || to < 0 || from === to) return;
    const [t] = set.terms.splice(from, 1);
    set.terms.splice(to, 0, t);
    markDirty(); paintRows();
  }
  /**
   * Insert one row without re-rendering the rest. Rebuilding every row here
   * destroyed and recreated the focused textarea, which dropped the next few
   * keystrokes of anyone typing quickly.
   */
  function addRow(at = set.terms.length) {
    const t = data.newTerm({});
    set.terms.splice(at, 0, t);
    markDirty();

    if (at > shown) { shown = set.terms.length; paintRows(); }
    else {
      shown++;
      const node = rowNode(t, at);
      rowsHost.insertBefore(node, rowsHost.children[at] || null);
      renumber(at);
      paintMore();
      const field = node.querySelector('[data-f="term"]');
      field.focus();                                   // synchronous: no lost keystrokes
      autoGrow(field);
      node.scrollIntoView({ block: 'nearest' });
    }
  }
  function deleteRow(i, { focusPrev = false, silent = false } = {}) {
    if (set.terms.length === 1) { set.terms[0] = data.newTerm({}); markDirty(); paintRows(); return; }
    const removed = set.terms.splice(i, 1)[0];
    markDirty();
    const node = rowsHost.children[i];
    const hasHiddenRows = set.terms.length >= shown;
    if (node && !hasHiddenRows) { node.remove(); shown--; renumber(i); paintMore(); }
    else paintRows();                                  // a hidden row moves up into view

    if (focusPrev) {
      const prev = rowsHost.children[Math.max(0, i - 1)];
      const f = prev && prev.querySelector('[data-f="definition"]');
      if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
    }
    if (!silent) {
      toast('Row deleted', {
        timeout: 4500,
        action: { label: 'Undo', onClick: () => { set.terms.splice(i, 0, removed); markDirty(); paintRows(); } },
      });
    }
  }

  /* ---- bulk tools ---- */
  async function bulkSwap() {
    const ok = await confirmDialog({ title: 'Swap every term and definition?', message: 'Both sides of all cards in this set will trade places.', confirmLabel: 'Swap all' });
    if (!ok) return;
    set.terms.forEach(t => { const tmp = t.term; t.term = t.definition; t.definition = tmp; });
    const tmpLang = set.termLang; set.termLang = set.defLang; set.defLang = tmpLang;
    langTerm.value = set.termLang; langDef.value = set.defLang;
    markDirty(); paintRows();
    toast('Swapped all cards', { type: 'good' });
  }
  async function dedupe() {
    const seen = new Set();
    const keep = [];
    for (const t of set.terms) {
      const key = t.term.trim().toLowerCase() + ' ' + t.definition.trim().toLowerCase();
      if (key === ' ') { keep.push(t); continue; }
      if (seen.has(key)) continue;
      seen.add(key); keep.push(t);
    }
    const removed = set.terms.length - keep.length;
    if (!removed) { toast('No duplicate cards found'); return; }
    const ok = await confirmDialog({ title: `Remove ${plural(removed, 'duplicate')}?`, message: 'Cards with the same term and definition will be collapsed into one.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    set.terms = keep; markDirty(); paintRows();
    toast(`Removed ${plural(removed, 'duplicate')}`, { type: 'good' });
  }

  const toolsBtn = el('button', {
    class: 'btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: () => openMenu(toolsBtn, [
      { label: 'Swap all sides', iconName: 'swap', onClick: bulkSwap },
      { label: 'Remove duplicates', iconName: 'trash', onClick: dedupe },
      { label: 'Sort A to Z by term', iconName: 'undo', onClick: () => { set.terms.sort((a, b) => a.term.localeCompare(b.term)); markDirty(); paintRows(); } },
      null,
      { label: 'Paste a list...', iconName: 'upload', onClick: () => navigate(`/import?set=${encodeURIComponent(set.id)}`) },
    ]),
  }, icon('cog'), 'Tools');

  /* ---- layout ---- */
  host.append(
    datalist,
    el('div', { class: 'page-head' },
      el('div', { class: 'page-head__text' }, el('h1', {}, isNew ? 'Create a new set' : 'Edit set')),
      el('div', { class: 'page-head__actions' },
        toolsBtn,
        el('a', { class: 'btn', href: isNew ? '#/' : `#/set/${set.id}` }, 'Cancel'),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => save({ navigateTo: `/set/${set.id}` }) }, 'Save'),
      )),
    el('div', { class: 'card card__pad', style: { marginBottom: '18px' } },
      el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Title'), titleInput),
      el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Description'), descInput),
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Folder'), folderInput),
        el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Term language (read-aloud)'), langTerm),
        el('label', { class: 'field' }, el('span', { class: 'field__label' }, 'Definition language'), langDef)),
    ),
    el('div', { class: 'row row--between', style: { marginBottom: '10px' } },
      el('h2', { style: { fontSize: '1.05rem' } }, 'Cards'), status),
    rowsHost, moreWrap,
    el('button', { class: 'btn btn--block', type: 'button', onclick: () => addRow() }, icon('plus'), 'Add card'),
    el('div', { class: 'sticky-bar' },
      el('button', { class: 'btn', type: 'button', onclick: () => addRow() }, icon('plus'), 'Add card'),
      el('div', { style: { flex: '1' } }),
      el('button', { class: 'btn btn--primary', type: 'button', onclick: () => save({ navigateTo: `/set/${set.id}` }) }, 'Save and study'),
    ),
  );
  paintRows();
  requestAnimationFrame(() => titleInput.focus({ preventScroll: true }));

  return function teardown() {
    autosave.cancel();
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
