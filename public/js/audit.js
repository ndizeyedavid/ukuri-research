// Auditor: paste or PDF → split references → POST /api/audit-match → verdicts.
import { apiFetch, toast } from './api.js';
import { loadPdf, extractReferencesSection, splitReferences, splitPastedReferences } from './pdf-extract.js';
import { buildReference } from './apa.js';
import { renderDiagram } from './citation-map.js';
import { buildRelationsDot } from './map.js';

const $ = (id) => document.getElementById(id);

const VERDICT = {
  valid:        { label: 'Valid', class: 'v-valid' },
  mismatch:     { label: 'Mismatch', class: 'v-mismatch' },
  ghost:        { label: 'Likely ghost', class: 'v-ghost' },
  retracted:    { label: 'Retracted', class: 'v-retracted' },
  unverifiable: { label: 'Unverifiable', class: 'v-unverifiable' },
};

let lastPdfLines = null;      // extracted section lines when uploaded via PDF and unedited
let lastExtractedText = null; // guard: user edits invalidate PDF-mode splitting
let lastResults = null;

/* ---------- tabs ---------- */
const tabPaste = $('tabPaste'), tabPdf = $('tabPdf');
const panePaste = $('panePaste'), panePdf = $('panePdf');
function setTab(which) {
  const pdf = which === 'pdf';
  tabPdf.classList.toggle('is-active', pdf);
  tabPaste.classList.toggle('is-active', !pdf);
  tabPdf.setAttribute('aria-selected', String(pdf));
  tabPaste.setAttribute('aria-selected', String(!pdf));
  panePdf.hidden = !pdf;
  panePaste.hidden = pdf;
}
tabPaste.addEventListener('click', () => setTab('paste'));
tabPdf.addEventListener('click', () => setTab('pdf'));

/* ---------- PDF ingestion ---------- */
const dz = $('dropzone'), fileInput = $('pdfFile'), extractStatus = $('extractStatus');
dz.addEventListener('click', () => fileInput.click());
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragging'); }));
dz.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) handlePdf(f); });
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) handlePdf(f); });

async function handlePdf(file) {
  if (file.size > 25 * 1024 * 1024) { extractStatus.textContent = 'PDF is larger than 25 MB, too big to process in the browser.'; return; }
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { extractStatus.textContent = 'That doesn’t look like a PDF.'; return; }
  extractStatus.textContent = 'Reading PDF…';
  lastPdfLines = null; lastExtractedText = null;
  try {
    const doc = await loadPdf(file);
    const result = await extractReferencesSection(doc);
    if (result.sectionFound) {
      extractStatus.textContent = `Found a References section (${result.pageCount} pages)${result.stoppedAtAppendix ? ', stopped at Appendix' : ''}. Extracted ${result.lines.length} lines below. Fix anything that looks off, then audit.`;
      $('refInput').value = result.sectionText;
      lastPdfLines = result.lines;
      lastExtractedText = result.sectionText;
    } else {
      extractStatus.textContent = 'No “References” heading found, so the full extracted text is shown instead. Trim it manually, then audit.';
      $('refInput').value = result.fullText;
    }
    updateRefCount();
  } catch (err) {
    extractStatus.textContent = err.code === 'SCANNED_PDF'
      ? err.message
      : `Couldn’t read that PDF (${err.message}). Try another file or paste the list.`;
  }
}

/* ---------- splitting & live ref count ---------- */
function splitForAudit() {
  const text = $('refInput').value;
  if (lastPdfLines && text === lastExtractedText) return splitReferences(lastPdfLines);
  return splitPastedReferences(text);
}

const refCountEl = $('refCount');
let countTimer = null;
function updateRefCount() {
  clearTimeout(countTimer);
  countTimer = setTimeout(() => {
    const n = splitForAudit().length;
    refCountEl.textContent = `${n} reference${n === 1 ? '' : 's'} detected`;
  }, 150);
}
$('refInput').addEventListener('input', updateRefCount);

/* ---------- audit run (chunked → live progress + streaming results) ---------- */
const CHUNK = 5;
const STORE_KEY = 'ukuri.audit.last.v1';
const SEVERITY = { retracted: 0, ghost: 1, mismatch: 2, unverifiable: 3, valid: 4 };
const ATTENTION = new Set(['retracted', 'ghost', 'mismatch']);

const progressWrap = $('progressWrap'), progressText = $('progressText'), progressFill = $('progressFill');
const report = $('report'), verdictsBox = $('verdicts');
const inputStage = $('inputStage'), inputSummary = $('inputSummary');

const view = { filter: 'all', sort: 'severity', open: new Set() };
let running = null; // { cancelled: boolean }

function showInput(show) {
  inputStage.hidden = !show;
  inputSummary.hidden = show;
}
function setInputSummary(n, source) {
  $('inputSummaryText').textContent = `${n} reference${n === 1 ? '' : 's'} · ${source}`;
}
$('editList').addEventListener('click', () => { showInput(true); $('refInput').focus(); });

function setRunning(on, total = 0) {
  inputSummary.classList.toggle('is-running', on);
  $('editList').disabled = on;
  const btn = $('runAudit');
  btn.disabled = on;
  btn.classList.toggle('is-loading', on);
  btn.textContent = on ? 'Auditing…' : 'Run audit';
  if (on) $('inputSummaryText').textContent = `Auditing ${total} reference${total === 1 ? '' : 's'}…`;
}

function setProgress(done, total, startedAt) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressFill.classList.toggle('is-waiting', done === 0);
  progressFill.style.width = done === 0 ? '' : `${Math.max(pct, 3)}%`;
  if (done === 0) {
    progressText.textContent = `Checking the first ${Math.min(CHUNK, total)} of ${total} against OpenAlex…`;
    return;
  }
  let eta = '';
  if (done > 0 && done < total) {
    const per = (Date.now() - startedAt) / done;
    const secs = Math.ceil((per * (total - done)) / 1000);
    eta = ` · about ${secs < 60 ? `${secs}s` : `${Math.ceil(secs / 60)} min`} left`;
  }
  progressText.textContent = `Checked ${done} of ${total}${eta}`;
}

$('cancelAudit').addEventListener('click', () => { if (running) running.cancelled = true; });

$('clearAll').addEventListener('click', () => {
  $('refInput').value = '';
  extractStatus.textContent = '';
  report.hidden = true;
  verdictsBox.textContent = '';
  networkKey = null;
  $('networkCard').hidden = true;
  lastPdfLines = null; lastExtractedText = null; lastResults = null;
  try { localStorage.removeItem(STORE_KEY); } catch { /* storage unavailable */ }
  updateRefCount();
});

$('runAudit').addEventListener('click', async () => {
  const refs = splitForAudit();
  if (!refs.length) { toast('No references detected. Check the text above.'); return; }
  if (refs.length > 100) { toast('Audit is limited to 100 references. Trim the list first.'); return; }

  const source = lastPdfLines && $('refInput').value === lastExtractedText ? 'from PDF' : 'pasted list';
  setInputSummary(refs.length, source);
  showInput(false);

  view.filter = 'all';
  view.open.clear();
  networkKey = null;
  $('networkCard').hidden = true;
  lastResults = [];
  const job = { cancelled: false };
  running = job;
  const startedAt = Date.now();
  setRunning(true, refs.length);
  progressWrap.hidden = false;
  report.hidden = false;
  setProgress(0, refs.length, startedAt);
  renderReport({ live: true, total: refs.length });

  let failed = null;
  for (let i = 0; i < refs.length && !job.cancelled; i += CHUNK) {
    const chunk = refs.slice(i, i + CHUNK);
    try {
      const data = await apiFetch('/api/audit-match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refs: chunk }),
        timeoutMs: 60000,
      });
      data.results.forEach((r, k) => lastResults.push({ ...r, index: i + k }));
    } catch (err) {
      failed = err;
      break;
    }
    setProgress(lastResults.length, refs.length, startedAt);
    renderReport({ live: true, total: refs.length });
  }

  running = null;
  progressWrap.hidden = true;
  setRunning(false);
  setInputSummary(refs.length, source);

  if (!lastResults.length) {
    report.hidden = true;
    showInput(true);
    if (failed) toast(`Audit failed: ${failed.message}`);
    return;
  }
  renderReport({ live: false, total: refs.length });
  persist();
  buildNetwork();
  if (failed) toast(`Stopped early: ${failed.message}`);
  else if (job.cancelled) toast(`Stopped after ${lastResults.length} of ${refs.length}`);
  else toast(`Audit complete: ${lastResults.length} references checked`);
});

/* ---------- report ---------- */
function countBy(results) {
  const c = { valid: 0, mismatch: 0, ghost: 0, retracted: 0, unverifiable: 0 };
  for (const r of results) c[r.verdict] = (c[r.verdict] || 0) + 1;
  return c;
}

function plural(n, one, many = `${one}s`) { return `${n} ${n === 1 ? one : many}`; }

function renderReport({ live, total }) {
  const results = lastResults || [];
  const c = countBy(results);
  const verifiable = results.length - c.unverifiable;
  const attention = c.retracted + c.ghost + c.mismatch;

  // score + headline
  const scoreNum = $('scoreNum');
  scoreNum.textContent = verifiable ? `${Math.round((c.valid / verifiable) * 100)}%` : 'n/a';
  scoreNum.dataset.tone = !verifiable ? '' : attention === 0 ? 'good' : c.valid / verifiable >= 0.8 ? 'ok' : 'bad';

  const head = $('reportHeadline');
  const sub = $('reportSub');
  if (live) {
    head.textContent = `Checking ${total} references…`;
    sub.textContent = results.length ? `${plural(attention, 'issue')} found so far.` : 'Results appear here as each batch comes back.';
  } else if (attention === 0) {
    head.textContent = verifiable ? 'Every verifiable reference checks out.' : 'Nothing here could be verified.';
    sub.textContent = c.unverifiable
      ? `${plural(c.unverifiable, 'reference')} (books, reports, websites) couldn’t be checked against OpenAlex.`
      : `${plural(c.valid, 'reference')} matched a real, non-retracted work.`;
  } else {
    head.textContent = `${plural(attention, 'reference')} ${attention === 1 ? 'needs' : 'need'} your attention.`;
    const parts = [];
    if (c.retracted) parts.push(`${c.retracted} retracted`);
    if (c.ghost) parts.push(`${c.ghost} likely ghost`);
    if (c.mismatch) parts.push(`${c.mismatch} with mismatched details`);
    sub.textContent = `${parts.join(', ')} · ${c.valid} of ${verifiable} verifiable references are valid.`;
  }

  // proportion bar
  const bar = $('reportBar');
  bar.textContent = '';
  for (const k of ['retracted', 'ghost', 'mismatch', 'unverifiable', 'valid']) {
    if (!c[k]) continue;
    const seg = document.createElement('span');
    seg.className = `report-seg ${VERDICT[k].class}`;
    seg.style.flexGrow = String(c[k]);
    bar.appendChild(seg);
  }
  if (live && results.length < total) {
    const pend = document.createElement('span');
    pend.className = 'report-seg is-pending';
    pend.style.flexGrow = String(total - results.length);
    bar.appendChild(pend);
  }

  // filters
  const filters = $('filters');
  filters.textContent = '';
  const defs = [
    ['all', 'All', results.length],
    ['attention', 'Needs attention', attention],
    ['retracted', 'Retracted', c.retracted],
    ['ghost', 'Likely ghost', c.ghost],
    ['mismatch', 'Mismatch', c.mismatch],
    ['unverifiable', 'Unverifiable', c.unverifiable],
    ['valid', 'Valid', c.valid],
  ];
  if (view.filter !== 'all' && !defs.find(([k, , n]) => k === view.filter && n > 0)) view.filter = 'all';
  for (const [key, label, n] of defs) {
    if (key !== 'all' && key !== 'attention' && !n) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `filter-btn ${VERDICT[key]?.class || ''}`;
    if (key === 'attention') b.classList.add('is-attention');
    b.setAttribute('aria-pressed', String(view.filter === key));
    b.disabled = n === 0 && key !== 'all';
    b.innerHTML = '<span class="filter-label"></span><span class="filter-count"></span>';
    b.querySelector('.filter-label').textContent = label;
    b.querySelector('.filter-count').textContent = String(n);
    b.addEventListener('click', () => { view.filter = key; renderReport({ live: !!running, total }); });
    filters.appendChild(b);
  }

  renderRows();
  $('exportRow').hidden = live;
}

function visibleRows() {
  const results = lastResults || [];
  let rows = results.filter((r) =>
    view.filter === 'all' ? true : view.filter === 'attention' ? ATTENTION.has(r.verdict) : r.verdict === view.filter);
  rows = [...rows];
  if (view.sort === 'severity') rows.sort((a, b) => (SEVERITY[a.verdict] - SEVERITY[b.verdict]) || (a.index - b.index));
  else if (view.sort === 'score') rows.sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || (a.index - b.index));
  else rows.sort((a, b) => a.index - b.index);
  return rows;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
function titleDiffers(a, b) {
  if (!a || !b) return false;
  const A = new Set(norm(a).split(' ').filter((t) => t.length > 2));
  const B = new Set(norm(b).split(' ').filter((t) => t.length > 2));
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.max(A.size, B.size) < 0.8;
}

function correctedApa(r) {
  if (!r.matched) return null;
  return buildReference({
    authors: r.matched.authors, year: r.matched.year, title: r.matched.title,
    journal: r.matched.journal, volume: '', issue: '', pages: '', doi: r.matched.doi,
  }).plain;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function compareRow(label, mine, theirs, differs) {
  const row = el('div', `cmp-row${differs ? ' is-diff' : ''}`);
  row.append(el('span', 'cmp-key', label), el('span', 'cmp-mine', mine || 'not given'), el('span', 'cmp-theirs', theirs || 'not given'));
  return row;
}

function renderRows() {
  verdictsBox.textContent = '';
  const rows = visibleRows();
  if (!rows.length) {
    if ((lastResults || []).length) verdictsBox.appendChild(el('p', 'verdicts-empty', 'Nothing in this view.'));
    else if (running) {
      // placeholder rows while the first batch is in flight
      for (let i = 0; i < 4; i++) {
        const sk = el('div', 'vrow-skeleton');
        sk.setAttribute('aria-hidden', 'true');
        sk.append(el('span', 'sk-line sk-idx'), el('span', 'sk-line sk-badge'), el('span', 'sk-line sk-text'));
        verdictsBox.appendChild(sk);
      }
    }
    return;
  }
  for (const r of rows) {
    const meta = VERDICT[r.verdict] || VERDICT.unverifiable;
    const d = el('details', `vrow ${meta.class}`);
    d.open = view.open.has(r.index);
    d.addEventListener('toggle', () => { if (d.open) view.open.add(r.index); else view.open.delete(r.index); syncToggleAll(); });

    const s = el('summary', 'vrow-summary');
    const main = el('span', 'vrow-main');
    main.append(
      el('span', 'vrow-title', r.parsedTitle || r.ref),
      el('span', 'vrow-reason', r.note || ''),
    );
    const chev = el('span', 'vrow-chev');
    chev.setAttribute('aria-hidden', 'true');
    s.append(
      el('span', 'vrow-index', String(r.index + 1).padStart(2, '0')),
      el('span', `verdict-badge ${meta.class}`, meta.label),
      main,
      el('span', 'vrow-score', r.score != null ? String(r.score) : ''),
      chev,
    );
    if (r.score != null) s.lastChild.previousSibling.title = `match score ${r.score}/100`;
    d.appendChild(s);

    const body = el('div', 'vrow-body');
    body.append(el('p', 'section-label', 'your reference'), el('p', 'verdict-ref', r.ref));

    if (r.matched) {
      const isCandidate = r.verdict === 'ghost';
      const cmp = el('div', 'cmp');
      const headRow = el('div', 'cmp-row cmp-head');
      headRow.append(el('span', 'cmp-key', ''), el('span', 'cmp-mine', 'yours'), el('span', 'cmp-theirs', isCandidate ? 'closest candidate' : 'openalex'));
      cmp.appendChild(headRow);
      cmp.appendChild(compareRow('title', r.parsedTitle, r.matched.title, titleDiffers(r.parsedTitle, r.matched.title)));
      cmp.appendChild(compareRow('year', r.parsedYear ? String(r.parsedYear) : '', r.matched.year ? String(r.matched.year) : '',
        !!(r.parsedYear && r.matched.year && r.parsedYear !== r.matched.year)));
      cmp.appendChild(compareRow('doi', r.parsedDoi, r.matched.doi,
        !!(r.parsedDoi && r.matched.doi && r.parsedDoi.toLowerCase() !== r.matched.doi.toLowerCase())));
      cmp.appendChild(compareRow('authors', '', (r.matched.authors || []).join(', '), false));
      cmp.appendChild(compareRow('source', '', [r.matched.journal, r.matched.citedByCount != null ? `${Number(r.matched.citedByCount).toLocaleString()} citations` : ''].filter(Boolean).join(' · '), false));
      body.appendChild(cmp);
    }

    const actions = el('div', 'vrow-actions');
    if (r.matched && r.verdict !== 'ghost') {
      const copy = el('button', 'btn btn-small', r.verdict === 'retracted' ? 'Copy APA (retracted)' : 'Copy corrected APA');
      copy.type = 'button';
      copy.addEventListener('click', () => navigator.clipboard.writeText(correctedApa(r)).then(() => toast('Copied')).catch(() => toast('Clipboard blocked')));
      actions.appendChild(copy);
    }
    if (r.matched) {
      const open = el('a', 'btn btn-ghost btn-small', r.matched.doi ? 'Open DOI ↗' : 'Open in OpenAlex ↗');
      open.href = r.matched.doi ? `https://doi.org/${encodeURI(r.matched.doi)}` : `https://openalex.org/${r.matched.shortId}`;
      open.target = '_blank'; open.rel = 'noopener noreferrer';
      actions.appendChild(open);
      if (r.matched.shortId && r.verdict !== 'ghost') {
        const cite = el('a', 'btn btn-ghost btn-small', 'Edit in Cite');
        cite.href = `/cite.html?id=${encodeURIComponent(r.matched.shortId)}`;
        actions.appendChild(cite);
      }
    } else {
      const q = el('a', 'btn btn-ghost btn-small', 'Search manually');
      q.href = `/?q=${encodeURIComponent((r.parsedTitle || r.ref).slice(0, 200))}`;
      actions.appendChild(q);
    }
    body.appendChild(actions);
    d.appendChild(body);
    verdictsBox.appendChild(d);
  }
  syncToggleAll();
}

function syncToggleAll() {
  const rows = verdictsBox.querySelectorAll('details.vrow');
  const allOpen = rows.length > 0 && [...rows].every((d) => d.open);
  $('toggleAll').textContent = allOpen ? 'Collapse all' : 'Expand all';
}
$('toggleAll').addEventListener('click', () => {
  const rows = [...verdictsBox.querySelectorAll('details.vrow')];
  const open = !rows.every((d) => d.open);
  rows.forEach((d) => { d.open = open; });
});
$('sortMode').addEventListener('change', (e) => { view.sort = e.target.value; renderRows(); });

/* ---------- citation network (your references ↔ each other ↔ shared foundations) ---------- */
const MAX_HUBS = 10;
let networkKey = null;

function setNetworkOpen(open) {
  $('networkToggle').setAttribute('aria-expanded', String(open));
  $('networkCard').classList.toggle('is-open', open);
  $('networkBody').hidden = !open;
}
$('networkToggle').addEventListener('click', () => setNetworkOpen($('networkToggle').getAttribute('aria-expanded') !== 'true'));

function networkNote(text) {
  $('networkInsights').textContent = '';
  $('networkMap').textContent = '';
  $('networkInsights').appendChild(el('p', 'muted map-loading-inline', text));
}

async function fetchWorksBatched(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 20) {
    const data = await apiFetch(`/api/works?ids=${ids.slice(i, i + 20).join(',')}`, { timeoutMs: 20000 });
    out.push(...(data.results || []));
  }
  return out;
}

async function buildNetwork() {
  const card = $('networkCard');
  const mine = (lastResults || [])
    .filter((r) => r.matched?.shortId && r.verdict !== 'ghost' && r.verdict !== 'unverifiable')
    .sort((a, b) => a.index - b.index);
  // one node per OpenAlex work even if the list repeats a reference
  const seen = new Set();
  const nodes = mine.filter((r) => (seen.has(r.matched.shortId) ? false : seen.add(r.matched.shortId)));

  const key = nodes.map((r) => r.matched.shortId).join(',') || 'none';
  if (key === networkKey) return;
  networkKey = key;

  card.hidden = false;
  setNetworkOpen(true);
  if (nodes.length < 2) {
    $('networkMeta').textContent = '';
    networkNote('Needs at least 2 references matched in OpenAlex to show how they connect.');
    return;
  }
  $('networkMeta').textContent = `${nodes.length} matched references`;
  networkNote('Reading the bibliographies of your references…');

  try {
    const details = await fetchWorksBatched(nodes.map((r) => r.matched.shortId));
    const refsOf = new Map(details.map((w) => [w.shortId, (w.referencedWorks || []).map((u) => String(u).split('/').pop())]));
    const mineIds = new Set(nodes.map((r) => r.matched.shortId));

    const internal = [];
    const hubCiters = new Map();
    for (const r of nodes) {
      const id = r.matched.shortId;
      for (const ref of refsOf.get(id) || []) {
        if (ref === id) continue;
        if (mineIds.has(ref)) internal.push([id, ref]);
        else hubCiters.set(ref, [...(hubCiters.get(ref) || []), id]);
      }
    }
    const hubIds = [...hubCiters.entries()]
      .filter(([, citers]) => citers.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, MAX_HUBS);
    const hubDetails = hubIds.length ? await fetchWorksBatched(hubIds.map(([id]) => id)) : [];
    const hubById = new Map(hubDetails.map((w) => [w.shortId, w]));
    const hubs = hubIds
      .filter(([id]) => hubById.has(id))
      .map(([id, citers]) => ({ ...hubById.get(id), citers: citers.length, citerIds: citers }));
    const external = hubs.flatMap((h) => h.citerIds.map((c) => [c, h.shortId]));

    renderNetwork({ nodes, internal, hubs, external });
  } catch (err) {
    networkKey = null;
    networkNote(`Couldn’t build the network (${err.message}).`);
  }
}

function renderNetwork({ nodes, internal, hubs, external }) {
  $('networkInsights').textContent = '';
  const connected = new Set([...internal.flat(), ...external.map(([a]) => a)]);
  const shown = nodes.filter((r) => connected.has(r.matched.shortId)).slice(0, 40);
  $('networkMap').textContent = '';
  if (!shown.length) {
    networkNote('None of your matched references cite each other or share sources, so there is nothing to connect.');
    return;
  }
  const toNode = (r) => ({ shortId: r.matched.shortId, title: r.matched.title, year: r.matched.year, index: r.index, verdict: r.verdict });

  const views = [{
    key: 'full', label: 'With shared foundations', engine: 'graphviz',
    source: buildRelationsDot({
      mine: shown.map(toNode),
      hubs: hubs.map((h) => ({ shortId: h.shortId, title: h.title, year: h.year, citers: h.citers })),
      internal, external,
    }),
  }];
  if (internal.length) {
    const inner = new Set(internal.flat());
    views.push({
      key: 'inner', label: 'Within your list', engine: 'graphviz',
      source: buildRelationsDot({ mine: nodes.filter((r) => inner.has(r.matched.shortId)).map(toNode), internal }),
    });
  }
  renderDiagram($('networkMap'), {
    title: 'Citation network',
    label: `Citation network of ${shown.length} of your references`,
    footer: `${shown.length} references · ${internal.length} internal links · ${hubs.length} shared foundations · outline colour = verdict`,
    views,
  });
}

/* ---------- persistence (last audit survives a reload) ---------- */
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ at: Date.now(), text: $('refInput').value, results: lastResults }));
    $('savedNote').textContent = 'saved in this browser';
  } catch { $('savedNote').textContent = ''; }
}
function restore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { saved = null; }
  if (!saved?.results?.length) return;
  $('refInput').value = saved.text || '';
  lastResults = saved.results;
  setInputSummary(saved.results.length, `restored from ${new Date(saved.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`);
  showInput(false);
  report.hidden = false;
  renderReport({ live: false, total: saved.results.length });
  buildNetwork();
  $('savedNote').textContent = 'saved in this browser';
}

/* ---------- export ---------- */
function correctedList() {
  const lines = [`Corrected reference list, generated by Ukuri (${new Date().toISOString().slice(0, 10)})`, ''];
  for (const r of [...(lastResults || [])].sort((a, b) => a.index - b.index)) {
    if (r.matched && r.verdict !== 'unverifiable' && r.verdict !== 'ghost') {
      const apa = correctedApa(r);
      if (r.verdict === 'retracted') lines.push(`${apa}  [RETRACTED, do not cite]`);
      else if (r.verdict === 'mismatch') lines.push(`${apa}  [corrected from: ${r.ref}]`);
      else lines.push(apa);
    } else {
      lines.push(`${r.ref}  [${r.verdict === 'ghost' ? 'NOT FOUND IN OPENALEX' : 'UNVERIFIED'}]`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function reportCsv() {
  const head = ['#', 'verdict', 'match_score', 'reference', 'note', 'matched_title', 'matched_year', 'matched_doi', 'matched_journal', 'cited_by'];
  const rows = [...(lastResults || [])].sort((a, b) => a.index - b.index).map((r) => [
    r.index + 1, VERDICT[r.verdict]?.label || r.verdict, r.score ?? '', r.ref, r.note || '',
    r.matched?.title || '', r.matched?.year || '', r.matched?.doi || '', r.matched?.journal || '', r.matched?.citedByCount ?? '',
  ]);
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

$('exportTxt').addEventListener('click', () => download('ukuri-corrected-references.txt', correctedList(), 'text/plain;charset=utf-8'));
$('exportCsv').addEventListener('click', () => download('ukuri-audit-report.csv', '﻿' + reportCsv(), 'text/csv;charset=utf-8'));
$('copyCorrected').addEventListener('click', () => {
  navigator.clipboard.writeText(correctedList()).then(() => toast('Corrected list copied')).catch(() => toast('Clipboard blocked'));
});

updateRefCount();
restore();
