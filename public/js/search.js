import { apiFetch, toast } from './api.js';
import { toggleReadingList, isInReadingList } from './store.js';

const PER_PAGE = 10;
const state = { page: 1, total: 0, lastQ: null };

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '');
}

function fmtAuthors(authors) {
  if (!authors?.length) return 'Unknown authors';
  if (authors.length <= 3) return authors.join(', ');
  return `${authors.slice(0, 3).join(', ')} et al.`;
}

function buildQuery(page) {
  const p = new URLSearchParams();
  p.set('q', $('q').value.trim());
  const yf = $('yearFrom').value, yt = $('yearTo').value;
  if (yf) p.set('year_from', yf);
  if (yt) p.set('year_to', yt);
  if ($('oa').checked) p.set('oa', 'true');
  if ($('type').value) p.set('type', $('type').value);
  p.set('sort', $('sort').value);
  p.set('page', String(page));
  p.set('per_page', String(PER_PAGE));
  return p;
}

function skeletons(n) {
  return Array.from({ length: n }, () => '<div class="card result-card skeleton" aria-hidden="true"><div class="sk-line w70"></div><div class="sk-line w45"></div><div class="sk-line w55"></div></div>').join('');
}

function renderCards(results) {
  const box = $('results');
  box.textContent = '';
  if (!results.length) {
    box.innerHTML = '<div class="empty-state"><p class="empty-title">No results</p><p>Try broader keywords, fewer filters, or a different spelling. OpenAlex indexes mostly English-language works.</p></div>';
    return;
  }
  for (const w of results) {
    const card = document.createElement('article');
    card.className = 'card result-card';

    const titleA = document.createElement('a');
    titleA.className = 'result-title';
    titleA.href = w.doi ? `https://doi.org/${encodeURI(w.doi)}` : (w.oaUrl || w.id);
    titleA.target = '_blank';
    titleA.rel = 'noopener noreferrer';
    titleA.textContent = w.title;
    card.appendChild(titleA);

    const byline = document.createElement('p');
    byline.className = 'result-authors';
    byline.textContent = `${fmtAuthors(w.authors)} · ${w.year ?? 'n.d.'}`;
    card.appendChild(byline);

    if (w.journal) {
      const j = document.createElement('p');
      j.className = 'result-journal';
      j.textContent = w.journal;
      card.appendChild(j);
    }

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    const cited = document.createElement('span');
    cited.className = 'badge';
    cited.textContent = `${Number(w.citedByCount).toLocaleString()} citations`;
    meta.appendChild(cited);
    const type = document.createElement('span');
    type.className = 'badge';
    type.textContent = w.type;
    meta.appendChild(type);
    if (w.isOA) {
      const oa = document.createElement('a');
      oa.className = 'badge badge-oa';
      oa.textContent = 'Open access';
      oa.href = w.oaUrl || w.id;
      oa.target = '_blank';
      oa.rel = 'noopener noreferrer';
      meta.appendChild(oa);
    }
    if (w.isRetracted) {
      const r = document.createElement('span');
      r.className = 'badge badge-retracted';
      r.textContent = 'Retracted';
      meta.appendChild(r);
    }
    const actions = document.createElement('div');
    actions.className = 'result-actions';
    const cite = document.createElement('a');
    cite.className = 'btn';
    cite.href = `/cite.html?id=${encodeURIComponent(w.shortId || '')}`;
    cite.textContent = 'Cite';
    actions.appendChild(cite);
    const save = document.createElement('button');
    save.className = 'btn';
    save.type = 'button';
    const sync = () => { save.textContent = isInReadingList(w.id) ? 'Saved' : 'Save'; save.setAttribute('aria-pressed', String(isInReadingList(w.id))); };
    sync();
    save.addEventListener('click', () => {
      const added = toggleReadingList(w);
      sync();
      toast(added ? 'Added to reading list' : 'Removed from reading list');
    });
    actions.appendChild(save);
    meta.appendChild(actions);
    card.appendChild(meta);

    box.appendChild(card);
  }
}

function renderPagination() {
  const nav = $('pagination');
  nav.textContent = '';
  const totalPages = Math.min(Math.ceil(state.total / PER_PAGE), 100); // API caps pages
  if (totalPages <= 1) return;

  const mk = (label, page, { disabled = false, current = false } = {}) => {
    const b = document.createElement('button');
    b.className = 'btn page-btn' + (current ? ' is-current' : '');
    b.textContent = label;
    b.disabled = disabled;
    b.setAttribute('aria-label', typeof label === 'string' && label.startsWith('‹') ? 'Previous page' : typeof label === 'string' && label.startsWith('›') ? 'Next page' : `Page ${label}`);
    if (current) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => { state.page = page; doSearch(); $('searchPage').scrollTo({ top: 0, behavior: 'smooth' }); });
    nav.appendChild(b);
  };

  mk('‹ Prev', state.page - 1, { disabled: state.page <= 1 });
  const start = Math.max(1, Math.min(state.page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p++) mk(String(p), p, { current: p === state.page });
  mk('Next ›', state.page + 1, { disabled: state.page >= totalPages });
}

async function doSearch() {
  const meta = $('resultsMeta');
  const box = $('results');
  const params = buildQuery(state.page);
  meta.textContent = '';
  $('pagination').textContent = '';
  box.innerHTML = skeletons(4);

  try {
    const data = await apiFetch(`/api/search?${params}`);
    state.total = data.total;
    const from = (data.page - 1) * data.perPage + 1;
    const to = Math.min(data.total, data.page * data.perPage);
    meta.textContent = data.total ? `${data.total.toLocaleString()} results · ${from}–${to}` : '';
    renderCards(data.results);
    renderPagination();
  } catch (err) {
    box.textContent = '';
    const div = document.createElement('div');
    div.className = 'empty-state error-box';
    const h = document.createElement('h3');
    h.className = 'empty-title';
    h.textContent = 'Something went wrong';
    const p = document.createElement('p');
    p.textContent = err.message;
    const retry = document.createElement('button');
    retry.className = 'btn btn-primary';
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', doSearch);
    div.append(h, p, retry);
    box.appendChild(div);
  }
}

// ---------- Idle <=> results state ----------
const page = $('searchPage');

function setState(next) {
  if (page.dataset.state === next) return;
  const apply = () => {
    page.dataset.state = next;
    document.body.dataset.searchState = next;
    $('newSearch').hidden = next !== 'results';
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce) document.startViewTransition(apply);
  else apply();
}

function syncUrl() {
  const url = new URL(location.href);
  if (state.lastQ) url.searchParams.set('q', state.lastQ);
  else url.searchParams.delete('q');
  history.replaceState(null, '', url);
}

function submit() {
  const q = $('q').value.trim();
  if (!q) return;
  state.page = 1;
  state.lastQ = q;
  syncUrl();
  setState('results');
  doSearch();
}

function reset() {
  state.lastQ = null;
  state.total = 0;
  $('q').value = '';
  $('results').textContent = '';
  $('resultsMeta').textContent = '';
  $('pagination').textContent = '';
  syncUrl();
  setState('idle');
  $('q').focus();
}

$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submit();
});

['yearFrom', 'yearTo', 'type', 'sort', 'oa'].forEach((id) => {
  $(id).addEventListener('change', () => { if (state.lastQ) submit(); });
});

$('suggestions').addEventListener('click', (e) => {
  const btn = e.target.closest('.suggestion');
  if (!btn) return;
  $('q').value = btn.dataset.q;
  submit();
});

$('newSearch').addEventListener('click', reset);

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select, [contenteditable]');
  if (e.key === '/' && !typing) { e.preventDefault(); $('q').focus(); $('q').select(); }
  if (e.key === 'Escape' && e.target === $('q') && state.lastQ) reset();
});

const initialQ = new URLSearchParams(location.search).get('q');
if (initialQ) {
  $('q').value = initialQ.slice(0, 200);
  state.lastQ = $('q').value.trim();
  page.dataset.state = 'results';
  document.body.dataset.searchState = 'results';
  $('newSearch').hidden = false;
  doSearch();
}
