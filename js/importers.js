/* importers.js — turn text pasted or dropped from other apps into term/definition
 * pairs. Handles Quizlet's own export format, CSV/TSV (RFC-4180 quoting), Anki
 * text exports, Markdown tables, and JSON from a range of flashcard apps.
 */
import { htmlToText } from './utils.js';

/* ---------- CSV / delimited ---------- */
/**
 * Quotes are only structural in real CSV. Quizlet and Anki export tab-separated
 * text where a leading `"` is just a quotation mark — treating it as a field
 * delimiter there silently eats characters, so quote handling is limited to the
 * comma/semicolon formats that actually use it.
 */
const QUOTED_DELIMITERS = new Set([',', ';']);

/** Delimited-text parser; honours RFC-4180 quoting for CSV-style separators. */
export function parseDelimited(text, delimiter = ',', { quoted = QUOTED_DELIMITERS.has(delimiter) } = {}) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!quoted) {
      if (ch === delimiter) { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      else field += ch;
      continue;
    }
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** Guess the column separator from the first few non-empty lines. */
export function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 25);
  if (!lines.length) return '\t';
  const cands = ['\t', ',', ';', '|'];
  let best = '\t', bestScore = -1;
  for (const d of cands) {
    const counts = lines.map(l => (l.split(d).length - 1));
    const nonZero = counts.filter(c => c > 0).length;
    if (!nonZero) continue;
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    const consistent = counts.filter(c => c === mode).length / counts.length;
    const score = nonZero / lines.length + consistent;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  // A dash-separated list ("term - definition") is common in shared notes.
  if (bestScore < 1.1) {
    const dashed = lines.filter(l => /\s[-–—]\s|\s:\s/.test(l)).length;
    if (dashed / lines.length > 0.6) return 'dash';
  }
  return best;
}

/* ---------- Quizlet-style custom separators ---------- */
export function parseCustom(text, termSep, rowSep) {
  const t = text.replace(/\r\n?/g, '\n');
  const rows = rowSep === '\n' ? t.split('\n') : t.split(rowSep);
  const out = [];
  for (const rawRow of rows) {
    const row = rawRow.trim();
    if (!row) continue;
    let term, definition;
    if (termSep === 'tab') [term, ...definition] = row.split('\t');
    else [term, ...definition] = row.split(termSep);
    definition = (definition || []).join(termSep === 'tab' ? '\t' : termSep);
    if (term === undefined) continue;
    out.push({ term: term.trim(), definition: String(definition).trim() });
  }
  return out;
}

/* ---------- JSON ---------- */
const TERM_KEYS = ['term', 'front', 'question', 'word', 'key', 'prompt', 'a', 'side1', 'text'];
const DEF_KEYS  = ['definition', 'back', 'answer', 'meaning', 'value', 'response', 'b', 'side2', 'translation'];
function pick(obj, keys) {
  for (const k of keys) {
    const hit = Object.keys(obj).find(o => o.toLowerCase() === k);
    if (hit && obj[hit] != null && String(obj[hit]).trim()) return String(obj[hit]);
  }
  return '';
}
export function parseJSON(text) {
  const data = JSON.parse(text);
  let list = null, title = '';
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object') {
    title = String(data.title || data.name || data.deckName || '');
    for (const key of ['terms', 'cards', 'notes', 'items', 'flashcards', 'data', 'sets']) {
      if (Array.isArray(data[key])) { list = data[key]; break; }
    }
    if (!list && Array.isArray(data.sets) && data.sets[0] && Array.isArray(data.sets[0].terms)) list = data.sets[0].terms;
  }
  if (!list) throw new Error('No card list found in that JSON.');
  const terms = [];
  for (const item of list) {
    if (typeof item === 'string') { terms.push({ term: item, definition: '' }); continue; }
    if (Array.isArray(item)) { terms.push({ term: String(item[0] ?? ''), definition: String(item[1] ?? '') }); continue; }
    if (!item || typeof item !== 'object') continue;
    if (Array.isArray(item.fields) && item.fields.length >= 2) {   // Anki JSON note export
      terms.push({ term: String(item.fields[0]), definition: String(item.fields[1]) });
      continue;
    }
    const term = pick(item, TERM_KEYS), definition = pick(item, DEF_KEYS);
    if (term || definition) terms.push({ term, definition, hint: pick(item, ['hint', 'note', 'example']), starred: !!item.starred });
  }
  return { title, terms };
}

/* ---------- Markdown table ---------- */
export function parseMarkdownTable(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().startsWith('|'));
  const rows = [];
  for (const line of lines) {
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;              // separator row
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

/* ---------- unified entry point ---------- */
/**
 * @param {string} text  raw pasted/dropped content
 * @param {object} opts  {format, delimiter, termSep, rowSep, swap, skipHeader, stripHtml}
 * @returns {{terms:Array<{term,definition,hint?,starred?}>, title:string, format:string, warnings:string[]}}
 */
export function parseAny(text, opts = {}) {
  const warnings = [];
  const raw = String(text || '').replace(/^\uFEFF/, '');
  if (!raw.trim()) return { terms: [], title: '', format: 'empty', warnings: ['Nothing to import.'] };

  let format = opts.format || 'auto';
  let title = '';
  let rows = null;
  let pairs = null;

  if (format === 'auto') {
    const t = raw.trim();
    if ((t.startsWith('{') || t.startsWith('[')) ) format = 'json';
    else if (/^\s*\|.*\|\s*$/m.test(t) && t.split('\n').filter(l => l.trim().startsWith('|')).length >= 2) format = 'markdown';
    else format = 'delimited';
  }

  if (format === 'json') {
    try {
      const r = parseJSON(raw);
      title = r.title; pairs = r.terms;
    } catch (err) {
      warnings.push(`JSON could not be read (${err.message}). Falling back to plain text.`);
      format = 'delimited';
    }
  }
  if (format === 'markdown') {
    rows = parseMarkdownTable(raw);
    if (!rows.length) { warnings.push('No table rows found; treating as plain text.'); format = 'delimited'; }
  }
  if (format === 'custom') {
    pairs = parseCustom(raw, opts.termSep || 'tab', opts.rowSep || '\n');
  }
  if (format === 'delimited' && !pairs) {
    let delim = opts.delimiter && opts.delimiter !== 'auto' ? opts.delimiter : sniffDelimiter(raw);
    if (delim === 'dash') {
      pairs = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^(.*?)\s+[-–—:]\s+(.*)$/);
        return m ? { term: m[1], definition: m[2] } : { term: l, definition: '' };
      });
    } else {
      rows = parseDelimited(raw, delim);
      if (rows.length && rows.every(r => r.length === 1)) {
        warnings.push('Only one column was detected — check the separator.');
      }
    }
  }

  if (!pairs) {
    rows = rows || [];
    if (opts.skipHeader && rows.length > 1) rows = rows.slice(1);
    pairs = rows.map(r => ({
      term: r[0] ?? '',
      definition: r[1] ?? '',
      hint: r[2] && r[2].length < 300 ? r[2] : '',
      starred: /^(1|true|yes|star(red)?)$/i.test(String(r[3] ?? '').trim()),
    }));
  } else if (opts.skipHeader && pairs.length > 1) {
    pairs = pairs.slice(1);
  }

  const stripHtml = opts.stripHtml !== false;
  const clean = [];
  let dropped = 0;
  for (const p of pairs) {
    let term = String(p.term ?? '');
    let definition = String(p.definition ?? '');
    let hint = String(p.hint ?? '');
    if (stripHtml) { term = htmlToText(term); definition = htmlToText(definition); hint = htmlToText(hint); }
    term = term.trim(); definition = definition.trim(); hint = hint.trim();
    if (opts.swap) [term, definition] = [definition, term];
    if (!term && !definition) { dropped++; continue; }
    clean.push({ term, definition, hint, starred: !!p.starred });
  }
  if (dropped) warnings.push(`${dropped} empty row${dropped === 1 ? '' : 's'} skipped.`);
  const blanks = clean.filter(c => !c.term || !c.definition).length;
  if (blanks) warnings.push(`${blanks} card${blanks === 1 ? ' has' : 's have'} an empty side — you can fill them in after importing.`);

  return { terms: clean, title, format, warnings };
}

/** Detect duplicate terms so the importer can offer to merge them. */
export function findDuplicates(terms) {
  const map = new Map();
  terms.forEach((t, i) => {
    const key = t.term.trim().toLowerCase();
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  });
  return [...map.values()].filter(v => v.length > 1);
}
