/* views/flashcards.js — classic flip cards with sorting, autoplay and audio. */
import { el, icon, shuffle, isTyping, plural, announce, clamp } from '../utils.js';
import * as data from '../data.js';
import { toast } from '../ui.js';
import { navigate } from '../router.js';
import * as speech from '../speech.js';
import { openOptions, optionGroup, checkboxRow, selectRow, rangeRow } from './options.js';

export function render(mount, { params }) {
  const setId = params[0];
  const session = { alive: true, timer: null, keyHandler: null };
  const host = el('div', { class: 'study' });
  mount.className = 'main main--focus';
  mount.appendChild(host);

  (async () => {
    const set = await data.getSet(setId);
    if (!session.alive) return;
    if (!set || !set.terms.length) { navigate(`/set/${setId}`, { replace: true }); return; }
    const progress = await data.getProgress(setId);
    if (!session.alive) return;
    start(host, set, progress, session);
  })();

  return {
    destroy() {
      session.alive = false;
      clearTimeout(session.timer);
      speech.cancel();
      if (session.keyHandler) document.removeEventListener('keydown', session.keyHandler);
      document.documentElement.classList.remove('is-locked');
    },
  };
}

function start(host, set, progress, session) {
  let opts = { ...data.getSettings().flashcards };
  let queue = [];
  let i = 0;
  let flipped = false;
  let playing = false;
  let full = false;
  let done = false;

  /* ---------- queue ---------- */
  function buildQueue({ keepPosition = false } = {}) {
    let pool = set.terms.slice();
    if (opts.starredOnly) pool = pool.filter(t => t.starred);
    if (opts.unknownOnly) pool = pool.filter(t => {
      const c = progress.cards[t.id];
      return !c || c.fc !== 'known';
    });
    if (!pool.length) {
      pool = set.terms.slice();
      if (opts.starredOnly || opts.unknownOnly) {
        toast('No cards matched those filters, so all cards are shown.', { timeout: 5000 });
        opts.starredOnly = false; opts.unknownOnly = false;
        data.saveModeOptions('flashcards', opts);
      }
    }
    queue = opts.shuffle ? shuffle(pool) : pool;
    if (!keepPosition) i = 0;
    i = clamp(i, 0, Math.max(0, queue.length - 1));
    flipped = false;
    done = false;
  }

  const current = () => queue[i];
  function sides(term) {
    const front = opts.front === 'random'
      ? ((hash(term.id) + i) % 2 === 0 ? 'term' : 'definition')
      : opts.front;
    return front === 'term'
      ? { frontText: term.term, backText: term.definition, frontLabel: 'Term', backLabel: 'Definition', frontLang: set.termLang, backLang: set.defLang }
      : { frontText: term.definition, backText: term.term, frontLabel: 'Definition', backLabel: 'Term', frontLang: set.defLang, backLang: set.termLang };
  }
  const hash = (s) => { let h = 0; for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0; return Math.abs(h); };

  /* ---------- chrome ---------- */
  const counter = el('div', { class: 'fc-nav__count' });
  const bar = el('div', { class: 'bar__fill' });
  const knownCount = el('span', { class: 'chip chip--good' });
  const learningCount = el('span', { class: 'chip chip--warn' });

  const playBtn = iconBtn('play', 'Play (P)', togglePlay);
  const shuffleBtn = iconBtn('shuffle', 'Shuffle (X)', () => {
    opts.shuffle = !opts.shuffle;
    shuffleBtn.setAttribute('aria-pressed', String(opts.shuffle));
    data.saveModeOptions('flashcards', opts);
    buildQueue();
    paint();
    toast(opts.shuffle ? 'Shuffled' : 'Back to the original order', { timeout: 1600 });
  });
  shuffleBtn.setAttribute('aria-pressed', String(opts.shuffle));
  const audioBtn = speech.supported ? iconBtn('sound', 'Read aloud (A)', () => speakCurrent(true)) : null;
  const fullBtn = iconBtn('expand', 'Fullscreen (F)', toggleFull);
  const optionsBtn = iconBtn('cog', 'Options (O)', showOptions);

  const stage = el('div', { class: 'fc-stage' });
  const cardEl = el('div', {
    class: 'fc-card', role: 'button', tabindex: '0',
    onclick: (e) => { if (!e.target.closest('[data-tool]')) flip(); },
  });
  stage.appendChild(cardEl);

  const prevBtn = el('button', { class: 'fc-round-btn', type: 'button', 'aria-label': 'Previous card', onclick: () => step(-1) }, icon('left'));
  const nextBtn = el('button', { class: 'fc-round-btn', type: 'button', 'aria-label': 'Next card', onclick: () => step(1) }, icon('right'));
  const nav = el('div', { class: 'fc-nav' }, prevBtn, counter, nextBtn);

  const sortRow = el('div', { class: 'fc-sort' },
    el('button', { class: 'btn btn--still', type: 'button', onclick: () => sortCard('learning') }, icon('undo'), 'Still learning'),
    el('button', { class: 'btn btn--know', type: 'button', onclick: () => sortCard('known') }, icon('check'), 'Know it'),
  );

  host.append(
    el('div', { class: 'study__head' },
      el('div', { class: 'study__title' },
        el('h1', {}, 'Flashcards'),
        el('p', {}, set.title)),
      el('div', { class: 'study__tools' }, shuffleBtn, playBtn, audioBtn, fullBtn, optionsBtn,
        el('a', { class: 'icon-btn', href: `#/set/${set.id}`, 'aria-label': 'Back to set' }, icon('x'))),
    ),
    el('div', { class: 'study-progress' }, el('div', { class: 'bar', style: { flex: '1' } }, bar), counterWrap()),
    stage,
    el('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } }, knownCount, learningCount),
    nav,
  );
  function counterWrap() { return el('span', { class: 'study__counter', id: 'fc-progress-label' }); }
  const progressLabel = host.querySelector('#fc-progress-label');

  /* ---------- rendering ---------- */
  function paint() {
    if (done) { paintDone(); return; }
    const term = current();
    if (!term) { paintDone(); return; }
    const s = sides(term);
    const card = progress.cards[term.id];

    cardEl.className = 'fc-card' + (flipped ? ' is-flipped' : '') +
      (card && card.fc === 'known' ? ' is-known' : card && card.fc === 'learning' ? ' is-learning' : '');
    cardEl.setAttribute('aria-label', `Card ${i + 1} of ${queue.length}. ${flipped ? s.backLabel : s.frontLabel}: ${flipped ? s.backText : s.frontText}. Press space to flip.`);
    cardEl.replaceChildren(face(s.frontLabel, s.frontText, term, false), face(s.backLabel, s.backText, term, true));

    counter.textContent = `${i + 1} / ${queue.length}`;
    progressLabel.textContent = `${Math.round(((i + 1) / queue.length) * 100)}%`;
    bar.style.width = ((i + 1) / queue.length) * 100 + '%';
    prevBtn.disabled = i === 0;

    const tally = countSorted();
    knownCount.replaceChildren(icon('check'), document.createTextNode(` ${tally.known} known`));
    learningCount.replaceChildren(icon('undo'), document.createTextNode(` ${tally.learning} still learning`));
    knownCount.hidden = learningCount.hidden = !opts.trackProgress;
    sortRow.remove();
    if (opts.trackProgress) host.insertBefore(sortRow, nav);
    nav.hidden = false;
  }

  function face(label, text, term, isBack) {
    const starBtn = el('button', {
      class: 'icon-btn icon-btn--sm star-btn', type: 'button', 'data-tool': 'star',
      'aria-pressed': String(!!term.starred), 'aria-label': 'Star this card (S)',
      onclick: (e) => { e.stopPropagation(); toggleStar(); },
    }, icon('star'));
    const speakBtn = speech.supported ? el('button', {
      class: 'icon-btn icon-btn--sm', type: 'button', 'data-tool': 'speak', 'aria-label': 'Read aloud (A)',
      onclick: (e) => { e.stopPropagation(); speech.speak(text, { lang: isBack ? sides(term).backLang : sides(term).frontLang }); },
    }, icon('sound')) : null;

    return el('div', { class: `fc-card__face${isBack ? ' fc-card__face--back' : ''}` },
      el('span', { class: 'fc-card__side' }, label),
      el('div', { class: 'fc-card__tools' }, speakBtn, starBtn),
      el('div', { class: 'fc-card__text' + (text.length > 110 ? ' is-long' : '') }, text || '(empty)'),
      !isBack && opts.showHints && term.hint ? el('div', { class: 'fc-card__hint' }, term.hint) : null,
    );
  }

  function paintDone() {
    const tally = countSorted();
    stage.replaceChildren(el('div', { class: 'round-done', style: { width: '100%' } },
      el('h2', {}, 'You have been through every card'),
      el('p', { class: 'round-done__sub' }, opts.trackProgress
        ? `${tally.known} marked as known, ${tally.learning} still learning.`
        : `${plural(queue.length, 'card')} reviewed.`),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        tally.learning && opts.trackProgress
          ? el('button', { class: 'btn btn--primary', type: 'button', onclick: () => { opts.unknownOnly = true; buildQueue(); paint(); } },
              `Study the ${tally.learning} still learning`)
          : null,
        el('button', { class: 'btn', type: 'button', onclick: () => { buildQueue(); paint(); } }, icon('undo'), 'Start over'),
        el('a', { class: 'btn', href: `#/set/${set.id}/learn` }, icon('brain'), 'Switch to Learn'),
        el('a', { class: 'btn btn--ghost', href: `#/set/${set.id}` }, 'Back to set'),
      )));
    counter.textContent = `${queue.length} / ${queue.length}`;
    bar.style.width = '100%';
    sortRow.remove();
    nav.hidden = true;
    stopPlay();
  }

  function countSorted() {
    let known = 0, learning = 0;
    for (const t of queue) {
      const c = progress.cards[t.id];
      if (!c || !c.fc) continue;
      if (c.fc === 'known') known++; else learning++;
    }
    return { known, learning };
  }

  /* ---------- actions ---------- */
  function flip() {
    flipped = !flipped;
    cardEl.classList.toggle('is-flipped', flipped);
    const term = current();
    if (!term) return;
    const s = sides(term);
    announce(flipped ? s.backText : s.frontText);
    if (opts.speak && (opts.speakSide === 'both' || (flipped ? opts.speakSide === 'back' : opts.speakSide === 'front'))) speakCurrent();
  }
  function step(delta) {
    if (done && delta < 0) { done = false; i = queue.length - 1; flipped = false; paint(); return; }
    const next = i + delta;
    if (next < 0) return;
    if (next >= queue.length) { done = true; paint(); return; }
    i = next;
    flipped = false;
    cardEl.classList.remove('is-flipped');
    paint();
  }
  async function sortCard(kind) {
    const term = current();
    if (!term) return;
    const card = progress.cards[term.id] || (progress.cards[term.id] = { ...data.DEFAULT_CARD });
    card.fc = kind;
    card.lastSeen = Date.now();
    if (card.status === 'new') card.status = 'learning';
    saveProgressSoon();
    announce(kind === 'known' ? 'Marked as known' : 'Kept in still learning');
    step(1);
  }
  async function toggleStar() {
    const term = current();
    if (!term) return;
    term.starred = !term.starred;
    paint();
    try { await data.saveSet(set); } catch { toast('Could not save the star', { type: 'bad' }); }
  }
  function speakCurrent(force) {
    const term = current();
    if (!term || (!opts.speak && !force)) return;
    const s = sides(term);
    speech.speak(flipped ? s.backText : s.frontText, { lang: flipped ? s.backLang : s.frontLang });
  }

  let saveTimer = null;
  function saveProgressSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { data.saveProgress(progress).catch(() => toast('Could not save progress', { type: 'bad' })); }, 400);
  }

  /* ---------- autoplay ---------- */
  function togglePlay() { playing ? stopPlay() : startPlay(); }
  function startPlay() {
    if (done) return;
    playing = true;
    playBtn.replaceChildren(icon('pause'));
    playBtn.setAttribute('aria-label', 'Pause (P)');
    playBtn.setAttribute('aria-pressed', 'true');
    tick();
  }
  function stopPlay() {
    playing = false;
    clearTimeout(session.timer);
    playBtn.replaceChildren(icon('play'));
    playBtn.setAttribute('aria-label', 'Play (P)');
    playBtn.setAttribute('aria-pressed', 'false');
  }
  function tick() {
    clearTimeout(session.timer);
    if (!playing || !session.alive) return;
    session.timer = setTimeout(() => {
      if (!playing) return;
      if (!flipped) flip();
      else {
        if (i >= queue.length - 1) { step(1); stopPlay(); return; }
        step(1);
      }
      tick();
    }, Math.max(1000, opts.autoplaySpeed * 1000));
  }

  /* ---------- fullscreen ---------- */
  function toggleFull() {
    full = !full;
    host.classList.toggle('is-full', full);
    fullBtn.setAttribute('aria-pressed', String(full));
    document.body.style.overflow = full ? 'hidden' : '';
    if (full && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => { /* browser said no; the CSS overlay still works */ });
    } else if (!full && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  /* ---------- options ---------- */
  function showOptions() {
    const d = { ...opts };                       // draft: Cancel really cancels
    openOptions({
      title: 'Flashcard options',
      groups: [
        optionGroup('Cards', [
          selectRow('Front of card', 'Which side you see first', d.front,
            [['term', 'Term'], ['definition', 'Definition'], ['random', 'Random each card']], v => { d.front = v; }),
          checkboxRow('Shuffle cards', 'Randomise the order each time you start', d.shuffle, v => { d.shuffle = v; }),
          checkboxRow('Track progress', 'Sort cards into "know it" and "still learning"', d.trackProgress, v => { d.trackProgress = v; }),
          checkboxRow('Show hints', 'Display a card hint under the front side', d.showHints, v => { d.showHints = v; }),
        ]),
        optionGroup('Which cards', [
          checkboxRow('Starred only', `Study just the ${set.terms.filter(t => t.starred).length} starred cards`, d.starredOnly, v => { d.starredOnly = v; }),
          checkboxRow('Skip cards you know', 'Leave out anything marked "know it"', d.unknownOnly, v => { d.unknownOnly = v; }),
        ]),
        optionGroup('Playback', [
          checkboxRow('Autoplay', 'Flip and advance on a timer', d.autoplay, v => { d.autoplay = v; }),
          rangeRow('Seconds per side', d.autoplaySpeed, 1, 15, 1, v => { d.autoplaySpeed = v; }),
          speech.supported ? checkboxRow('Read cards aloud', 'Uses your device voices', d.speak, v => { d.speak = v; }) : null,
          speech.supported ? selectRow('Read which side', '', d.speakSide,
            [['both', 'Both sides'], ['front', 'Front only'], ['back', 'Back only']], v => { d.speakSide = v; }) : null,
        ]),
      ],
      onApply: async () => {
        opts = { ...opts, ...d };
        shuffleBtn.setAttribute('aria-pressed', String(opts.shuffle));
        await data.saveModeOptions('flashcards', opts);
        buildQueue({ keepPosition: true });
        paint();
        if (opts.autoplay && !playing) startPlay();
        if (!opts.autoplay && playing) stopPlay();
      },
      onReset: async () => {
        opts = { ...data.DEFAULT_SETTINGS.flashcards };
        await data.saveModeOptions('flashcards', opts);
        buildQueue(); paint();
      },
    });
  }

  /* ---------- keyboard ---------- */
  session.keyHandler = (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.modal-backdrop')) return;
    const k = e.key.toLowerCase();
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (k === 's') { e.preventDefault(); toggleStar(); }
    else if (k === 'x') { e.preventDefault(); shuffleBtn.click(); }
    else if (k === 'p') { e.preventDefault(); togglePlay(); }
    else if (k === 'a') { e.preventDefault(); speakCurrent(true); }
    else if (k === 'f') { e.preventDefault(); toggleFull(); }
    else if (k === 'o') { e.preventDefault(); showOptions(); }
    else if (e.key === '1' && opts.trackProgress) { e.preventDefault(); sortCard('learning'); }
    else if (e.key === '2' && opts.trackProgress) { e.preventDefault(); sortCard('known'); }
    else if (e.key === 'Escape' && full) { e.preventDefault(); toggleFull(); }
  };
  document.addEventListener('keydown', session.keyHandler);

  buildQueue();
  paint();
  if (opts.autoplay) startPlay();
  requestAnimationFrame(() => cardEl.focus({ preventScroll: true }));
}

function iconBtn(name, label, onClick) {
  return el('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label, onclick: onClick }, icon(name));
}
