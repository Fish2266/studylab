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
- **Service worker caching.** `sw.js` serves cached files first. Bump
  `const VERSION = 'studylab-vN'` on every deploy that changes app files, or
  users (and your own browser) keep running old code. When testing locally,
  unregister the SW (DevTools → Application) if behaviour looks stale.
- **Adding/removing/renaming a JS or CSS file?** Update the `SHELL` list in
  `sw.js` — the test page fails if it lists a missing file.
- Never pass `null`/conditionals straight to `replaceChildren`/`append`
  (renders the text "null"). Use `setChildren()` / `el()` from `js/utils.js`,
  which skip null children.
- User text must reach the DOM via `el()`/textContent, never `innerHTML`.
- Learn's "I was right" relies on `q.before` (card snapshot taken before
  `recordAnswer`) and stores the typed wording in `card.accepted`.
- Safe Browsing treats all of `fish2266.github.io` as one site; a flag on any
  other project there affects this one too.

## Ship it
1. tests page all green  2. bump `VERSION` in `sw.js` (if app files changed)
3. commit  4. `git pull --rebase origin main`  5. `git push origin main`
6. confirm: `curl -s https://fish2266.github.io/studylab/sw.js | grep VERSION`
