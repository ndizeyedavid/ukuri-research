import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchWorks, getWork, getWorks } from './openalex.js';
import { matchReference } from './match.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const SERVER_NAME = process.env.SERVER_NAME || 'local';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, server: SERVER_NAME }));
app.get('/api/whoami', (_req, res) => res.json({ server: SERVER_NAME }));

const clampInt = (v, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const errReply = (res, err) => {
  const status = err?.status && err.status >= 400 ? err.status : 502;
  res.status(status).json({ error: err?.message || 'Upstream error' });
};

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Missing required query parameter: q' });

  const sort = ['relevance', 'cited_by_count', 'publication_date'].includes(req.query.sort) ? req.query.sort : 'relevance';
  const oa = req.query.oa === 'true' ? true : undefined;
  const type = req.query.type ? String(req.query.type).slice(0, 40) : undefined;

  try {
    const data = await searchWorks({
      q,
      yearFrom: clampInt(req.query.year_from, 1500, 2100),
      yearTo: clampInt(req.query.year_to, 1500, 2100),
      oa,
      type,
      sort,
      page: clampInt(req.query.page, 1, 100) ?? 1,
      perPage: clampInt(req.query.per_page, 1, 25) ?? 15,
    });
    res.json(data);
  } catch (err) {
    errReply(res, err);
  }
});

app.get('/api/work/:id', async (req, res) => {
  const raw = String(req.params.id || '').trim().slice(0, 300);
  if (!raw) return res.status(400).json({ error: 'Missing work id' });
  try {
    res.json(await getWork(raw));
  } catch (err) {
    errReply(res, err);
  }
});

app.post('/api/audit-match', async (req, res) => {
  const refs = req.body?.refs;
  if (!Array.isArray(refs) || refs.length === 0) {
    return res.status(400).json({ error: 'Body must be { refs: string[] } with at least one reference' });
  }
  if (refs.length > 100) {
    return res.status(400).json({ error: 'Audit is limited to 100 references per run' });
  }
  const cleaned = refs.map((r) => String(r ?? '').replace(/\s+/g, ' ').trim().slice(0, 3000)).filter((r) => r.length > 0);
  if (!cleaned.length) return res.status(400).json({ error: 'All references were empty' });

  const results = [];
  for (const ref of cleaned) {
    try {
      results.push(await matchReference(ref));
    } catch (err) {
      results.push({ ref, verdict: 'unverifiable', score: null, matched: null, note: `Check failed: ${err.message}` });
    }
    await sleep(120);
  }
  res.json({ results, total: results.length });
});

app.get('/api/works', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter((s) => /^W\d+$/i.test(s.split('/').pop())).slice(0, 20);
  if (!ids.length) return res.status(400).json({ error: 'Provide ids as ?ids=W123,W456 (max 20)' });
  try {
    res.json({ results: await getWorks(ids) });
  } catch (err) {
    errReply(res, err);
  }
});

const KROKI_ENGINES = new Set(['mermaid', 'plantuml', 'graphviz']);
const mindmapCache = new Map();

function sanitizeSvg(svg) {
  return String(svg)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
}

app.post('/api/mindmap', async (req, res) => {
  const { engine, source } = req.body || {};
  if (!KROKI_ENGINES.has(engine)) return res.status(400).json({ error: 'engine must be mermaid | plantuml | graphviz' });
  if (typeof source !== 'string' || !source.trim()) return res.status(400).json({ error: 'source required' });
  if (source.length > 20000) return res.status(400).json({ error: 'Diagram too large (max 20 KB)' });

  const key = crypto.createHash('sha1').update(`${engine}:${source}`).digest('hex');
  const hit = mindmapCache.get(key);
  if (hit && hit.exp > Date.now()) {
    res.set('content-type', 'image/svg+xml; charset=utf-8');
    return res.send(hit.svg);
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let kroki;
  try {
    kroki = await fetch(`https://kroki.io/${engine}/svg`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: source,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(t);
    return res.status(502).json({ error: err.name === 'AbortError' ? 'Kroki timed out. Try again' : 'Could not reach Kroki.io' });
  } finally {
    clearTimeout(t);
  }
  if (!kroki.ok) {
    const detail = (await kroki.text().catch(() => '')).slice(0, 300);
    return res.status(502).json({ error: `Kroki rejected the diagram (${kroki.status}). ${detail}`.trim() });
  }
  const svg = sanitizeSvg(await kroki.text());
  mindmapCache.set(key, { exp: Date.now() + 10 * 60 * 1000, svg });
  res.set('content-type', 'image/svg+xml; charset=utf-8');
  res.send(svg);
});

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/healthz') return next();
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, HOST, () => {
  console.log(`ukuri-research-auditor (${SERVER_NAME}) listening on http://${HOST}:${PORT}`);
});
