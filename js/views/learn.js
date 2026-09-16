/* views/learn.js — adaptive study rounds.
 *
 * Terms climb a Leitner ladder: recognition questions first (multiple choice,
 * true/false), recall once they are familiar (typed answers). A wrong answer
 * drops the term back and re-queues it inside the same round, so you always
 * finish a round having answered everything correctly at least once.
 */
import { el, icon, shuffle, isTyping, announce, plural, clamp } from '../utils.js';
import * as data from '../data.js';
import { toast, confirmDialog, segBar } from '../ui.js';
import { navigate } from '../router.js';
import { grade, distractors } from '../grading.js';
import { buildRound, questionKindFor, recordAnswer, ensureCard } from '../scheduler.js';
import * as speech from '../speech.js';
import { openOptions, optionGroup, checkboxRow, selectRow, numberRow, typeRows } from './options.js';

export function render(mount, { params }) {
  const setId = params[0];
  const session = { alive: true, keyHandler: null, timers: [] };
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
      session.timers.forEach(clearTimeout);
      speech.cancel();
      if (session.keyHandler) document.removeEventListener('keydown', session.keyHandler);
    },
  };
}

function start(host, set, progress, session) {
  let opts = { ...data.getSettings().learn };
  let round = [];          // queue of terms for this round
  let roundIndex = 0;
  let roundStats = { right: 0, wrong: 0, total: 0 };
  let q = null;            // current question
  let answered = false;
  let busy = false;

  const later = (fn, ms) => { const t = setTimeout(() => { if (session.alive) fn(); }, ms); session.timers.push(t); return t; };

  /* ---------- chrome ---------- */
  const barHost = el('div', { style: { flex: '1' } });
  const counter = el('span', { class: 'study__counter' });
  const stage = el('div', {});

  const optionsBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Options (O)', 'aria-label': 'Learn options', onclick: showOptions }, icon('cog'));
  const restartBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Restart Learn', 'aria-label': 'Restart Learn', onclick: restart }, icon('undo'));

  host.append(
    el('div', { class: 'study__head' },
      el('div', { class: 'study__title' }, el('h1', {}, 'Learn'), el('p', {}, set.title)),
      el('div', { class: 'study__tools' }, restartBtn, optionsBtn,
        el('a', { class: 'icon-btn', href: `#/set/${set.id}`, 'aria-label': 'Back to set' }, icon('x'))),
    ),
    el('div', { class: 'study-progress' }, barHost, counter),
    stage,
  );

  function paintProgress() {
    // Count only the terms Learn can actually ask about, so the bar and the
    // round counter agree with each other.
    const s = data.summarize({ terms: activeTerms() }, progress);
    barHost.replaceChildren(segBar(s));
    counter.textContent = `${s.mastered} / ${s.total} mastered`;
  }

  /* ---------- pools ----------
   * Cached, because these run on every question and a set can hold thousands
   * of terms. `invalidatePools()` is called whenever the filters change. */
  let poolCache = null;
  let answerCache = null;
  function activeTerms() {
    if (poolCache) return poolCache;
    // Both sides are needed: "what is the definition of (empty)?" is not a question.
    let pool = set.terms.filter(t => t.term.trim() && t.definition.trim());
    if (opts.starredOnly) {
      const starred = pool.filter(t => t.starred);
      if (starred.length) pool = starred;
    }
    poolCache = pool;
    return pool;
  }
  /** All candidate answer texts for one direction, used to build distractors. */
  function answerPool(dir) {
    if (!answerCache) {
      const pool = activeTerms();
      answerCache = {
        definition: pool.map(t => t.definition).filter(Boolean),
        term: pool.map(t => t.term).filter(Boolean),
      };
    }
    return answerCache[dir];
  }
  function invalidatePools() { poolCache = null; answerCache = null; }

  /* ---------- round lifecycle ---------- */
  function nextRound() {
    const pool = activeTerms();
    if (!pool.length) { paintNoTerms(); return; }
    const picked = buildRound(pool, progress, {
      roundSize: clamp(opts.roundSize, 3, 20),
      masteryTarget: opts.masteryTarget,
    });
    if (!picked.length) { paintAllDone(); return; }
    round = opts.shuffle ? shuffle(picked) : picked;
    roundIndex = 0;
    roundStats = { right: 0, wrong: 0, total: round.length };
    askNext();
  }

  function askNext() {
    if (roundIndex >= round.length) { paintRoundDone(); return; }
    q = makeQuestion(round[roundIndex]);
    answered = false;
    paintQuestion();
  }

  function restart() {
    confirmDialog({
      title: 'Restart Learn?',
      message: 'Mastery and streaks for this set go back to zero so you can start fresh.',
      confirmLabel: 'Restart', danger: true,
    }).then(async ok => {
      if (!ok) return;
      progress = await data.resetProgress(set.id);
      paintProgress();
      nextRound();
    });
  }

  /* ---------- question building ---------- */
  function direction() {
    if (opts.answerWith === 'both') return Math.random() < 0.5 ? 'definition' : 'term';
    return opts.answerWith;
  }

  function makeQuestion(term) {
    const card = ensureCard(progress, term.id);
    const kind = questionKindFor(card, opts.types);
    const dir = direction();
    const promptText = dir === 'definition' ? term.term : term.definition;
    const answerText = dir === 'definition' ? term.definition : term.term;
    const answerLang = dir === 'definition' ? set.defLang : set.termLang;
    const promptLang = dir === 'definition' ? set.termLang : set.defLang;
    const pool = answerPool(dir);          // may contain the answer itself; distractors filters it out

    const base = { term, kind, dir, promptText, answerText, answerLang, promptLang };
    if (kind === 'multiple') {
      const wrong = distractors(answerText, pool, 3);
      if (wrong.length < 1) return { ...base, kind: 'written' };     // too small a set for choices
      return { ...base, choices: shuffle([answerText, ...wrong]) };
    }
    if (kind === 'truefalse') {
      const showCorrect = Math.random() < 0.5 || !pool.length;
      const shown = showCorrect ? answerText : (distractors(answerText, pool, 1)[0] || answerText);
      return { ...base, shown, expectTrue: shown === answerText };
    }
    return base;                                                      // written / flashcard
  }

  /* ---------- rendering ---------- */
  const KIND_LABEL = { multiple: 'Choose the answer', written: 'Type the answer', truefalse: 'True or false', flashcard: 'Flashcard' };

  function paintQuestion() {
    const promptIsLong = q.promptText.length > 120;
    const kindRow = el('div', { class: 'q-kind' },
      el('span', {}, KIND_LABEL[q.kind]),
      el('span', { class: 'chip' }, q.dir === 'definition' ? 'Definition' : 'Term'),
      speech.supported ? el('button', {
        class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Read the question aloud',
        style: { marginLeft: 'auto' },
        onclick: () => speech.speak(q.promptText, { lang: q.promptLang }),
      }, icon('sound')) : null,
    );

    const card = el('div', { class: 'q-card' },
      kindRow,
      el('div', { class: 'q-prompt' + (promptIsLong ? ' is-long' : '') }, q.promptText || '(empty)'),
      opts.showHints && q.term.hint ? el('p', { class: 'q-hint' }, q.term.hint) : null,
    );

    if (q.kind === 'multiple') card.appendChild(choiceGrid());
    else if (q.kind === 'truefalse') card.appendChild(trueFalse());
    else if (q.kind === 'flashcard') card.appendChild(flashcardSelf());
    else card.appendChild(writtenForm());

    card.appendChild(el('div', { class: 'q-foot' },
      el('div', { class: 'q-foot__hint' }, hintForKind()),
      q.kind === 'flashcard' ? null : el('button', {
        class: 'btn btn--ghost', type: 'button', onclick: () => submit(null, { dontKnow: true }),
      }, "Don't know"),
    ));

    stage.replaceChildren(
      el('div', { class: 'q-meta' },
        el('span', { class: 'q-meta__n' }, `Question ${Math.min(roundIndex + 1, round.length)} of ${round.length}`),
        el('span', { class: 'chip' }, `${roundStats.right} of ${roundStats.total} this round`)),
      card,
    );
    if (opts.speak) speech.speak(q.promptText, { lang: q.promptLang });

    const focusTarget = card.querySelector('.ans-input') || card.querySelector('.opt');
    if (focusTarget) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }

  function hintForKind() {
    if (q.kind === 'multiple') return 'Press 1 to 4 to answer';
    if (q.kind === 'truefalse') return 'Press 1 for true, 2 for false';
    if (q.kind === 'written') return 'Enter to submit, Shift+Enter if you are stuck';
    return 'Space to flip';
  }

  function choiceGrid() {
    const grid = el('div', { class: 'opt-grid' });
    q.choices.forEach((choice, n) => {
      grid.appendChild(el('button', {
        class: 'opt', type: 'button', 'data-choice': String(n),
        'aria-label': `Option ${n + 1}: ${choice || 'empty'}`,
        onclick: () => submit(choice),
      }, el('span', { class: 'opt__key' }, String(n + 1)), el('span', {}, choice || '(empty)')));
    });
    return grid;
  }

  function trueFalse() {
    return el('div', {},
      el('div', { class: 'q-card', style: { background: 'var(--c-surface-2)', marginBottom: '16px', padding: '16px', boxShadow: 'none' } },
        el('div', { class: 'field__label' }, 'Proposed answer'),
        el('div', { style: { fontFamily: 'var(--font-read)', fontSize: '1.05rem' } }, q.shown || '(empty)')),
      el('div', { class: 'tf-grid' },
        el('button', { class: 'opt', type: 'button', 'data-tf': 'true', onclick: () => submit(true) }, el('span', { class: 'opt__key' }, '1'), 'True'),
        el('button', { class: 'opt', type: 'button', 'data-tf': 'false', onclick: () => submit(false) }, el('span', { class: 'opt__key' }, '2'), 'False'),
      ));
  }

  function flashcardSelf() {
    const answer = el('div', { class: 'q-prompt', style: { display: 'none', marginTop: '14px' } }, q.answerText || '(empty)');
    const reveal = el('button', { class: 'btn btn--primary', type: 'button', onclick: show }, 'Show answer');
    const judge = el('div', { class: 'row', style: { display: 'none', gap: '10px' } },
      el('button', { class: 'btn btn--danger', type: 'button', onclick: () => submit(false, { selfGraded: true }) }, 'Missed it'),
      el('button', { class: 'btn btn--primary', type: 'button', onclick: () => submit(true, { selfGraded: true }) }, 'Got it'),
    );
    function show() { answer.style.display = ''; reveal.style.display = 'none'; judge.style.display = 'flex'; }
    const wrap = el('div', {}, answer, reveal, judge);
    wrap.dataset.reveal = '1';
    wrap._show = show;
    return wrap;
  }

  function writtenForm() {
    const input = el('input', {
      class: 'ans-input', type: 'text', autocomplete: 'off', autocapitalize: 'off',
      autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Your answer',
      placeholder: q.dir === 'definition' ? 'Type the definition' : 'Type the term',
    });
    const form = el('form', {
      class: 'ans-form',
      onsubmit: (e) => { e.preventDefault(); submit(input.value); },
    }, input, el('button', { class: 'btn btn--primary btn--lg', type: 'submit' }, 'Answer'));
    return form;
  }

  /* ---------- answering ---------- */
  function submit(value, { dontKnow = false, selfGraded = false } = {}) {
    if (answered || busy) return;
    answered = true;

    let correct = false, close = false, given = '';
    if (dontKnow) {
      correct = false;
      given = '';
    } else if (q.kind === 'multiple') {
      given = String(value ?? '');
      correct = given === q.answerText;
    } else if (q.kind === 'truefalse') {
      correct = value === q.expectTrue;
      given = value ? 'True' : 'False';
    } else if (selfGraded) {
      correct = value === true;
      given = '';
    } else {
      given = String(value ?? '');
      const g = grade(given, q.answerText, {
        requireExact: opts.requireExact,
        smart: opts.smartGrading,
      });
      correct = g.correct;
      close = !g.correct && g.close;
      if (close && opts.acceptTypos) correct = true;
    }

    const card = recordAnswer(progress, q.term.id, correct, { masteryTarget: opts.masteryTarget, penalty: opts.penalty });
    if (correct) roundStats.right++; else roundStats.wrong++;
    saveProgressSoon();
    paintProgress();

    if (!correct) {
      // Re-queue so the round is not finished until this term is answered right.
      const already = round.slice(roundIndex + 1).some(t => t.id === q.term.id);
      if (!already) round.push(q.term);
      roundStats.total = round.length;
    }

    showVerdict({ correct, close, given, dontKnow, selfGraded, card });
  }

  function showVerdict({ correct, close, given, dontKnow, selfGraded }) {
    const card = stage.querySelector('.q-card');
    if (!card) return;

    // Lock the interactive parts and mark them up.
    card.querySelectorAll('.opt').forEach(btn => {
      btn.disabled = true;
      if (q.kind === 'multiple') {
        const text = btn.lastChild.textContent;
        if (text === q.answerText) btn.classList.add('is-correct');
        else if (text === given) btn.classList.add('is-wrong', 'is-picked');
        else btn.classList.add('is-muted');
      } else if (q.kind === 'truefalse') {
        const isTrueBtn = btn.dataset.tf === 'true';
        if (isTrueBtn === q.expectTrue) btn.classList.add('is-correct');
        else if ((isTrueBtn ? 'True' : 'False') === given) btn.classList.add('is-wrong', 'is-picked');
        else btn.classList.add('is-muted');
      }
    });
    const input = card.querySelector('.ans-input');
    if (input) {
      input.readOnly = true;
      input.classList.add(correct ? 'is-correct' : close ? 'is-close' : 'is-wrong');
    }
    const submitBtn = card.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    card.querySelectorAll('.q-foot .btn').forEach(b => b.remove());

    const canOverride = !correct && !selfGraded && q.kind === 'written' && !dontKnow && given.trim();
    const kindClass = correct ? (close ? 'close' : 'good') : 'bad';
    const heading = correct
      ? (close ? 'Correct, but check the spelling' : 'Correct')
      : dontKnow ? 'No problem, here it is' : 'Not quite';

    const verdict = el('div', { class: `verdict verdict--${kindClass}`, role: 'status' },
      el('span', { class: 'verdict__icon' }, icon(correct ? 'check' : 'x')),
      el('div', { class: 'verdict__body' },
        el('div', { class: 'verdict__h' }, heading),
        !correct && given ? el('div', {}, el('span', { class: 'strike' }, given)) : null,
        el('div', { class: 'verdict__ans' }, el('strong', {}, 'Answer: '), q.answerText || '(empty)'),
        el('div', { class: 'verdict__actions' },
          canOverride ? el('button', { class: 'btn btn--sm', type: 'button', onclick: override }, 'I was right (O)') : null,
          speech.supported ? el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: () => speech.speak(q.answerText, { lang: q.answerLang }) }, icon('sound'), 'Hear it') : null,
          el('button', { class: 'btn btn--sm', type: 'button', onclick: star }, icon('star'), q.term.starred ? 'Starred' : 'Star this'),
        ),
      ),
    );
    card.appendChild(verdict);

    const nextBtn = el('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: advance }, 'Continue');
    card.appendChild(el('div', { class: 'q-foot' },
      el('div', { class: 'q-foot__hint' }, 'Press Enter to continue'),
      nextBtn));

    announce(`${heading}. Answer: ${q.answerText}`);

    if (correct && !close && opts.instantNext) later(advance, 750);
    else requestAnimationFrame(() => nextBtn.focus({ preventScroll: true }));

    async function star() {
      q.term.starred = !q.term.starred;
      if (opts.starredOnly) invalidatePools();
      try { await data.saveSet(set); } catch { toast('Could not save the star', { type: 'bad' }); }
      const b = verdict.querySelector('.verdict__actions .btn:last-child');
      if (b) b.lastChild.textContent = q.term.starred ? 'Starred' : 'Star this';
    }
    function override() {
      // Undo the wrong answer and credit it instead.
      const c = progress.cards[q.term.id];
      if (c) { c.wrong = Math.max(0, c.wrong - 1); c.seen = Math.max(0, c.seen - 1); }
      recordAnswer(progress, q.term.id, true, { masteryTarget: opts.masteryTarget, penalty: opts.penalty });
      roundStats.wrong = Math.max(0, roundStats.wrong - 1);
      roundStats.right++;
      const at = round.lastIndexOf(q.term);
      if (at > roundIndex) { round.splice(at, 1); roundStats.total = round.length; }
      saveProgressSoon();
      paintProgress();
      toast('Marked correct', { type: 'good', timeout: 1600 });
      advance();
    }
  }

  function advance() {
    if (busy) return;
    busy = true;
    session.timers.forEach(clearTimeout);
    session.timers.length = 0;
    roundIndex++;
    busy = false;
    askNext();
  }

  /* ---------- end screens ---------- */
  function paintRoundDone() {
    const s = data.summarize(set, progress);
    const pct = roundStats.total ? Math.round((roundStats.right / (roundStats.right + roundStats.wrong || 1)) * 100) : 100;
    const circumference = 2 * Math.PI * 54;
    const remaining = activeTerms().filter(t => {
      const c = progress.cards[t.id];
      return !c || c.status !== 'mastered';
    }).length;

    stage.replaceChildren(el('div', { class: 'q-card round-done' },
      el('div', { class: 'round-done__ring' },
        el('div', { class: 'round-done__pct' }, `${pct}%`),
        svgRing(circumference, pct)),
      el('h2', {}, 'Round complete'),
      el('p', { class: 'round-done__sub' },
        `${roundStats.right} correct, ${roundStats.wrong} to review. ${s.mastered} of ${s.total} terms mastered.`),
      el('div', { class: 'stats', style: { maxWidth: '440px', margin: '0 auto 22px' } },
        stat(s.mastered, 'Mastered', 'var(--c-good)'),
        stat(s.learning, 'Still learning', 'var(--c-warn)'),
        stat(s.notStarted, 'Not started', 'var(--c-text-dim)')),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        remaining
          ? el('button', { class: 'btn btn--primary btn--lg', type: 'button', 'data-autofocus': '', onclick: nextRound }, 'Next round')
          : el('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: paintAllDone }, 'See results'),
        el('a', { class: 'btn', href: `#/set/${set.id}` }, 'Take a break'),
      )));
    const btn = stage.querySelector('.btn--primary');
    if (btn) requestAnimationFrame(() => btn.focus({ preventScroll: true }));
  }

  function paintAllDone() {
    const s = data.summarize(set, progress);
    stage.replaceChildren(el('div', { class: 'q-card round-done' },
      el('div', { style: { fontSize: '3rem', lineHeight: '1' } }, '🎉'),
      el('h2', { style: { marginTop: '12px' } }, 'Every term mastered'),
      el('p', { class: 'round-done__sub' }, `You answered all ${plural(s.total, 'term')} correctly ${opts.masteryTarget} times in a row.`),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        el('a', { class: 'btn btn--primary btn--lg', href: `#/set/${set.id}/test` }, icon('quiz'), 'Take a test'),
        el('button', { class: 'btn', type: 'button', onclick: restart }, icon('undo'), 'Study again'),
        el('a', { class: 'btn btn--ghost', href: `#/set/${set.id}` }, 'Back to set'),
      )));
  }

  function paintNoTerms() {
    const incomplete = set.terms.some(t => !t.term.trim() || !t.definition.trim());
    stage.replaceChildren(el('div', { class: 'empty' },
      el('h2', {}, 'Nothing to study yet'),
      el('p', {}, opts.starredOnly
        ? 'No cards are starred, so there is nothing in this filter. Star a few cards, or turn the filter off.'
        : incomplete
          ? 'Learn needs cards with both a term and a definition. Fill in the missing sides and come back.'
          : 'This set has no cards yet.'),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        el('a', { class: 'btn btn--primary', href: `#/set/${set.id}/edit` }, icon('pencil'), 'Edit this set'),
        opts.starredOnly ? el('button', { class: 'btn', type: 'button', onclick: showOptions }, 'Open options') : null)));
  }

  function stat(n, label, color) {
    return el('div', { class: 'stat' }, el('div', { class: 'stat__n', style: { color } }, String(n)), el('div', { class: 'stat__l' }, label));
  }
  function svgRing(circumference, pct) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 128 128');
    svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS(ns, 'circle');
    track.setAttribute('cx', '64'); track.setAttribute('cy', '64'); track.setAttribute('r', '54');
    track.setAttribute('stroke', 'var(--c-border)');
    const fill = document.createElementNS(ns, 'circle');
    fill.setAttribute('cx', '64'); fill.setAttribute('cy', '64'); fill.setAttribute('r', '54');
    fill.setAttribute('stroke', pct >= 80 ? 'var(--c-good)' : pct >= 50 ? 'var(--c-warn)' : 'var(--c-bad)');
    fill.setAttribute('stroke-dasharray', String(circumference));
    fill.setAttribute('stroke-dashoffset', String(circumference * (1 - pct / 100)));
    svg.append(track, fill);
    return svg;
  }

  /* ---------- persistence ---------- */
  let saveTimer = null;
  function saveProgressSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      data.saveProgress(progress).catch(err => toast(`Could not save progress: ${err.message}`, { type: 'bad' }));
    }, 500);
  }

  /* ---------- options ---------- */
  function showOptions() {
    const d = JSON.parse(JSON.stringify(opts));
    openOptions({
      title: 'Learn options',
      groups: [
        optionGroup('Questions', [
          selectRow('Answer with', 'What you have to produce', d.answerWith,
            [['definition', 'The definition'], ['term', 'The term'], ['both', 'Mix of both']], v => { d.answerWith = v; }),
          ...typeRows(d.types, [
            ['multiple', 'Multiple choice', 'Pick from four options'],
            ['written', 'Written', 'Type the answer from memory'],
            ['truefalse', 'True or false', 'Judge a proposed answer'],
            ['flashcard', 'Flashcard', 'Self-graded, no typing'],
          ], v => { d.types = v; }),
        ]),
        optionGroup('Rounds and mastery', [
          numberRow('Terms per round', 'How many new terms each round introduces', d.roundSize, 3, 20, v => { d.roundSize = v; }),
          numberRow('Correct answers to master', 'In a row, before a term counts as learned', d.masteryTarget, 1, 5, v => { d.masteryTarget = v; }),
          selectRow('When you get one wrong', '', d.penalty,
            [['reset', 'Start that term over'], ['step', 'Drop back one step']], v => { d.penalty = v; }),
          checkboxRow('Shuffle each round', '', d.shuffle, v => { d.shuffle = v; }),
          checkboxRow('Starred terms only', '', d.starredOnly, v => { d.starredOnly = v; }),
        ]),
        optionGroup('Grading and pacing', [
          checkboxRow('Smart grading', 'Ignore capitals, punctuation, accents and articles', d.smartGrading, v => { d.smartGrading = v; }),
          checkboxRow('Accept typos', 'Count near-misses as correct, with a spelling note', d.acceptTypos, v => { d.acceptTypos = v; }),
          checkboxRow('Require exact match', 'Strictest grading, overrides the two above', d.requireExact, v => { d.requireExact = v; }),
          checkboxRow('Auto-advance when correct', 'Move on without pressing Continue', d.instantNext, v => { d.instantNext = v; }),
          checkboxRow('Show hints', '', d.showHints, v => { d.showHints = v; }),
          speech.supported ? checkboxRow('Read questions aloud', '', d.speak, v => { d.speak = v; }) : null,
        ]),
      ],
      onApply: async () => {
        const restartRound = d.answerWith !== opts.answerWith || d.roundSize !== opts.roundSize ||
          JSON.stringify(d.types) !== JSON.stringify(opts.types) || d.starredOnly !== opts.starredOnly;
        opts = d;
        invalidatePools();
        await data.saveModeOptions('learn', opts);
        if (restartRound) nextRound(); else paintProgress();
      },
      onReset: async () => {
        opts = JSON.parse(JSON.stringify(data.DEFAULT_SETTINGS.learn));
        invalidatePools();
        await data.saveModeOptions('learn', opts);
        nextRound();
      },
    });
  }

  /* ---------- keyboard ---------- */
  session.keyHandler = (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = isTyping(e);

    if (e.key === 'Enter') {
      if (answered) {
        e.preventDefault();
        const next = stage.querySelector('.q-foot .btn--primary') || stage.querySelector('.round-done .btn--primary');
        if (next) next.click();
        return;
      }
      if (e.shiftKey && !typing) { e.preventDefault(); if (q && q.kind !== 'flashcard') submit(null, { dontKnow: true }); }
      return;
    }
    if (typing) return;

    if (!answered && q) {
      if (q.kind === 'multiple' && /^[1-4]$/.test(e.key)) {
        const btn = stage.querySelector(`[data-choice="${Number(e.key) - 1}"]`);
        if (btn) { e.preventDefault(); btn.click(); }
        return;
      }
      if (q.kind === 'truefalse' && (e.key === '1' || e.key === '2')) {
        e.preventDefault();
        submit(e.key === '1');
        return;
      }
      if (q.kind === 'flashcard' && e.key === ' ') {
        e.preventDefault();
        const wrap = stage.querySelector('[data-reveal]');
        if (wrap && wrap._show) wrap._show();
        return;
      }
      if (e.key === ' ' && q.kind !== 'written') { e.preventDefault(); }
    }
    const k = e.key.toLowerCase();
    if (k === 'o') {
      const ov = stage.querySelector('.verdict__actions .btn');
      if (answered && ov && /I was right/.test(ov.textContent)) { e.preventDefault(); ov.click(); }
      else if (!answered) { e.preventDefault(); showOptions(); }
    }
  };
  document.addEventListener('keydown', session.keyHandler);

  paintProgress();
  nextRound();
}
