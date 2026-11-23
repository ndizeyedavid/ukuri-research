// Citation builder: smart lookup (DOI / link / title) or manual fields →
// live APA 7 / BibTeX / RIS preview → clipboard, reading list, citation map.
import { apiFetch, toast } from './api.js';
import { buildReference, buildInText } from './apa.js';
import { toggleReadingList, isInReadingList, upsertReadingList } from './store.js';
import { renderCitationMap } from './citation-map.js';
import { toBibtex, toRis, parseAuthorsInput, formatAuthorsInput } from './formats.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['fAuthors', 'fYear', 'fTitle', 'fJournal', 'fVolume', 'fIssue', 'fPages', 'fDoi'];
const DRAFT_KEY = 'ukuri.cite.draft.v1';

// linked: the OpenAlex work the fields came from (kept even when edited)
const state = { linked: null, edited: false, format: 'apa', mapFor: null };

/* ---------- input ---------- */
function currentInput() {
  return {
    authors: parseAuthorsInput($('fAuthors').value),
    year: $('fYear').value.trim() ? Number($('fYear').value) : null,
    title: $('fTitle').value.trim(),
    journal: $('fJournal').value.trim(),
    volume: $('fVolume').value.trim(),
    issue: $('fIssue').value.trim(),
    pages: $('fPages').value.trim(),
    doi: $('fDoi').value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
  };
}
const hasContent = (cur) => !!(cur.authors.length || cur.title || cur.year);

// The work as it should be saved/exported: linked metadata + the user's edits.
function currentWork() {
  const cur = currentInput();
  const base = state.linked || {
    id: `manual:${(cur.doi || cur.title || String(Date.now())).slice(0, 60)}`,
    shortId: null, type: 'manual', citedByCount: 0, isOA: false, oaUrl: null,
    isRetracted: false, countsByYear: [], referencedWorks: [],
  };
  return { ...base, ...cur, title: cur.title || 'Untitled', doi: cur.doi || null, journal: cur.journal || null,
    volume: cur.volume || null, issue: cur.issue || null, pages: cur.pages || null };
}

/* ---------- preview ---------- */
function renderPreview() {
  const cur = currentInput();
  const any = hasContent(cur);

  const ref = buildReference(cur);
  const refEl = $('refPreview'), codeEl = $('codePreview');
  if (state.format === 'apa') {
    refEl.hidden = false; codeEl.hidden = true;
    refEl.innerHTML = any ? ref.html : '<span class="muted">Fill the fields and your APA 7 reference appears here.</span>';
  } else {
    refEl.hidden = true; codeEl.hidden = false;
    codeEl.textContent = any ? (state.format === 'bibtex' ? toBibtex([currentWork()]) : toRis([currentWork()])) : 'Fill the fields to generate this format.';
  }

  const inText = buildInText(cur.authors, cur.year);
  $('inParen').textContent = any ? inText.parenthetical : 'Waiting for author and year';
  $('inNarr').textContent = any ? inText.narrative : 'Waiting for author and year';
  $('inParen').classList.toggle('is-empty', !any);
  $('inNarr').classList.toggle('is-empty', !any);

  $('retractNotice').hidden = !state.linked?.isRetracted;
  renderChecks(cur, any);
  renderSource();
  updateSaveButton();
}

function renderChecks(cur, any) {
  const list = $('checks');
  list.textContent = '';
  document.querySelectorAll('.field.is-missing').forEach((f) => f.classList.remove('is-missing'));
  if (!any) { list.hidden = true; return; }
  const issues = [];
  if (!cur.authors.length) issues.push(['authors', 'No authors. The reference starts with “Unknown author”.']);
  if (!cur.year) issues.push(['year', 'No year. APA uses “n.d.” (no date).']);
  if (!cur.title) issues.push(['title', 'No title. Shown as “Untitled”.']);
  if (!cur.journal) issues.push(['journal', 'No journal or source. Fine for some works, but most articles need one.']);
  if (cur.journal && !cur.volume) issues.push(['volume', 'Journal articles usually have a volume number.']);
  if (cur.journal && !cur.pages) issues.push(['pages', 'No page range or article number.']);
  if (!cur.doi) issues.push(['doi', 'No DOI. APA 7 requires it whenever the work has one.']);
  if (cur.year && (cur.year < 1500 || cur.year > new Date().getFullYear() + 1)) issues.push(['year', 'That year looks off.']);
  list.hidden = !issues.length;
  for (const [field, text] of issues) {
    document.querySelector(`.field[data-field="${field}"]`)?.classList.add('is-missing');
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'check-item';
    b.textContent = text;
    b.addEventListener('click', () => document.querySelector(`.field[data-field="${field}"] .input`)?.focus());
    li.appendChild(b);
    list.appendChild(li);
  }
}

function renderSource() {
  const chip = $('sourceChip'), text = $('sourceText');
  if (state.linked) {
    chip.dataset.kind = state.edited ? 'edited' : 'linked';
    text.textContent = `openalex · ${state.linked.shortId || 'work'}${state.edited ? ' · edited' : ''}`;
  } else {
    chip.dataset.kind = 'manual';
    text.textContent = 'manual entry';
  }
}

function updateSaveButton() {
  const btn = $('saveList');
  const id = state.linked?.id || null;
  const inList = id ? isInReadingList(id) : false;
  if (inList && state.edited) btn.textContent = 'Update saved copy';
  else btn.textContent = inList ? 'Saved to reading list' : 'Save to reading list';
  btn.setAttribute('aria-pressed', String(inList && !state.edited));
}

/* ---------- persistence: URL for linked works, draft for everything ---------- */
let draftTimer = null;
function persist() {
  const url = new URL(location.href);
  url.searchParams.delete('doi');
  if (state.linked?.shortId) url.searchParams.set('id', state.linked.shortId);
  else url.searchParams.delete('id');
  history.replaceState(null, '', url);

  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      const fields = Object.fromEntries(FIELDS.map((id) => [id, $(id).value]));
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ fields, linked: state.linked, edited: state.edited, format: state.format }));
    } catch { /* storage unavailable */ }
  }, 250);
}

function restoreDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
  if (!d?.fields) return false;
  for (const id of FIELDS) $(id).value = d.fields[id] ?? '';
  state.linked = d.linked || null;
  state.edited = !!d.edited;
  if (d.format) setFormat(d.format, { silent: true });
  if (state.linked) prepareMap(state.linked);
  return Object.values(d.fields).some(Boolean);
}

/* ---------- fill / reset ---------- */
function fillFromWork(w) {
  $('fAuthors').value = formatAuthorsInput(w.authors);
  $('fYear').value = w.year ?? '';
  $('fTitle').value = w.title || '';
  $('fJournal').value = w.journal || '';
  $('fVolume').value = w.volume || '';
  $('fIssue').value = w.issue || '';
  $('fPages').value = w.pages || '';
  $('fDoi').value = w.doi || '';
  state.linked = w;
  state.edited = false;
  prepareMap(w);
  renderPreview();
  persist();
}

FIELDS.forEach((id) => $(id).addEventListener('input', () => {
  if (state.linked) state.edited = true; // keep the link: a typo fix shouldn't orphan the work
  renderPreview();
  persist();
}));

$('newCitation').addEventListener('click', () => {
  FIELDS.forEach((id) => { $(id).value = ''; });
  state.linked = null; state.edited = false; state.mapFor = null;
  $('mapCard').hidden = true;
  $('citeStatus').textContent = '';
  $('doiInput').value = '';
  hideResults();
  renderPreview();
  persist();
  $('doiInput').focus();
});

/* ---------- smart lookup ---------- */
function classify(raw) {
  const text = raw.trim();
  const doi = text.match(/10\.\d{4,9}\/[^\s"<>]+/i);
  if (doi) return { kind: 'doi', value: doi[0].replace(/[.,;)\]]+$/, '') };
  const oa = text.match(/\b(W\d{4,})\b/i);
  if (oa) return { kind: 'openalex', value: oa[1].toUpperCase() };
  if (text.length >= 4) return { kind: 'title', value: text.slice(0, 200) };
  return null;
}

function setBusy(on, label = 'Look up') {
  const btn = $('doiBtn');
  btn.disabled = on;
  btn.textContent = on ? 'Looking up…' : label;
}

async function loadWork(idOrDoi, { announce = 'Loaded' } = {}) {
  const status = $('citeStatus');
  setBusy(true);
  try {
    const w = await apiFetch(`/api/work/${encodeURIComponent(idOrDoi)}`);
    fillFromWork(w);
    status.textContent = `${announce}: ${w.title.slice(0, 80)}${w.title.length > 80 ? '…' : ''} (${w.year ?? 'n.d.'})`;
    return true;
  } catch (err) {
    status.textContent = err.status === 404
      ? 'Nothing found for that. Check it, try the title instead, or fill the fields by hand.'
      : err.message;
    return false;
  } finally {
    setBusy(false);
  }
}

const results = $('lookupResults');
let resultItems = [], activeIdx = -1;

function hideResults() { results.hidden = true; results.textContent = ''; resultItems = []; activeIdx = -1; $('doiInput').removeAttribute('aria-activedescendant'); }

function setActive(i) {
  resultItems.forEach((el, k) => el.classList.toggle('is-active', k === i));
  activeIdx = i;
  if (resultItems[i]) {
    $('doiInput').setAttribute('aria-activedescendant', resultItems[i].id);
    resultItems[i].scrollIntoView({ block: 'nearest' });
  }
}

async function searchTitles(q) {
  setBusy(true);
  $('citeStatus').textContent = '';
  try {
    const data = await apiFetch(`/api/search?q=${encodeURIComponent(q)}&per_page=6`);
    results.textContent = '';
    resultItems = [];
    if (!data.results?.length) {
      $('citeStatus').textContent = 'No works matched that title. Try fewer words, or fill the fields by hand.';
      hideResults();
      return;
    }
    data.results.forEach((w, i) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'lookup-option';
      opt.id = `lookup-opt-${i}`;
      opt.setAttribute('role', 'option');
      const t = document.createElement('span');
      t.className = 'lookup-option-title';
      t.textContent = w.title;
      const m = document.createElement('span');
      m.className = 'lookup-option-meta';
      const a = w.authors?.length ? `${w.authors[0]}${w.authors.length > 1 ? ' et al.' : ''}` : 'Unknown authors';
      m.textContent = [a, w.year ?? 'n.d.', w.journal, w.isRetracted ? 'RETRACTED' : null].filter(Boolean).join(' · ');
      opt.append(t, m);
      opt.addEventListener('click', () => pick(w));
      opt.addEventListener('mousemove', () => setActive(i));
      results.appendChild(opt);
      resultItems.push(opt);
    });
    results.hidden = false;
    setActive(0);
  } catch (err) {
    $('citeStatus').textContent = err.message;
  } finally {
    setBusy(false);
  }
}

async function pick(w) {
  hideResults();
  $('doiInput').value = '';
  await loadWork(w.shortId || w.id, { announce: 'Loaded' });
}

$('doiForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!results.hidden && resultItems[activeIdx]) { resultItems[activeIdx].click(); return; }
  const c = classify($('doiInput').value);
  if (!c) { $('citeStatus').textContent = 'Type a DOI, an OpenAlex/doi.org link, or a few words of the title.'; return; }
  if (c.kind === 'doi') loadWork(`doi:${c.value}`, { announce: 'Found' }).then((ok) => { if (ok) $('doiInput').value = ''; });
  else if (c.kind === 'openalex') loadWork(c.value, { announce: 'Found' }).then((ok) => { if (ok) $('doiInput').value = ''; });
  else searchTitles(c.value);
});

$('doiInput').addEventListener('keydown', (e) => {
  if (results.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, resultItems.length - 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
  else if (e.key === 'Escape') { e.preventDefault(); hideResults(); }
});
$('doiInput').addEventListener('input', () => { if (!results.hidden) hideResults(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.lookup-wrap')) hideResults(); });

/* ---------- formats + copy ---------- */
function setFormat(fmt, { silent = false } = {}) {
  state.format = fmt;
  document.querySelectorAll('[data-fmt]').forEach((t) => {
    const on = t.dataset.fmt === fmt;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $('copyRefPlain').textContent = fmt === 'apa' ? 'Copy plain' : `Copy ${fmt === 'bibtex' ? 'BibTeX' : 'RIS'}`;
  if (!silent) { renderPreview(); persist(); }
}
document.querySelectorAll('[data-fmt]').forEach((t) => t.addEventListener('click', () => setFormat(t.dataset.fmt)));

const copyText = (text, msg) => navigator.clipboard.writeText(text).then(() => toast(msg)).catch(() => toast('Clipboard blocked'));

async function copyRich() {
  const cur = currentInput();
  if (!hasContent(cur)) { toast('Nothing to copy yet'); return; }
  const { plain, html } = buildReference(cur);
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      const item = new ClipboardItem({
        'text/html': new Blob([`<p style="font-family: Georgia, serif">${html}</p>`], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    toast(state.linked?.isRetracted ? 'Copied. Remember this work is retracted' : 'Reference copied, ready to paste into Word or Docs');
  } catch {
    toast('Clipboard blocked. Use “Copy plain” instead');
  }
}

$('copyRef').addEventListener('click', copyRich);
$('copyRefPlain').addEventListener('click', () => {
  const cur = currentInput();
  if (!hasContent(cur)) { toast('Nothing to copy yet'); return; }
  if (state.format === 'apa') copyText(buildReference(cur).plain, 'Copied as plain text');
  else copyText($('codePreview').textContent, `Copied ${state.format === 'bibtex' ? 'BibTeX' : 'RIS'}`);
});
$('copyParen').addEventListener('click', () => copyText($('inParen').textContent, 'Copied'));
$('copyNarr').addEventListener('click', () => copyText($('inNarr').textContent, 'Copied'));

$('saveList').addEventListener('click', () => {
  if (!hasContent(currentInput())) { toast('Fill in the reference first'); return; }
  const work = currentWork();
  if (isInReadingList(work.id) && state.edited) {
    upsertReadingList(work);
    toast('Saved copy updated');
  } else {
    const added = toggleReadingList(work);
    toast(added ? 'Added to reading list' : 'Removed from reading list');
  }
  if (!state.linked) { state.linked = work; state.edited = false; } // manual works become their own saved entry
  renderPreview();
  persist();
});

/* ---------- citation map (collapsed; loads on demand) ---------- */
function referencedIds(w) {
  return (w.referencedWorks || []).map((x) => String(x).split('/').pop()).filter((x) => /^W\d+$/i.test(x)).slice(0, 12);
}

function prepareMap(w) {
  const card = $('mapCard');
  const ids = referencedIds(w);
  state.mapFor = null;
  $('citationMap').hidden = true;
  $('citationMap').textContent = '';
  $('mapToggle').setAttribute('aria-expanded', 'false');
  card.classList.remove('is-open');
  if (!w.shortId || !ids.length) { card.hidden = true; return; }
  $('mapMeta').textContent = `${ids.length} referenced work${ids.length === 1 ? '' : 's'}`;
  card.hidden = false;
  setMapOpen(true); // open by default; the header collapses it
}

function setMapOpen(open) {
  $('mapToggle').setAttribute('aria-expanded', String(open));
  $('mapCard').classList.toggle('is-open', open);
  $('citationMap').hidden = !open;
  if (open) openMap();
}

async function openMap() {
  const w = state.linked;
  if (!w) return;
  if (state.mapFor === w.shortId) return;
  state.mapFor = w.shortId;
  const box = $('citationMap');
  box.innerHTML = '<p class="muted map-loading-inline">Fetching referenced works…</p>';
  const ids = referencedIds(w);
  try {
    const data = await apiFetch(`/api/works?ids=${ids.join(',')}`);
    const related = (data.results || []).map((x) => ({
      shortId: x.shortId, title: x.title, year: x.year, citedByCount: x.citedByCount,
      refIds: (x.referencedWorks || []).map((u) => String(u).split('/').pop()),
    }));
    if (!related.length) { box.innerHTML = '<p class="muted map-loading-inline">OpenAlex has no details for the referenced works.</p>'; return; }
    const root = { shortId: w.shortId, title: w.title, year: w.year, citedByCount: w.citedByCount, refIds: ids };
    renderCitationMap(box, { rootLabel: `${w.title} - ${w.year ?? 'n.d.'}`, rootId: w.shortId, works: [root, ...related] });
  } catch (err) {
    state.mapFor = null;
    box.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'muted map-loading-inline';
    p.textContent = `Couldn’t load the map (${err.message}).`;
    box.appendChild(p);
  }
}

$('mapToggle').addEventListener('click', () => setMapOpen($('mapToggle').getAttribute('aria-expanded') !== 'true'));

/* ---------- boot: ?id= / ?doi= deep links, else restore draft ---------- */
window.addEventListener('ukuri:list-changed', updateSaveButton);
const params = new URLSearchParams(location.search);
const deepId = params.get('id');
const deepDoi = params.get('doi');
if (deepId || deepDoi) {
  $('citeStatus').textContent = 'Loading work…';
  loadWork(deepId || `doi:${deepDoi}`);
} else if (restoreDraft()) {
  $('citeStatus').textContent = 'Restored your last citation.';
}
renderPreview();
