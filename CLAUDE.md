# StudyLab — working notes

Static, dependency-free study app (Flashcards / Learn / Test / Match) deployed
to GitHub Pages from `main` at https://fish2266.github.io/studylab/.
No build step: edit files, reload.

## Before you change anything
- `git pull --rebase origin main` first. Work has happened from more than one
  session/machine before, and a stale local copy caused a rejected push.

## Run it
- `python3 tools/devserver.py 8780` (or preview `studylab` from `.claude/launch.json`)
  then open http://localhost:8780. The dev server disables HTTP caching.
- ES modules: opening `index.html` via `file://` does not work.

## Test it
- Open http://localhost:8780/tests/ — must show **all passed**.
  It loads every module, checks every service-worker shell file exists, and
  covers grading, distractors, scheduler/override, importers, share links, XSS.
- Add a test there for any bug you fix.
- Also click through the touched mode at desktop and iPhone (375px) widths;
  `css/mobile.css` holds the iPhone-specific rules.

## Gotchas
- **Service worker caching.** `sw.js` is cache-first for the shell (instant
  repeat visits, works offline). Bump `const VERSION = 'studylab-vN'` on every
  deploy that changes app files — that is the only thing that makes users get
  new code (main.js then reloads if nothing is in progress, else shows a
  "Reload" toast). On `localhost` the shell is network-first so local edits
  show on reload; to test real SW behaviour, open `http://127.0.0.1:8780`.
- **Loading.** Screens are lazy (`VIEWS` in main.js) and the first screen's
  imports are listed as `<link rel="modulepreload">` in index.html. Adding an
  import to main/library/streak/mascot/… means adding it there too — the tests
  page checks the list against the real import graph.
- **Adding/removing/renaming a JS or CSS file?** Update the `SHELL` list in
  `sw.js` — the test page fails if it lists a missing file.
- Never pass `null`/conditionals straight to `replaceChildren`/`append`
  (renders the text "null"). Use `setChildren()` / `el()` from `js/utils.js`,
  which skip null children.
- User text must reach the DOM via `el()`/textContent, never `innerHTML`.
- Study activity (streak/heatmap) is `data.recordStudy(n)`; call it from any
  new study surface. `data.streakInfo()` / `views/streak.js` are pure — test them
  with a fixed `now`, never by writing activity from the test page.
- `js/qr.js` is a hand-written QR encoder. If you touch it, re-verify with a
  real decoder (jsQR from npm, in a scratch dir — not in the app) and update
  the fingerprint in the tests page.
- Smart grading also accepts definitions "in your own words" (`keyIdeasMatch` in
  `grading.js`: ≥75% of 3+ content words, no padding, same negation). Add a
  should-stay-wrong case to the tests for any loosening.
- Flurry (`js/mascot.js`): `createMood()` per study session, `react('right'|
  'wrong'|'skip'|'override')`, then `buddy()`/`hero()`/`snowman()` to draw.
  Those return null when switched off — pass them through `el()`/`setChildren()`.
  He goes beside existing feedback only, never over a question or in a popup.
- **Colours.** Text tokens are tuned to ≥ 4.5:1 in both themes (tests check
  them). Coloured text uses `--c-good` / `--c-bad` / `--c-warn-text` — not
  `--c-warn`, which is for bars and borders. Accent lightness and the text on
  it are picked per hue by `accentTones()` in `theme.js`; don't hard-code `#fff`
  on the accent.
- **Buttons.** Variants set `--btn-bg` / `--btn-bg-hover`; never set `background`
  directly in a `:hover` rule — that once blanked every hovered primary button.
- **Keyboard.** Page-wide shortcuts must not take Enter/Space from buttons —
  check `onControl(e)` first. When a view replaces the element that had focus,
  call `keepFocus(() => target)` so keyboard users don't restart at the top.
- UI audit script idea: drive every screen at 375/1200/dark and check cut text,
  overflow, overlaps, contrast, tap targets (see git log for the Nov 2026 audit).
- Learn's "I was right" relies on `q.before` (card snapshot taken before
  `recordAnswer`) and stores the typed wording in `card.accepted`.
- Safe Browsing treats all of `fish2266.github.io` as one site; a flag on any
  other project there affects this one too.

## Ship it
1. tests page all green  2. bump `VERSION` in `sw.js` (if app files changed)
3. commit  4. `git pull --rebase origin main`  5. `git push origin main`
6. confirm: `curl -s https://fish2266.github.io/studylab/sw.js | grep VERSION`
