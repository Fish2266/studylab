/* views/shared.js — landing page for a "#/s/..." share link.
 * The set travels inside the URL fragment, so nothing was ever sent to a server.
 */
import { el, icon, plural, truncate, setChildren } from '../utils.js';
import * as data from '../data.js';
import { toast } from '../ui.js';
import { navigate } from '../router.js';
import { readShareLink } from '../share.js';

export function render(mount, { params }) {
  const code = params[0] || '';
  const host = el('div', {});
  mount.className = 'main main--focus';
  mount.appendChild(host);
  let destroyed = false;

  host.appendChild(el('div', { class: 'row', style: { padding: '40px', justifyContent: 'center' } }, el('div', { class: 'spinner' })));

  readShareLink(code).then(payload => {
    if (destroyed) return;
    paint(host, payload);
  }).catch(err => {
    if (destroyed) return;
    host.replaceChildren(el('div', { class: 'empty' },
      el('div', { class: 'empty__icon' }, icon('warn')),
      el('h1', {}, 'This share link could not be opened'),
      el('p', {}, err.message || 'The link looks incomplete — links are sometimes cut short by chat apps.'),
      el('a', { class: 'btn btn--primary', href: '#/' }, 'Go to your library')));
  });

  return { destroy() { destroyed = true; } };
}

function paint(host, payload) {
  const usable = payload.terms.filter(t => t.term || t.definition);

  const saveBtn = el('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: save }, icon('plus'), 'Save to my library');

  setChildren(host,
    el('div', { class: 'page-head' },
      el('div', { class: 'page-head__text' },
        el('span', { class: 'chip chip--accent' }, icon('link'), 'Shared set'),
        el('h1', { style: { marginTop: '8px' } }, payload.title),
        payload.description ? el('p', { class: 'page-head__sub' }, payload.description) : null,
        el('p', { class: 'page-head__sub' }, `${plural(usable.length, 'card')} · nothing is saved until you choose to`))),

    el('div', { class: 'row', style: { marginBottom: '18px' } }, saveBtn,
      el('a', { class: 'btn', href: '#/' }, 'Not now')),

    el('div', { class: 'tbl__scroll' },
      el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, el('th', { style: { width: '42%' } }, 'Term'), el('th', {}, 'Definition'))),
        el('tbody', {}, ...usable.slice(0, 100).map(t =>
          el('tr', {}, el('td', {}, t.term), el('td', {}, t.definition)))))),
    usable.length > 100 ? el('p', { class: 'field__hint' }, `…and ${usable.length - 100} more`) : null,
  );

  async function save() {
    saveBtn.disabled = true;
    try {
      const set = data.newSet({
        title: payload.title, description: payload.description,
        termLang: payload.termLang, defLang: payload.defLang, terms: usable,
      });
      await data.saveSet(set);
      toast(`Saved “${truncate(set.title, 30)}” to your library`, { type: 'good' });
      navigate(`/set/${set.id}`);
    } catch (err) {
      saveBtn.disabled = false;
      toast(`Could not save: ${err.message}`, { type: 'bad' });
    }
  }
}
