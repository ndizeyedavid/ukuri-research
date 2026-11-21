// Shared export formats for saved/cited works: BibTeX, RIS, CSV, author helpers.
import { buildReference } from './apa.js';

export const authorList = (w) =>
  (Array.isArray(w.authors) ? w.authors : String(w.authors || '').split(/\s*,\s*/)).map((a) => String(a).trim()).filter(Boolean);
export const surname = (name) => String(name || '').trim().split(/\s+/).pop() || '';
export const doiUrl = (w) => (w.doi ? `https://doi.org/${encodeURI(w.doi)}` : null);
export const apaOf = (w) => buildReference(w).plain;

function bibKey(w, used) {
  const base = (surname(authorList(w)[0]) || 'anon').normalize('NFKD').replace(/[^A-Za-z]/g, '').toLowerCase() + (w.year || 'nd');
  let key = base, n = 0;
  while (used.has(key)) key = base + String.fromCharCode(97 + n++);
  used.add(key);
  return key;
}
const bibEsc = (s) => String(s ?? '').replace(/([{}])/g, '\\$1');

export function toBibtex(works) {
  const used = new Set();
  return works.map((w) => {
    const type = w.journal ? 'article' : 'misc';
    const f = [
      ['author', authorList(w).join(' and ')],
      ['title', w.title],
      ['journal', w.journal], ['year', w.year], ['volume', w.volume], ['number', w.issue], ['pages', w.pages],
      ['doi', w.doi], ['url', doiUrl(w) || w.oaUrl],
    ].filter(([, v]) => v);
    // double braces on title keep capitalisation as written
    return `@${type}{${bibKey(w, used)},\n${f.map(([k, v]) => `  ${k} = {${k === 'title' ? `{${bibEsc(v)}}` : bibEsc(v)}}`).join(',\n')}\n}`;
  }).join('\n\n');
}

export function toRis(works) {
  return works.map((w) => {
    const lines = [`TY  - ${w.journal ? 'JOUR' : 'GEN'}`];
    for (const a of authorList(w)) lines.push(`AU  - ${a}`);
    if (w.title) lines.push(`TI  - ${w.title}`);
    if (w.journal) lines.push(`JO  - ${w.journal}`);
    if (w.year) lines.push(`PY  - ${w.year}`);
    if (w.volume) lines.push(`VL  - ${w.volume}`);
    if (w.issue) lines.push(`IS  - ${w.issue}`);
    if (w.pages) {
      const [sp, ep] = String(w.pages).split(/\s*[-–—]\s*/);
      lines.push(`SP  - ${sp}`);
      if (ep) lines.push(`EP  - ${ep}`);
    }
    if (w.doi) lines.push(`DO  - ${w.doi}`);
    lines.push('ER  - ');
    return lines.join('\r\n');
  }).join('\r\n\r\n');
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(works) {
  const head = ['title', 'authors', 'year', 'journal', 'volume', 'issue', 'pages', 'doi', 'cited_by', 'open_access', 'retracted', 'apa7'];
  const rows = works.map((w) => [w.title, authorList(w).join('; '), w.year, w.journal, w.volume, w.issue, w.pages, w.doi,
    w.citedByCount ?? '', w.isOA ? 'yes' : 'no', w.isRetracted ? 'yes' : 'no', apaOf(w)]);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

export function toApaTxt(works) {
  const lines = [`References exported from Ukuri (${new Date().toISOString().slice(0, 10)})`, ''];
  for (const ref of works.map(apaOf).sort((a, b) => a.localeCompare(b))) lines.push(ref, '');
  return lines.join('\n').trim();
}

export function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

// Author input → ["First Last", …]
//  "Ashish Vaswani, Noam Shazeer"          → comma-separated full names
//  "Vaswani, A., & Shazeer, N."            → APA style, converted
//  "World Health Organization, Geneva; …"  → semicolons win when present
export function parseAuthorsInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  if (text.includes(';')) return text.split(';').map((s) => s.trim()).filter(Boolean);
  const apa = /([\p{L}'’\- ]+?),\s*((?:\p{Lu}\.(?:\s?-?\p{Lu}\.)*\s?)+)\s*(?:,\s*)?(?:&\s*|and\s+)?/gu;
  if (/^[\p{L}'’\- ]+,\s*\p{Lu}\./u.test(text)) {
    const out = [];
    let m;
    while ((m = apa.exec(text))) out.push(`${m[2].trim()} ${m[1].trim()}`);
    if (out.length) return out;
  }
  return text.split(/\s*,\s*|\s+&\s+|\s+and\s+/).map((s) => s.replace(/^&\s*/, '').trim()).filter(Boolean);
}

export function formatAuthorsInput(authors) {
  const list = (authors || []).map(String);
  return list.some((a) => a.includes(',')) ? list.join('; ') : list.join(', ');
}
