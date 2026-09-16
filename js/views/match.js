/* views/match.js — the timed pairing game. Pick a term, pick its definition. */
import { el, icon, shuffle, sample, isTyping, plural, clamp } from '../utils.js';
import * as data from '../data.js';
import { toast } from '../ui.js';
import { kvGet, kvSet } from '../storage.js';
import { openOptions, optionGroup, numberRow, selectRow } from './options.js';

const PENALTY_MS = 1000;

export function render(mount, { params }) {
  const setId = params[0];
  const session = { alive: true, raf: 0, keyHandler: null, countdown: null };
  const host = el('div', { class: 'study' });
  mount.className = 'main main--focus';
  mount.appendChild(host);

  (async () => {
    const set = await data.getSet(setId);
    if (!session.alive) return;
    const usable = set ? set.terms.filter(t => t.term.trim() && t.definition.trim()) : [];
    if (!set || usable.length < 2) {
      host.appendChild(el('div', { class: 'empty' },
        el('h1', {}, 'Match needs at least two complete cards'),
        el('p', {}, 'Add a few terms with both sides filled in, then come back.'),
        el('a', { class: 'btn btn--primary', href: `#/set/${setId}/edit` }, 'Edit this set')));
      return;
    }
    const best = await kvGet(`best:match:${setId}`, null);
    if (!session.alive) return;
    start(host, set, usable, best, session);
  })();

  return {
    destroy() {
      session.alive = false;
      cancelAnimationFrame(session.raf);
      clearTimeout(session.countdown);
      if (session.keyHandler) document.removeEventListener('keydown', session.keyHandler);
    },
  };
}

function start(host, set, usable, best, session) {
  let opts = { ...data.getSettings().match };
  let tiles = [];
  let selected = null;
  let matched = 0;
  let startedAt = 0;
  let penalties = 0;
  let running = false;
  let bestMs = best;

  const timerEl = el('span', { class: 'timer' }, '0:00');
  const bestEl = el('span', { class: 'chip' });
  const board = el('div', { class: 'match-board' });
  const stage = el('div', {});

  const optionsBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Options', 'aria-label': 'Match options', onclick: showOptions }, icon('cog'));

  host.append(
    el('div', { class: 'study__head' },
      el('div', { class: 'study__title' }, el('h1', {}, 'Match'), el('p', {}, set.title)),
      el('div', { class: 'study__tools' }, bestEl, timerEl, optionsBtn,
        el('a', { class: 'icon-btn', href: `#/set/${set.id}`, 'aria-label': 'Back to set' }, icon('x'))),
    ),
    stage,
  );

  function refreshBest() {
    bestEl.textContent = bestMs ? `Best ${fmt(bestMs)}` : 'No best time yet';
  }

  function pool() {
    if (opts.source === 'starred') {
      const starred = usable.filter(t => t.starred);
      if (starred.length >= 2) return starred;
      toast('Fewer than two starred cards, so all cards are in play.', { timeout: 4000 });
    }
    return usable;
  }

  function newGame() {
    const list = pool();
    const pairs = clamp(opts.pairs, 2, Math.min(12, list.length));
    const picked = sample(list, pairs);
    tiles = shuffle(picked.flatMap(t => ([
      { id: t.id + ':t', pairId: t.id, text: t.term, side: 'term' },
      { id: t.id + ':d', pairId: t.id, text: t.definition, side: 'def' },
    ])));
    selected = null;
    matched = 0;
    penalties = 0;
    running = false;
    startedAt = 0;
    timerEl.textContent = '0:00';
    timerEl.classList.remove('is-low');
    paintBoard();
  }

  function paintBoard() {
    // Choose a column count that divides the tiles evenly where possible.
    const n = tiles.length;
    const cols = [6, 5, 4, 3].find(c => n % c === 0 && n / c >= 2) || 4;
    board.style.setProperty('--match-cols', String(cols));
    board.replaceChildren(...tiles.map(tile => el('button', {
      class: 'match-tile', type: 'button', 'data-id': tile.id,
      'aria-label': tile.text,
      onclick: () => pick(tile),
    }, tile.text)));
    stage.replaceChildren(
      el('p', { class: 'field__hint', style: { marginBottom: '10px' } },
        `Pair each term with its definition. A wrong pair adds ${PENALTY_MS / 1000} second.`),
      board,
      el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '16px' } },
        el('button', { class: 'btn', type: 'button', onclick: newGame }, icon('undo'), 'New game'),
        el('a', { class: 'btn btn--ghost', href: `#/set/${set.id}` }, 'Back to set')),
    );
  }

  const nodeFor = (tile) => board.querySelector(`[data-id="${CSS.escape(tile.id)}"]`);

  function pick(tile) {
    const node = nodeFor(tile);
    if (!node || node.classList.contains('is-gone')) return;
    if (!running) { running = true; startedAt = Date.now(); loop(); }

    if (selected && selected.id === tile.id) {
      selected = null;
      node.classList.remove('is-sel');
      return;
    }
    if (!selected) {
      selected = tile;
      node.classList.add('is-sel');
      return;
    }
    const prev = selected;
    const prevNode = nodeFor(prev);
    selected = null;

    if (prev.pairId === tile.pairId && prev.side !== tile.side) {
      [prevNode, node].forEach(n => { n.classList.remove('is-sel'); n.classList.add('is-hit'); n.disabled = true; });
      matched++;
      setTimeout(() => {
        [prevNode, node].forEach(n => n.classList.add('is-gone'));
        if (matched === tiles.length / 2) finish();
      }, 180);
    } else {
      penalties += PENALTY_MS;
      [prevNode, node].forEach(n => { n.classList.remove('is-sel'); n.classList.add('is-miss'); });
      setTimeout(() => [prevNode, node].forEach(n => n && n.classList.remove('is-miss')), 400);
    }
  }

  function elapsed() { return running || startedAt ? Date.now() - startedAt + penalties : 0; }
  function loop() {
    cancelAnimationFrame(session.raf);
    const tick = () => {
      if (!session.alive || !running) return;
      timerEl.textContent = fmt(elapsed());
      session.raf = requestAnimationFrame(tick);
    };
    session.raf = requestAnimationFrame(tick);
  }

  async function finish() {
    running = false;
    cancelAnimationFrame(session.raf);
    const ms = elapsed();
    const isBest = !bestMs || ms < bestMs;
    if (isBest) {
      bestMs = ms;
      try { await kvSet(`best:match:${set.id}`, ms); } catch { /* not fatal */ }
    }
    refreshBest();

    stage.replaceChildren(el('div', { class: 'q-card round-done' },
      el('div', { style: { fontSize: '2.6rem' } }, isBest ? '🏆' : '⚡'),
      el('h2', { style: { marginTop: '10px' } }, isBest ? 'New best time' : 'Finished'),
      el('div', { class: 'test-score__big', style: { color: 'var(--c-accent)', margin: '10px 0' } }, fmt(ms)),
      el('p', { class: 'round-done__sub' },
        `${plural(tiles.length / 2, 'pair')} matched${penalties ? ` · ${penalties / 1000}s of penalties` : ' with no mistakes'}.`
        + (bestMs && !isBest ? ` Best: ${fmt(bestMs)}.` : '')),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        el('button', { class: 'btn btn--primary btn--lg', type: 'button', 'data-autofocus': '', onclick: newGame }, icon('undo'), 'Play again'),
        el('a', { class: 'btn', href: `#/set/${set.id}/learn` }, icon('brain'), 'Switch to Learn'),
        el('a', { class: 'btn btn--ghost', href: `#/set/${set.id}` }, 'Back to set'))));
    const again = stage.querySelector('.btn--primary');
    if (again) requestAnimationFrame(() => again.focus({ preventScroll: true }));
  }

  function showOptions() {
    const d = { ...opts };
    const max = Math.min(12, usable.length);
    openOptions({
      title: 'Match options',
      groups: [optionGroup('Game', [
        numberRow('Pairs per game', `Up to ${max} with this set`, Math.min(d.pairs, max), 2, max, v => { d.pairs = v; }),
        selectRow('Which cards', '', d.source,
          [['all', 'All cards'], ['starred', 'Starred only']], v => { d.source = v; }),
      ])],
      onApply: async () => { opts = d; await data.saveModeOptions('match', opts); newGame(); },
      onReset: async () => { opts = { ...data.DEFAULT_SETTINGS.match }; await data.saveModeOptions('match', opts); newGame(); },
    });
  }

  session.keyHandler = (e) => {
    if (isTyping(e) || document.querySelector('.modal-backdrop')) return;
    if (e.key.toLowerCase() === 'r') { e.preventDefault(); newGame(); }
    if (e.key === 'Escape' && selected) {
      const n = nodeFor(selected);
      if (n) n.classList.remove('is-sel');
      selected = null;
    }
  };
  document.addEventListener('keydown', session.keyHandler);

  refreshBest();
  newGame();
}

function fmt(ms) {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
