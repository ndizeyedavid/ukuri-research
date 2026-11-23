import { toast } from './api.js';
import { getReadingList, removeManyFromReadingList, restoreToReadingList } from './store.js';
import { renderCitationMap } from './citation-map.js';
import { authorList, surname, doiUrl, apaOf, toBibtex, toRis, toCsv, toApaTxt, download } from './formats.js';

const $ = (id) => document.getElementById(id);

const view = { q: '', filter: 'all', sort: 'saved', selected: new Set() };

/* ---------- helpers ---------- */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString([], { dateStyle: 'medium' });
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function haystack(w) {
  return [w.title, authorList(w).join(' '), w.journal, w.year, w.doi].join(' ').toLowerCase();
}

function visible(list) {
  const q = view.q.trim().toLowerCase();
  let rows = list.map((w, i) => ({ w, i }));
  if (q) rows = rows.filter(({ w }) => q.split(/\s+/).every((t) => haystack(w).includes(t)));
  if (view.filter === 'oa') rows = rows.filter(({ w }) => w.isOA);
  if (view.filter === 'retracted') rows = rows.filter(({ w }) => w.isRetracted);
  if (view.filter === 'nodoi') rows = rows.filter(({ w }) => !w.doi);
  const by = {
    saved: (a, b) => a.i - b.i,
    author: (a, b) => surname(authorList(a.w)[0]).localeCompare(surname(authorList(b.w)[0])) || a.i - b.i,
    newest: (a, b) => (b.w.year || 0) - (a.w.year || 0) || a.i - b.i,
    oldest: (a, b) => (a.w.year || 9999) - (b.w.year || 9999) || a.i - b.i,
    cited: (a, b) => (b.w.citedByCount || 0) - (a.w.citedByCount || 0) || a.i - b.i,
  }[view.sort];
  return rows.sort(by).map(({ w }) => w);
}

/* ---------- render ---------- */
function render() {
  const list = getReadingList();
  const ids = new Set(list.map((w) => w.id));
  for (const id of [...view.selected]) if (!ids.has(id)) view.selected.delete(id);

  const has = list.length > 0;
  $('listStats').hidden = !has;
  $('listTools').hidden = !has;
  $('selectBar').hidden = !has;
  if (!has) { $('mapCard').hidden = true; mapOpen = false; }

  renderStats(list);
  renderFilters(list);

  const box = $('readingList');
  box.textContent = '';
  if (!has) {
    box.innerHTML = '<div class="empty-state"><p class="empty-title">Nothing saved yet</p><p>Hit <span class="kbd-inline">Save</span> on any search result or in the citation builder and references collect here.</p><a class="btn" href="/">Search papers</a></div>';
    syncSelectBar([]);
    return;
  }

  const rows = visible(list);
  if (!rows.length) {
    box.appendChild(el('p', 'verdicts-empty', 'No saved references match this filter.'));
  }
  for (const w of rows) box.appendChild(renderRow(w));
  syncSelectBar(rows);
}

function renderStats(list) {
  const stats = $('listStats');
  stats.textContent = '';
  if (!list.length) return;
  const years = list.map((w) => Number(w.year)).filter(Boolean);
  const cites = list.reduce((s, w) => s + (Number(w.citedByCount) || 0), 0);
  const oa = list.filter((w) => w.isOA).length;
  const items = [
    [String(list.length), list.length === 1 ? 'reference' : 'references'],
    [years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`) : 'n/a', 'years'],
    [cites.toLocaleString(), 'total citations'],
    [`${Math.round((oa / list.length) * 100)}%`, 'open access'],
  ];
  for (const [num, label] of items) {
    const s = el('div', 'stat');
    s.append(el('span', 'stat-num', num), el('span', 'stat-label', label));
    stats.appendChild(s);
  }

  const retracted = list.filter((w) => w.isRetracted);
  const notice = $('retractedNotice');
  notice.hidden = !retracted.length;
  if (retracted.length) {
    notice.textContent = '';
    notice.append(
      el('strong', null, `${plural(retracted.length, 'saved paper')} ${retracted.length === 1 ? 'has' : 'have'} been retracted.`),
      document.createTextNode(' Don’t cite retracted work without saying so. '),
    );
    const show = el('button', 'notice-link', 'Show');
    show.type = 'button';
    show.addEventListener('click', () => { view.filter = 'retracted'; render(); });
    notice.appendChild(show);
  }
}

function renderFilters(list) {
  const box = $('listFilters');
  box.textContent = '';
  const defs = [
    ['all', 'All', list.length],
    ['oa', 'Open access', list.filter((w) => w.isOA).length],
    ['nodoi', 'No DOI', list.filter((w) => !w.doi).length],
    ['retracted', 'Retracted', list.filter((w) => w.isRetracted).length],
  ];
  if (view.filter !== 'all' && !defs.find(([k, , n]) => k === view.filter && n)) view.filter = 'all';
  for (const [key, label, n] of defs) {
    if (key !== 'all' && !n) continue;
    const b = el('button', `filter-btn${key === 'retracted' ? ' v-retracted' : key === 'oa' ? ' v-valid' : ''}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(view.filter === key));
    b.append(el('span', 'filter-label', label), el('span', 'filter-count', String(n)));
    b.addEventListener('click', () => { view.filter = key; render(); });
    box.appendChild(b);
  }
}

function renderRow(w) {
  const row = el('article', 'saved-row');
  if (view.selected.has(w.id)) row.classList.add('is-selected');

  const check = el('label', 'check saved-check');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = view.selected.has(w.id);
  cb.setAttribute('aria-label', `Select ${w.title || 'reference'}`);
  cb.addEventListener('change', () => {
    if (cb.checked) view.selected.add(w.id); else view.selected.delete(w.id);
    row.classList.toggle('is-selected', cb.checked);
    syncSelectBar(visible(getReadingList()));
  });
  check.appendChild(cb);

  const main = el('div', 'saved-main');
  main.appendChild(el('p', 'list-apa', apaOf(w)));

  const meta = el('div', 'result-meta');
  if (w.citedByCount != null && w.type !== 'manual') meta.appendChild(el('span', 'badge', `${Number(w.citedByCount || 0).toLocaleString()} citations`));
  if (w.type === 'manual') meta.appendChild(el('span', 'badge', 'entered by hand'));
  if (w.isOA) {
    const oa = el('a', 'badge badge-oa', 'Open access ↗');
    oa.href = w.oaUrl || doiUrl(w) || '#';
    oa.target = '_blank'; oa.rel = 'noopener noreferrer';
    meta.appendChild(oa);
  }
  if (w.isRetracted) meta.appendChild(el('span', 'badge badge-retracted', 'Retracted'));
  if (!w.doi) meta.appendChild(el('span', 'badge', 'no DOI'));
  if (w.savedAt) meta.appendChild(el('span', 'saved-when', `saved ${ago(w.savedAt)}`));

  const actions = el('div', 'result-actions');
  const copy = el('button', 'btn', 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', () => navigator.clipboard.writeText(apaOf(w)).then(() => toast('Copied APA 7')).catch(() => toast('Clipboard blocked')));
  actions.appendChild(copy);
  if (doiUrl(w)) {
    const open = el('a', 'btn', 'DOI ↗');
    open.href = doiUrl(w); open.target = '_blank'; open.rel = 'noopener noreferrer';
    actions.appendChild(open);
  }
  if (w.shortId) {
    const cite = el('a', 'btn', 'Cite');
    cite.href = `/cite.html?id=${encodeURIComponent(w.shortId)}`;
    actions.appendChild(cite);
  }
  const remove = el('button', 'btn', 'Remove');
  remove.type = 'button';
  remove.addEventListener('click', () => removeWithUndo([w.id]));
  actions.appendChild(remove);
  meta.appendChild(actions);
  main.appendChild(meta);

  row.append(check, main);
  return row;
}

/* ---------- selection ---------- */
// Bulk actions apply to the selection, or to everything visible when nothing is selected.
function targets() {
  const rows = visible(getReadingList());
  const sel = rows.filter((w) => view.selected.has(w.id));
  return sel.length ? sel : rows;
}

function syncSelectBar(rows) {
  const selVisible = rows.filter((w) => view.selected.has(w.id)).length;
  const all = $('selectAll');
  all.checked = rows.length > 0 && selVisible === rows.length;
  all.indeterminate = selVisible > 0 && selVisible < rows.length;
  $('selectLabel').textContent = selVisible ? `${selVisible} selected` : `Select all ${rows.length}`;
  const scope = selVisible ? ` ${selVisible}` : ' all';
  $('copySel').textContent = `Copy${scope}`;
  $('exportBtn').textContent = `Export${scope}`;
  $('removeSel').textContent = `Remove${scope}`;
  $('removeSel').hidden = !selVisible; // never offer "remove all" by accident
  $('selectBar').classList.toggle('has-selection', selVisible > 0);
}

$('selectAll').addEventListener('change', (e) => {
  const rows = visible(getReadingList());
  for (const w of rows) { if (e.target.checked) view.selected.add(w.id); else view.selected.delete(w.id); }
  render();
});

function removeWithUndo(ids) {
  const list = getReadingList();
  const items = list.map((work, index) => ({ work, index })).filter(({ work }) => ids.includes(work.id));
  if (!items.length) return;
  removeManyFromReadingList(ids);
  ids.forEach((id) => view.selected.delete(id));
  render();
  toast(items.length === 1 ? 'Removed from reading list' : `Removed ${items.length} references`, {
    action: 'Undo',
    onAction: () => { restoreToReadingList(items); render(); toast('Restored'); },
  });
}

$('removeSel').addEventListener('click', () => removeWithUndo(targets().map((w) => w.id)));

$('copySel').addEventListener('click', () => {
  const t = targets();
  const text = t.map(apaOf).sort((a, b) => a.localeCompare(b)).join('\n\n');
  navigator.clipboard.writeText(text).then(() => toast(`Copied ${plural(t.length, 'reference')} (APA 7, alphabetical)`)).catch(() => toast('Clipboard blocked'));
});

/* ---------- export ---------- */
const FORMATS = {
  txt: ['ukuri-references.txt', toApaTxt, 'text/plain;charset=utf-8'],
  bib: ['ukuri-references.bib', toBibtex, 'application/x-bibtex;charset=utf-8'],
  ris: ['ukuri-references.ris', toRis, 'application/x-research-info-systems;charset=utf-8'],
  csv: ['ukuri-references.csv', toCsv, 'text/csv;charset=utf-8'],
};

const menu = $('exportMenu'), exportBtn = $('exportBtn');
function setMenu(open) { menu.hidden = !open; exportBtn.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('button').focus(); }
exportBtn.addEventListener('click', () => setMenu(menu.hidden));
menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fmt]');
  if (!b) return;
  const [name, fn, type] = FORMATS[b.dataset.fmt];
  const t = targets();
  download(name, fn(t), type);
  setMenu(false);
  toast(`Exported ${plural(t.length, 'reference')}`);
});
document.addEventListener('click', (e) => { if (!e.target.closest('.export-menu')) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); exportBtn.focus(); } });

/* ---------- search / filter / sort ---------- */
let qTimer = null;
$('listQuery').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { view.q = e.target.value; render(); }, 120); });
$('listSort').addEventListener('change', (e) => { view.sort = e.target.value; render(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest('input, textarea, select')) { e.preventDefault(); $('listQuery').focus(); }
});

/* ---------- citation map (works on the current view) ---------- */
let mapOpen = false;
$('mapToggle').addEventListener('click', () => {
  const card = $('mapCard');
  mapOpen = !mapOpen;
  $('mapToggle').setAttribute('aria-expanded', String(mapOpen));
  card.hidden = !mapOpen;
  if (!mapOpen) return;
  const works = targets()
    .map((w) => ({
      shortId: w.shortId || String(w.id || '').split('/').pop(),
      title: w.title, year: w.year, citedByCount: w.citedByCount,
      refIds: (w.referencedWorks || []).map((u) => String(u).split('/').pop()),
    }))
    .filter((w) => /^W\d+$/i.test(w.shortId || ''));
  if (works.length < 2) {
    card.hidden = true; mapOpen = false; $('mapToggle').setAttribute('aria-expanded', 'false');
    toast('Need at least 2 OpenAlex papers in view to draw a map');
    return;
  }
  renderCitationMap($('citationMap'), { rootLabel: `Reading list - ${works.length} papers`, works });
});

window.addEventListener('storage', (e) => { if (e.key === 'ukuri.readinglist.v1') render(); });

render();
