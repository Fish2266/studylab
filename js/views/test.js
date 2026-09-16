/* views/test.js — a full practice exam: set it up, sit it, get it graded.
 *
 * Questions are generated once from a seeded shuffle, so "retake this test"
 * reproduces the same paper while "new test" draws fresh questions.
 */
import { el, icon, shuffle, mulberry32, isTyping, plural, mmss, announce, clamp } from '../utils.js';
import * as data from '../data.js';
import { toast, confirmDialog } from '../ui.js';
import { navigate } from '../router.js';
import { grade, distractors } from '../grading.js';
import { recordAnswer } from '../scheduler.js';
import { optionGroup, checkboxRow, selectRow, numberRow, typeRows } from './options.js';

const LETTERS = 'ABCDEFGHIJ';
const MATCH_GROUP = 5;

export function render(mount, { params }) {
  const setId = params[0];
  const session = { alive: true, keyHandler: null, timer: null };
  const host = el('div', { class: 'study' });
  mount.className = 'main main--focus';
  mount.appendChild(host);

  (async () => {
    const set = await data.getSet(setId);
    if (!session.alive) return;
    if (!set || !set.terms.length) { navigate(`/set/${setId}`, { replace: true }); return; }
    const progress = await data.getProgress(setId);
    if (!session.alive) return;
    controller(host, set, progress, session);
  })();

  return {
    destroy() {
      session.alive = false;
      clearInterval(session.timer);
      if (session.keyHandler) document.removeEventListener('keydown', session.keyHandler);
    },
  };
}

function controller(host, set, progress, session) {
  let opts = { ...data.getSettings().test };
  let paper = null;          // { questions, seed }
  let answers = new Map();
  let graded = false;
  let deadline = 0;

  const head = el('div', { class: 'study__head' },
    el('div', { class: 'study__title' }, el('h1', {}, 'Test'), el('p', {}, set.title)),
    el('div', { class: 'study__tools' },
      el('a', { class: 'icon-btn', href: `#/set/${set.id}`, 'aria-label': 'Back to set' }, icon('x'))),
  );
  const stage = el('div', {});
  host.append(head, stage);

  /* ---------------- setup screen ---------------- */
  function paintSetup() {
    graded = false;
    answers = new Map();
    clearInterval(session.timer);

    const d = JSON.parse(JSON.stringify(opts));
    const eligible = () => {
      let pool = set.terms.filter(t => t.term.trim() && t.definition.trim());
      if (d.starredOnly) pool = pool.filter(t => t.starred);
      if (d.unmasteredOnly) pool = pool.filter(t => { const c = progress.cards[t.id]; return !c || c.status !== 'mastered'; });
      return pool;
    };
    const available = el('p', { class: 'field__hint' });
    const refresh = () => {
      const n = eligible().length;
      available.textContent = n
        ? `${plural(n, 'term')} available. The test will use ${Math.min(n, d.questionCount)}.`
        : 'No terms match those filters — clear a filter to continue.';
      startBtn.disabled = n === 0;
    };

    const startBtn = el('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: () => {
      opts = d;
      data.saveModeOptions('test', opts);
      buildPaper();
      paintPaper();
    } }, icon('quiz'), 'Start test');

    stage.replaceChildren(el('div', { class: 'card card__pad' },
      el('h2', { style: { marginBottom: '4px' } }, 'Set up your test'),
      el('p', { class: 'panel__sub' }, 'Everything here is remembered for next time.'),
      optionGroup('Questions', [
        numberRow('Number of questions', 'Up to the number of terms available', d.questionCount, 1, 100, v => { d.questionCount = v; refresh(); }),
        selectRow('Answer with', '', d.answerWith,
          [['definition', 'The definition'], ['term', 'The term'], ['both', 'Mix of both']], v => { d.answerWith = v; }),
        ...typeRows(d.types, [
          ['written', 'Written', 'Type the answer'],
          ['multiple', 'Multiple choice', 'Four options'],
          ['truefalse', 'True or false', 'Judge a proposed answer'],
          ['matching', 'Matching', 'Pair five terms with five definitions'],
        ], v => { d.types = v; }),
      ]),
      optionGroup('Which terms', [
        checkboxRow('Starred only', '', d.starredOnly, v => { d.starredOnly = v; refresh(); }),
        checkboxRow('Skip mastered terms', '', d.unmasteredOnly, v => { d.unmasteredOnly = v; refresh(); }),
        checkboxRow('Shuffle questions', '', d.shuffle, v => { d.shuffle = v; }),
      ]),
      optionGroup('Marking', [
        checkboxRow('Instant feedback', 'Mark each answer as you go instead of at the end', d.instantFeedback, v => { d.instantFeedback = v; }),
        checkboxRow('Smart grading', 'Ignore capitals, punctuation, accents and articles', d.smartGrading, v => { d.smartGrading = v; }),
        numberRow('Time limit (minutes)', '0 for no limit', d.timeLimit, 0, 180, v => { d.timeLimit = v; }),
      ]),
      available,
      el('div', { class: 'row', style: { marginTop: '16px' } }, startBtn,
        el('a', { class: 'btn', href: `#/set/${set.id}` }, 'Cancel')),
    ));
    refresh();
  }

  /* ---------------- paper generation ---------------- */
  function buildPaper(seed = Math.floor(Math.random() * 2 ** 31)) {
    const rng = mulberry32(seed);
    let pool = set.terms.filter(t => t.term.trim() && t.definition.trim());
    if (opts.starredOnly) pool = pool.filter(t => t.starred);
    if (opts.unmasteredOnly) pool = pool.filter(t => { const c = progress.cards[t.id]; return !c || c.status !== 'mastered'; });
    if (!pool.length) pool = set.terms.filter(t => t.term.trim() && t.definition.trim());

    const count = clamp(opts.questionCount, 1, pool.length);
    const chosen = opts.shuffle ? shuffle(pool, rng).slice(0, count) : pool.slice(0, count);

    const kinds = Object.entries(opts.types).filter(([, on]) => on).map(([k]) => k);
    const canMatch = kinds.includes('matching') && pool.length >= MATCH_GROUP && chosen.length >= MATCH_GROUP;
    const questions = [];
    let i = 0;

    // Built once instead of per question: on a 2,000-term set rebuilding these
    // inside the loop was the difference between instant and a visible stall.
    const allDefs = pool.map(t => t.definition).filter(Boolean);
    const allTerms = pool.map(t => t.term).filter(Boolean);

    while (i < chosen.length) {
      let kind = kinds.length ? kinds[Math.floor(rng() * kinds.length)] : 'written';
      if (kind === 'matching' && (!canMatch || chosen.length - i < MATCH_GROUP)) {
        const others = kinds.filter(k => k !== 'matching');
        kind = others.length ? others[Math.floor(rng() * others.length)] : 'written';
      }
      if (kind === 'matching') {
        const group = chosen.slice(i, i + MATCH_GROUP);
        i += MATCH_GROUP;
        const dir = pickDir(rng);
        questions.push({
          id: `q${questions.length}`, kind: 'matching', dir, terms: group,
          prompts: shuffle(group, rng),
          options: shuffle(group, rng),
        });
        continue;
      }
      const term = chosen[i++];
      const dir = pickDir(rng);
      const promptText = dir === 'definition' ? term.term : term.definition;
      const answerText = dir === 'definition' ? term.definition : term.term;
      const others = dir === 'definition' ? allDefs : allTerms;   // may include the answer; distractors filters it out
      const base = { id: `q${questions.length}`, term, dir, promptText, answerText };

      if (kind === 'multiple') {
        const wrong = distractors(answerText, others, 3, rng);
        if (!wrong.length) { questions.push({ ...base, kind: 'written' }); continue; }
        questions.push({ ...base, kind: 'multiple', choices: shuffle([answerText, ...wrong], rng) });
      } else if (kind === 'truefalse') {
        const showCorrect = rng() < 0.5 || !others.length;
        const shown = showCorrect ? answerText : (distractors(answerText, others, 1, rng)[0] || answerText);
        questions.push({ ...base, kind: 'truefalse', shown, expectTrue: shown === answerText });
      } else {
        questions.push({ ...base, kind: 'written' });
      }
    }
    paper = { questions, seed };
    answers = new Map();
    graded = false;
    function pickDir(r) { return opts.answerWith === 'both' ? (r() < 0.5 ? 'definition' : 'term') : opts.answerWith; }
  }

  /* ---------------- sitting the test ---------------- */
  function paintPaper() {
    const progressBar = el('div', { class: 'bar__fill' });
    const answeredLabel = el('span', { class: 'study__counter' });
    const timerEl = el('span', { class: 'timer' });
    timerEl.hidden = !opts.timeLimit;

    const updateCounters = () => {
      const total = countAnswerable();
      const done = countAnswered();
      progressBar.style.width = (total ? (done / total) * 100 : 0) + '%';
      answeredLabel.textContent = `${done} / ${total} answered`;
    };

    const list = el('div', {});
    paper.questions.forEach((q, n) => list.appendChild(questionCard(q, n, updateCounters)));

    const submitBtn = el('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: () => trySubmit() }, 'Submit test');

    stage.replaceChildren(
      el('div', { class: 'study-progress', style: { marginBottom: '14px' } },
        el('div', { class: 'bar', style: { flex: '1' } }, progressBar), answeredLabel, timerEl),
      list,
      el('div', { class: 'sticky-bar' },
        el('button', { class: 'btn', type: 'button', onclick: quit }, 'Leave test'),
        el('div', { style: { flex: '1' } }),
        submitBtn),
    );
    updateCounters();

    if (opts.timeLimit > 0) {
      deadline = Date.now() + opts.timeLimit * 60000;
      clearInterval(session.timer);
      session.timer = setInterval(() => {
        if (!session.alive || graded) { clearInterval(session.timer); return; }
        const left = deadline - Date.now();
        timerEl.textContent = mmss(left);
        timerEl.classList.toggle('is-low', left < 60000);
        if (left <= 0) {
          clearInterval(session.timer);
          toast('Time is up — your test was submitted', { type: 'bad', timeout: 6000 });
          submitTest();
        }
      }, 500);
      timerEl.textContent = mmss(opts.timeLimit * 60000);
    }

    async function quit() {
      const ok = await confirmDialog({ title: 'Leave this test?', message: 'Your answers will be discarded.', confirmLabel: 'Leave', danger: true });
      if (ok) navigate(`/set/${set.id}`);
    }
    async function trySubmit() {
      const missing = countAnswerable() - countAnswered();
      if (missing > 0) {
        const ok = await confirmDialog({
          title: `Submit with ${plural(missing, 'blank answer')}?`,
          message: 'Blank answers are marked incorrect.',
          confirmLabel: 'Submit anyway',
        });
        if (!ok) return;
      }
      submitTest();
    }
  }

  function countAnswerable() {
    return paper.questions.reduce((n, q) => n + (q.kind === 'matching' ? q.terms.length : 1), 0);
  }
  function countAnswered() {
    let n = 0;
    for (const q of paper.questions) {
      const a = answers.get(q.id);
      if (q.kind === 'matching') n += a ? Object.values(a).filter(v => v !== '' && v !== undefined).length : 0;
      else if (a !== undefined && a !== null && String(a).trim() !== '') n++;
    }
    return n;
  }

  function questionCard(q, n, onChange) {
    const card = el('div', { class: 'test-q', id: `tq-${q.id}` });
    const label = q.kind === 'matching'
      ? `Questions ${n + 1} — match ${q.terms.length} pairs`
      : `Question ${n + 1}`;
    card.appendChild(el('div', { class: 'test-q__n' },
      el('span', {}, label),
      el('span', { class: 'chip' }, kindLabel(q.kind))));

    if (q.kind === 'matching') {
      card.appendChild(matchingBlock(q, onChange));
      return card;
    }

    card.appendChild(el('div', { class: 'q-prompt' + (q.promptText.length > 120 ? ' is-long' : '') }, q.promptText));

    if (q.kind === 'multiple') {
      const grid = el('div', { class: 'opt-grid' });
      q.choices.forEach((choice, ci) => {
        const btn = el('button', {
          class: 'opt', type: 'button', 'data-val': choice,
          'aria-pressed': 'false', 'aria-label': `Option ${LETTERS[ci]}: ${choice || 'empty'}`,
          onclick: () => {
            if (graded) return;
            answers.set(q.id, choice);
            grid.querySelectorAll('.opt').forEach(b => { b.classList.remove('is-picked'); b.setAttribute('aria-pressed', 'false'); });
            btn.classList.add('is-picked');
            btn.setAttribute('aria-pressed', 'true');
            onChange();
            if (opts.instantFeedback) markOne(q, card);
          },
        }, el('span', { class: 'opt__key' }, LETTERS[ci]), el('span', {}, choice));
        grid.appendChild(btn);
      });
      card.appendChild(grid);
    } else if (q.kind === 'truefalse') {
      card.appendChild(el('div', { class: 'card card__pad', style: { background: 'var(--c-surface-2)', margin: '0 0 14px', boxShadow: 'none' } },
        el('div', { class: 'field__label' }, 'Proposed answer'),
        el('div', { style: { fontFamily: 'var(--font-read)' } }, q.shown)));
      const grid = el('div', { class: 'tf-grid' });
      [['true', 'True'], ['false', 'False']].forEach(([val, text]) => {
        const btn = el('button', {
          class: 'opt', type: 'button', 'data-val': val, 'aria-pressed': 'false',
          onclick: () => {
            if (graded) return;
            answers.set(q.id, val === 'true');
            grid.querySelectorAll('.opt').forEach(b => { b.classList.remove('is-picked'); b.setAttribute('aria-pressed', 'false'); });
            btn.classList.add('is-picked');
            btn.setAttribute('aria-pressed', 'true');
            onChange();
            if (opts.instantFeedback) markOne(q, card);
          },
        }, text);
        grid.appendChild(btn);
      });
      card.appendChild(grid);
    } else {
      const input = el('input', {
        class: 'ans-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
        'aria-label': `Answer for question ${n + 1}`,
        placeholder: q.dir === 'definition' ? 'Type the definition' : 'Type the term',
        oninput: (e) => { answers.set(q.id, e.target.value); onChange(); },
        onblur: () => { if (opts.instantFeedback && String(answers.get(q.id) || '').trim()) markOne(q, card); },
      });
      card.appendChild(el('div', { class: 'ans-form' }, input));
    }
    return card;
  }

  function matchingBlock(q, onChange) {
    const wrap = el('div', { class: 'match-q' });
    const left = el('div', { class: 'match-q__col' });
    const right = el('div', { class: 'match-q__col' });
    const state = {};
    answers.set(q.id, state);

    q.options.forEach((t, oi) => {
      const text = q.dir === 'definition' ? t.definition : t.term;
      right.appendChild(el('div', { class: 'match-q__item' },
        el('span', { class: 'opt__key' }, LETTERS[oi]), el('span', {}, text)));
    });

    q.prompts.forEach((t) => {
      const promptText = q.dir === 'definition' ? t.term : t.definition;
      const sel = el('select', {
        class: 'select', 'aria-label': `Match for ${promptText}`,
        onchange: (e) => {
          if (graded) return;
          state[t.id] = e.target.value;
          onChange();
        },
      }, el('option', { value: '' }, '–'), ...q.options.map((_, oi) => el('option', { value: LETTERS[oi] }, LETTERS[oi])));
      left.appendChild(el('div', { class: 'match-q__item', 'data-term': t.id }, sel, el('span', {}, promptText)));
    });

    wrap.append(left, right);
    return wrap;
  }

  function kindLabel(kind) {
    return { written: 'Written', multiple: 'Multiple choice', truefalse: 'True or false', matching: 'Matching' }[kind] || kind;
  }

  /* ---------------- grading ---------------- */
  function gradeQuestion(q) {
    const given = answers.get(q.id);
    if (q.kind === 'matching') {
      const results = q.terms.map(t => {
        const pickedLetter = given && given[t.id];
        const idx = pickedLetter ? LETTERS.indexOf(pickedLetter) : -1;
        const picked = idx >= 0 ? q.options[idx] : null;
        return { term: t, correct: !!picked && picked.id === t.id, picked };
      });
      return { kind: 'matching', results, correctCount: results.filter(r => r.correct).length, total: results.length };
    }
    if (q.kind === 'multiple') {
      return { correct: given === q.answerText, given: given ?? '', total: 1, correctCount: given === q.answerText ? 1 : 0 };
    }
    if (q.kind === 'truefalse') {
      const correct = given === q.expectTrue;
      return { correct, given: given === undefined ? '' : (given ? 'True' : 'False'), total: 1, correctCount: correct ? 1 : 0 };
    }
    const g = grade(given ?? '', q.answerText, { requireExact: !opts.smartGrading, smart: opts.smartGrading });
    return { correct: g.correct, close: g.close, given: given ?? '', total: 1, correctCount: g.correct ? 1 : 0 };
  }

  function markOne(q, card) {
    const r = gradeQuestion(q);
    card.classList.remove('is-correct', 'is-wrong', 'is-unanswered');
    card.classList.add(r.correctCount === r.total ? 'is-correct' : 'is-wrong');
    card.querySelectorAll('.opt').forEach(btn => {
      const val = btn.dataset.val;
      const isRight = q.kind === 'truefalse' ? ((val === 'true') === q.expectTrue) : val === q.answerText;
      btn.classList.toggle('is-correct', isRight);
      btn.classList.toggle('is-wrong', !isRight && btn.classList.contains('is-picked'));
      btn.disabled = true;
    });
    const input = card.querySelector('.ans-input');
    if (input) {
      input.readOnly = true;
      input.classList.add(r.correct ? 'is-correct' : 'is-wrong');
    }
    if (!card.querySelector('.verdict')) {
      card.appendChild(el('div', { class: `verdict verdict--${r.correct ? 'good' : 'bad'}` },
        el('span', { class: 'verdict__icon' }, icon(r.correct ? 'check' : 'x')),
        el('div', { class: 'verdict__body' },
          el('div', { class: 'verdict__h' }, r.correct ? 'Correct' : 'Incorrect'),
          r.correct ? null : el('div', { class: 'verdict__ans' }, el('strong', {}, 'Answer: '), q.answerText))));
    }
  }

  async function submitTest() {
    if (graded) return;
    graded = true;
    clearInterval(session.timer);

    let right = 0, total = 0;
    const perQuestion = paper.questions.map(q => {
      const r = gradeQuestion(q);
      right += r.correctCount;
      total += r.total;
      return { q, r };
    });

    // Feed the result back into the set's overall progress.
    for (const { q, r } of perQuestion) {
      if (q.kind === 'matching') r.results.forEach(x => recordAnswer(progress, x.term.id, x.correct, { masteryTarget: data.getSettings().learn.masteryTarget }));
      else recordAnswer(progress, q.term.id, !!r.correct, { masteryTarget: data.getSettings().learn.masteryTarget });
    }
    data.saveProgress(progress).catch(err => toast(`Could not save progress: ${err.message}`, { type: 'bad' }));

    paintResults(perQuestion, right, total);
  }

  function paintResults(perQuestion, right, total) {
    const pct = total ? Math.round((right / total) * 100) : 0;
    const wrongTerms = [];
    for (const { q, r } of perQuestion) {
      if (q.kind === 'matching') r.results.filter(x => !x.correct).forEach(x => wrongTerms.push(x.term));
      else if (!r.correct) wrongTerms.push(q.term);
    }

    const scoreColor = pct >= 80 ? 'var(--c-good)' : pct >= 60 ? 'var(--c-warn)' : 'var(--c-bad)';
    const summary = el('div', { class: 'card card__pad test-score', style: { marginBottom: '18px' } },
      el('div', { class: 'test-score__big', style: { color: scoreColor } }, `${pct}%`),
      el('div', { class: 'test-score__sub' }, `${right} of ${total} correct`),
      el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '20px' } },
        wrongTerms.length ? el('a', { class: 'btn btn--primary', href: `#/set/${set.id}/learn` }, icon('brain'), `Study the ${wrongTerms.length} you missed`) : null,
        el('button', { class: 'btn', type: 'button', onclick: () => { buildPaper(paper.seed); paintPaper(); window.scrollTo({ top: 0 }); } }, icon('undo'), 'Retake this test'),
        el('button', { class: 'btn', type: 'button', onclick: () => { buildPaper(); paintPaper(); window.scrollTo({ top: 0 }); } }, icon('shuffle'), 'New test'),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: paintSetup }, 'Change options'),
      ));

    const review = el('div', {});
    perQuestion.forEach(({ q, r }, n) => review.appendChild(reviewCard(q, r, n)));

    stage.replaceChildren(summary, el('h2', { style: { margin: '10px 0 12px' } }, 'Review'), review,
      el('div', { class: 'sticky-bar' },
        el('a', { class: 'btn', href: `#/set/${set.id}` }, 'Back to set'),
        el('div', { style: { flex: '1' } }),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => { buildPaper(); paintPaper(); window.scrollTo({ top: 0 }); } }, 'New test')));

    announce(`Test finished. Score ${pct} percent, ${right} of ${total} correct.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reviewCard(q, r, n) {
    const allRight = r.correctCount === r.total;
    const card = el('div', { class: `test-q ${allRight ? 'is-correct' : 'is-wrong'}` },
      el('div', { class: 'test-q__n' },
        el('span', {}, q.kind === 'matching' ? `Matching set ${n + 1}` : `Question ${n + 1}`),
        el('span', { class: `chip ${allRight ? 'chip--good' : 'chip--bad'}` },
          allRight ? 'Correct' : r.total > 1 ? `${r.correctCount} of ${r.total}` : 'Incorrect')));

    if (q.kind === 'matching') {
      r.results.forEach(x => {
        const promptText = q.dir === 'definition' ? x.term.term : x.term.definition;
        const answerText = q.dir === 'definition' ? x.term.definition : x.term.term;
        const pickedText = x.picked ? (q.dir === 'definition' ? x.picked.definition : x.picked.term) : '(blank)';
        card.appendChild(el('div', { class: 'match-q__item', style: { marginBottom: '6px' } },
          el('span', { class: `chip ${x.correct ? 'chip--good' : 'chip--bad'}` }, x.correct ? '✓' : '✗'),
          el('span', {}, el('strong', {}, promptText), ' → ', x.correct ? answerText : el('span', {},
            el('span', { class: 'strike' }, pickedText), ' ', el('strong', {}, answerText)))));
      });
      return card;
    }

    card.appendChild(el('div', { class: 'q-prompt is-long', style: { marginBottom: '10px' } }, q.promptText));
    if (q.kind === 'truefalse') card.appendChild(el('p', { class: 'field__hint' }, `Proposed: ${q.shown}`));
    const givenText = r.given === '' ? '(blank)' : String(r.given);
    card.appendChild(el('div', { class: `verdict verdict--${allRight ? 'good' : 'bad'}` },
      el('span', { class: 'verdict__icon' }, icon(allRight ? 'check' : 'x')),
      el('div', { class: 'verdict__body' },
        el('div', { class: 'verdict__h' }, allRight ? 'Correct' : 'Incorrect'),
        allRight ? null : el('div', {}, 'You answered ', el('span', { class: 'strike' }, givenText)),
        el('div', { class: 'verdict__ans' }, el('strong', {}, 'Answer: '), q.kind === 'truefalse' ? (q.expectTrue ? 'True' : 'False') : q.answerText),
        q.kind === 'truefalse' && !q.expectTrue ? el('div', { class: 'field__hint' }, `Correct answer: ${q.answerText}`) : null,
      )));
    return card;
  }

  /* ---------------- keyboard ---------------- */
  session.keyHandler = (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    if (isTyping(e) || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' && e.ctrlKey) {
      const btn = stage.parentElement.querySelector('.sticky-bar .btn--primary');
      if (btn) { e.preventDefault(); btn.click(); }
    }
  };
  document.addEventListener('keydown', session.keyHandler);

  paintSetup();
}
