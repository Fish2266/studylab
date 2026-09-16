/* share.js — export a set to other formats, and pack a set into a URL so it can
 * be sent to someone else without a server. GitHub Pages is static, so a share
 * link carries the whole set in its fragment (never sent to the server).
 */
import { downloadFile } from './utils.js';

/* ---------- file exports ---------- */
const csvCell = (s) => {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export function toCSV(set) {
  const lines = ['Term,Definition,Hint,Starred'];
  for (const t of set.terms) lines.push([t.term, t.definition, t.hint || '', t.starred ? '1' : ''].map(csvCell).join(','));
  return lines.join('\n');
}
export function toTSV(set) {
  // Tabs and newlines inside a cell would break the row, so they are flattened.
  const flat = (s) => String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  return set.terms.map(t => `${flat(t.term)}\t${flat(t.definition)}`).join('\n');
}
export function toAnkiTxt(set) {
  const esc = (s) => String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
  return ['#separator:tab', '#html:true', ...set.terms.map(t => `${esc(t.term)}\t${esc(t.definition)}`)].join('\n');
}
export function toMarkdown(set) {
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  return [`# ${set.title}`, set.description ? `\n${set.description}\n` : '', '| Term | Definition |', '| --- | --- |',
    ...set.terms.map(t => `| ${esc(t.term)} | ${esc(t.definition)} |`)].join('\n');
}
export function toJSON(set) {
  return JSON.stringify({ app: 'StudyLab', schema: 1, sets: [set] }, null, 2);
}

const safeName = (s) => String(s || 'set').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'set';

export const EXPORT_FORMATS = [
  { id: 'json', label: 'StudyLab JSON', ext: 'json', mime: 'application/json', hint: 'Full fidelity — re-import anywhere in StudyLab', fn: toJSON },
  { id: 'csv',  label: 'CSV',           ext: 'csv',  mime: 'text/csv',        hint: 'Spreadsheets, Excel, Google Sheets', fn: toCSV },
  { id: 'tsv',  label: 'Tab-separated', ext: 'txt',  mime: 'text/plain',      hint: 'Quizlet & Anki paste-import', fn: toTSV },
  { id: 'anki', label: 'Anki text',     ext: 'txt',  mime: 'text/plain',      hint: 'File → Import in Anki desktop', fn: toAnkiTxt },
  { id: 'md',   label: 'Markdown table',ext: 'md',   mime: 'text/markdown',   hint: 'Notion, Obsidian, GitHub', fn: toMarkdown },
];

export function exportSet(set, formatId) {
  const f = EXPORT_FORMATS.find(x => x.id === formatId) || EXPORT_FORMATS[0];
  downloadFile(`${safeName(set.title)}.${f.ext}`, f.fn(set), f.mime);
}

/* ---------- share links ---------- */
const b64url = {
  encode(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};
async function gzip(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed share links.');
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const MAX_LINK = 28000;   // practical URL limit across browsers/messaging apps

/** @returns {{url:string, size:number, tooLong:boolean}} */
export async function makeShareLink(set) {
  const payload = JSON.stringify({
    v: 1, t: set.title, d: set.description,
    l: [set.termLang || '', set.defLang || ''],
    c: set.terms.map(t => (t.hint ? [t.term, t.definition, t.hint] : [t.term, t.definition])),
  });
  const bytes = new TextEncoder().encode(payload);
  const packed = await gzip(bytes);
  const body = packed ? 'g' + b64url.encode(packed) : 'r' + b64url.encode(bytes);
  const base = location.href.split('#')[0];
  const url = `${base}#/s/${body}`;
  return { url, size: url.length, tooLong: url.length > MAX_LINK };
}

export async function readShareLink(code) {
  if (!code) throw new Error('Empty share link.');
  const kind = code[0];
  const bytes = b64url.decode(code.slice(1));
  const json = new TextDecoder().decode(kind === 'g' ? await gunzip(bytes) : bytes);
  const o = JSON.parse(json);
  if (!o || !Array.isArray(o.c)) throw new Error('That share link is not a StudyLab set.');
  return {
    title: String(o.t || 'Shared set'),
    description: String(o.d || ''),
    termLang: (o.l && o.l[0]) || '', defLang: (o.l && o.l[1]) || '',
    terms: o.c.slice(0, 5000).map(c => ({ term: String(c[0] ?? ''), definition: String(c[1] ?? ''), hint: String(c[2] ?? '') })),
  };
}
