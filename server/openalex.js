const OPENALEX_BASE = 'https://api.openalex.org';
const API_KEY = process.env.OPENALEX_API_KEY || '';
const MAILTO = process.env.MAILTO || '';
const TIMEOUT_MS = 10_000;

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

function pruneCache() {
  if (cache.size <= CACHE_MAX) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].exp - b[1].exp)[0];
  if (oldest) cache.delete(oldest[0]);
}

async function oaFetch(pathWithQuery, { cacheKey } = {}) {
  const key = cacheKey || pathWithQuery;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;

  const url = new URL(`${OPENALEX_BASE}${pathWithQuery}`);
  if (API_KEY) url.searchParams.set('api_key', API_KEY);
  if (MAILTO) url.searchParams.set('mailto', MAILTO);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('OpenAlex timed out');
      e.status = 504;
      throw e;
    }
    const e = new Error('Could not reach OpenAlex');
    e.status = 502;
    throw e;
  } finally {
    clearTimeout(t);
  }

  if (res.status === 429) {
    const e = new Error('OpenAlex rate limit hit');
    e.status = 429;
    e.retryAfter = res.headers.get('retry-after');
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`OpenAlex responded ${res.status}`);
    e.status = res.status >= 500 ? 502 : res.status;
    throw e;
  }

  const data = await res.json();
  cache.set(key, { exp: Date.now() + CACHE_TTL_MS, data });
  pruneCache();
  return data;
}

// ---------- DTO mapping ----------

function mapAuthors(authorships) {
  return (authorships || [])
    .map((a) => a?.author?.display_name)
    .filter(Boolean)
    .slice(0, 20);
}

export function mapWork(w) {
  const biblio = w?.biblio || {};
  const source = w?.primary_location?.source || null;
  const firstPage = biblio.first_page || null;
  const lastPage = biblio.last_page || null;
  return {
    id: w.id || null,
    shortId: (w.id || '').split('/').pop() || null,
    doi: w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//i, '') : null,
    title: w.title || w.display_name || 'Untitled',
    type: w.type || 'unknown',
    year: w.publication_year ?? null,
    pubDate: w.publication_date || null,
    authors: mapAuthors(w.authorships),
    journal: source?.display_name || null,
    volume: biblio.volume || null,
    issue: biblio.issue || null,
    pages: firstPage ? (lastPage && lastPage !== firstPage ? `${firstPage}–${lastPage}` : firstPage) : null,
    citedByCount: w.cited_by_count ?? 0,
    isOA: Boolean(w?.open_access?.is_oa),
    oaUrl: w?.open_access?.oa_url || null,
    isRetracted: Boolean(w?.is_retracted),
    countsByYear: Array.isArray(w?.counts_by_year)
      ? w.counts_by_year.map((c) => ({ year: c.year, citedBy: c.cited_by_count }))
      : [],
    referencedWorks: Array.isArray(w?.referenced_works) ? w.referenced_works.slice(0, 50) : [],
  };
}

// ---------- Queries ----------

const SORTS = {
  relevance: 'relevance_score:desc',
  cited_by_count: 'cited_by_count:desc',
  publication_date: 'publication_date:desc',
};

export async function searchWorks({ q, yearFrom, yearTo, oa, type, sort, page, perPage }) {
  const filters = [];
  if (Number.isInteger(yearFrom) || Number.isInteger(yearTo)) {
    const from = Number.isInteger(yearFrom) ? yearFrom : '';
    const to = Number.isInteger(yearTo) ? yearTo : '';
    if (from || to) filters.push(`publication_year:${from}-${to}`);
  }
  if (oa === true) filters.push('is_oa:true');
  if (type && /^[a-z-]+$/i.test(type)) filters.push(`type:${type.toLowerCase()}`);

  const params = new URLSearchParams();
  params.set('search', q);
  if (filters.length) params.set('filter', filters.join(','));
  params.set('sort', SORTS[sort] || SORTS.relevance);
  params.set('page', String(page));
  params.set('per_page', String(perPage));

  const data = await oaFetch(`/works?${params}`, { cacheKey: params.toString() });
  return {
    results: (data.results || []).map(mapWork),
    total: data?.meta?.count ?? 0,
    page,
    perPage,
  };
}

export async function getWork(idOrDoi) {
  const raw = String(idOrDoi);
  const path = raw.toLowerCase().startsWith('doi:')
    ? `/works/doi:${raw.slice(4).trim()}`
    : `/works/${encodeURIComponent(raw.replace(/^.*\//, ''))}`;
  const w = await oaFetch(path, { cacheKey: path });
  return mapWork(w);
}

export async function searchByTitle(title, { perPage = 5, mode = 'search', year = null } = {}) {
  const params = new URLSearchParams();
  if (mode === 'title') {
    const clean = String(title).replace(/[,|:;()"“”]/g, ' ').replace(/\s+/g, ' ').trim();
    const filters = [`title.search:${clean}`];
    if (year) filters.push(`publication_year:${year - 1}-${year + 1}`);
    params.set('filter', filters.join(','));
    params.set('sort', 'cited_by_count:desc');
  } else {
    params.set('search', title);
  }
  params.set('per_page', String(perPage));
  const data = await oaFetch(`/works?${params}`, { cacheKey: `title:${params}` });
  return (data.results || []).map(mapWork);
}

export function clearCache() { cache.clear(); }

export async function getWorks(ids) {
  const clean = ids.map((i) => encodeURIComponent(String(i).split('/').pop())).filter(Boolean).slice(0, 20);
  if (!clean.length) return [];
  const filter = encodeURIComponent(`ids.openalex:${clean.join('|')}`);
  const select = ['id', 'doi', 'title', 'display_name', 'publication_year', 'cited_by_count', 'authorships', 'primary_location', 'is_retracted', 'referenced_works', 'type', 'open_access'].join(',');
  const data = await oaFetch(`/works?filter=${filter}&select=${select}&per_page=${clean.length}`, { cacheKey: `batch:${clean.join(',')}` });
  return (data.results || []).map(mapWork);
}
