# StudyLab

A Quizlet-style study app that runs entirely in the browser. No build step, no
framework, no server, no account — just static files you can drop on GitHub
Pages.

**Modes:** Flashcards · Learn · Test · Match — each one customisable, and every
option is remembered.

---

## Deploying to GitHub Pages

1. Create a repository and copy everything in this folder into it (keep the
   `.nojekyll` file — it stops GitHub from mangling the `js/` and `css/` paths).
2. Push to `main`.
3. Repository **Settings → Pages → Source: Deploy from a branch**, branch
   `main`, folder `/ (root)`.
4. Your app is live at `https://<username>.github.io/<repo>/`.

It works from a subdirectory, so no path configuration is needed. Routing uses
the URL hash (`#/set/abc/learn`), which needs no server rewrites.

### Running it locally

Because the app uses ES modules, opening `index.html` directly from the file
system will not work — browsers block module loading over `file://`. Serve the
folder over HTTP instead:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

---

## Where your data lives

Sets are stored in **IndexedDB** in your browser. They survive reloads, browser
restarts and going offline. Nothing is ever uploaded anywhere.

- If IndexedDB is unavailable (private windows, embedded webviews, site data
  disabled), StudyLab automatically falls back to `localStorage`, and tells you
  in **Settings → Your data**.
- If both are blocked, the app still runs but warns you that nothing will be
  saved.
- **Settings → Make storage permanent** asks the browser to exempt your data
  from automatic clean-up under disk pressure.

Because storage is per-browser, there are three ways to move sets around:

| Method | Good for |
| --- | --- |
| **Download a backup** (Settings) | Everything — sets, folders and study progress — in one JSON file |
| **Export a set** (set menu → Export) | JSON, CSV, tab-separated, Anki text, or a Markdown table |
| **Share link** (set menu → Share) | Sending one set to someone else; the whole set is gzip-compressed into the URL fragment, so nothing touches a server |

A share link for a 40-card set is about 550 bytes. Very large sets produce long
URLs — the dialog warns you when a link passes the size most apps will carry.

---

## Importing from other apps

**Import** accepts pasted text or a dropped file, previews every card before
anything is saved, and auto-detects the format.

| Coming from | What to do |
| --- | --- |
| **Quizlet** | Open the set → Export → keep "Tab" and "New line" → copy and paste |
| **Anki** | File → Export → "Notes in Plain Text (.txt)" → drop the file in |
| **Excel / Google Sheets** | Terms in column A, definitions in column B → download as CSV → drop it in |
| **Notion / Obsidian** | Copy a two-column Markdown table straight into the paste box |
| **Brainscape, Cram, Knowt** | Export as CSV → drop it in |
| **Anything else** | Paste a list; the separator is detected, or pick one yourself |

Handled automatically: RFC-4180 quoted CSV fields (commas and newlines inside
cells), semicolon and pipe separators, `term - definition` dash lists, HTML in
Anki exports, and JSON from a range of flashcard apps. Duplicate terms are
flagged before you import.

---

## The modes

### Flashcards
Flip animation, keyboard navigation, shuffle, star cards, hints, autoplay with
adjustable speed, text-to-speech (per-side, per-language), fullscreen, and
"know it / still learning" sorting that feeds the set's overall progress.
Filters for starred-only and skip-what-you-know.

### Learn
Adaptive rounds built on a Leitner box system. Terms start with recognition
questions (multiple choice, true/false) and graduate to recall (typed answers)
as you get them right. A wrong answer drops the term back and re-queues it
inside the same round, so you never finish a round with something unanswered.

Configurable: answer with term/definition/both, which question types are in
play, terms per round, how many correct answers in a row count as mastery, what
a wrong answer costs, smart grading, typo tolerance, auto-advance, and audio.

### Test
Generate a practice exam: question count, question types (written, multiple
choice, true/false, matching), answer direction, starred-only, skip-mastered,
instant feedback or mark-at-the-end, and an optional timer. Graded with a score,
a per-question review, and a one-click jump into Learn for what you missed.
"Retake this test" reproduces the exact same paper; "New test" draws fresh
questions.

### Match
Pair terms with definitions against the clock. Wrong pairs add a one-second
penalty, and your best time per set is saved.

### Smart grading
Used by Learn and Test. Ignores capitalisation, punctuation, accents and leading
articles; accepts either side of `a / b` answers and treats parenthesised
qualifiers as optional; and flags single typos separately so you can be told
"almost" rather than simply marked wrong. Two stricter levels are available
(basic, and exact match).

---

## Keyboard shortcuts

Press <kbd>?</kbd> anywhere for the full list.

| | |
| --- | --- |
| `G` then `L` / `C` / `I` / `S` | Library / Create / Import / Settings |
| `T` | Cycle theme |
| `Space` | Flip card · `←` `→` previous/next · `S` star · `X` shuffle · `P` play · `A` read aloud · `F` fullscreen |
| `1`–`4` | Answer a multiple-choice question |
| `Enter` | Submit, then continue · `Shift`+`Enter` don't know · `O` override "I was right" |

---

## Accessibility and preferences

Full keyboard operation, focus management on navigation, focus-trapped dialogs,
live-region announcements for answers and state changes, and labelled controls
throughout. Settings cover theme (system/light/dark), seven accent colours
(which also recolour the tab icon), interface scale, a higher-legibility card
font, and a reduce-motion switch — and `prefers-reduced-motion` is honoured
without touching a setting.

---

## Project structure

```
index.html            markup shell
sw.js                 service worker (offline support)
css/app.css           design tokens, themes, layout, components
css/modes.css         study surfaces: flashcards, questions, test, match
js/main.js            boot, routes, global shortcuts
js/router.js          hash router with navigation guards
js/data.js            domain model: sets, terms, progress, settings
js/storage.js         IndexedDB with localStorage fallback
js/grading.js         answer checking and distractor generation
js/scheduler.js       the Leitner engine behind Learn
js/importers.js       parsers for CSV/TSV/JSON/Markdown/Anki
js/share.js           export formats and gzip share links
js/speech.js          text-to-speech (degrades to a no-op)
js/theme.js           appearance, incl. the generated favicon
js/ui.js              toasts, modals, menus, form primitives
js/utils.js           DOM helpers and small algorithms
js/views/*.js         one module per screen
```

Notes on how it stays fast and safe:

- The library reads a lightweight index, not whole sets, so start-up does not
  depend on how much you have saved.
- Long lists (terms, editor rows, search results) render in chunks and use
  delegated event handling — a 2,000-term set keeps the DOM under ~1,000 nodes.
- Distractor generation samples a bounded window of the pool, so building
  questions costs the same on a 20-term set and a 5,000-term one.
- All user content reaches the DOM as text nodes, never as markup, and imported
  HTML is stripped.
- Storage failures (including quota exhaustion) surface as actionable messages
  rather than silent data loss.

---

## Browser support

Current Chrome, Edge, Firefox and Safari, on desktop and mobile. Text-to-speech
and compressed share links degrade gracefully where unsupported.
