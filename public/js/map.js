
export const shortId = (id) => String(id || '').split('/').pop();

export function shorten(s, n = 54) {
  const t = String(s || 'Untitled').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}


const mmLabel = (s) =>
  String(s || '')
    .replace(/["()\[\]{}]/g, ' ')
    .replace(/[^\x20-\x7EÀ-ÿ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'untitled';

const dotLabel = (s) => String(s || '').replace(/["]/g, "'").replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7EÀ-ÿ]/g, '').slice(0, 80);

// included: [{ shortId, title, year, citedByCount, refIds (short ids) }]
// edges:    [[fromShortId, toShortId], ...]
export function buildMindmapSource(rootLabel, included) {
  const lines = ['mindmap', `  root(("${mmLabel(rootLabel)}"))`];
  for (const w of included.slice(0, 16)) {
    const y = w.year || 'n.d.';
    lines.push(`    "${mmLabel(shorten(w.title, 56))} - ${y}"`);
  }
  return lines.join('\n');
}

export function buildDotSource(included, edges, { rootId = null } = {}) {
  const lines = [
    'digraph citation_map {',
    '  rankdir=LR; bgcolor="transparent"; pad="0.25";',
    '  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=10, color="#dcdcd8", fillcolor="#ffffff"];',
    '  edge [color="#b4441c", penwidth=1.2, arrowsize=0.7];',
  ];
  for (const w of included.slice(0, 20)) {
    const isRoot = rootId && w.shortId === rootId;
    const fill = isRoot ? '#b4441c' : '#ffffff';
    const font = isRoot ? '#ffffff' : '#1c1c1a';
    const label = `${dotLabel(shorten(w.title, 72))}\\n${w.year || 'n.d.'} · ${Number(w.citedByCount || 0).toLocaleString()} cites`;
    lines.push(`  "${w.shortId}" [label="${label}", fillcolor="${fill}", fontcolor="${font}"];`);
  }
  for (const [a, b] of edges) {
    lines.push(`  "${a}" -> "${b}";`);
  }
  lines.push('}');
  return lines.join('\n');
}

// Compute citation edges among the included set (+ optional root star).
export function computeEdges(included, { rootId = null, limit = 60 } = {}) {
  const set = new Set(included.map((w) => w.shortId));
  const edges = [];
  for (const w of included) {
    for (const ref of w.refIds || []) {
      const r = shortId(ref);
      if (set.has(r) && r !== w.shortId) edges.push([w.shortId, r]);
      if (edges.length >= limit) return edges;
    }
  }
  if (rootId) {
    // Root fan-out to each included reference (mindmap web flavour)
    for (const w of included) {
      if (w.shortId !== rootId && edges.length < limit) edges.push([rootId, w.shortId]);
    }
  }
  return edges;
}

const VERDICT_STROKE = { valid: '#15803d', mismatch: '#b45309', retracted: '#b91c1c', ghost: '#6d28d9', unverifiable: '#a1a19b' };
export function buildRelationsDot({ mine, hubs = [], internal = [], external = [] }) {
  const lines = [
    'digraph citation_network {',
    '  rankdir=LR; bgcolor="transparent"; pad="0.3"; nodesep="0.25"; ranksep="0.9";',
    '  node [fontname="Helvetica", fontsize=10];',
  ];
  lines.push('  subgraph cluster_mine { label="Your references"; fontname="Helvetica"; fontsize=10; fontcolor="#6b6b66"; style="rounded,dashed"; color="#d4d4d0";');
  for (const w of mine) {
    const label = `${String(w.index + 1).padStart(2, '0')}  ${dotLabel(shorten(w.title, 60))}\\n${w.year || 'n.d.'}`;
    const stroke = VERDICT_STROKE[w.verdict] || '#d4d4d0';
    lines.push(`    "${w.shortId}" [shape=box, style="rounded,filled", fillcolor="#ffffff", color="${stroke}", penwidth=1.4, fontcolor="#1a1a18", label="${label}"];`);
  }
  lines.push('  }');
  for (const h of hubs) {
    const label = `${dotLabel(shorten(h.title, 56))}\\n${h.year || 'n.d.'} · cited by ${h.citers} of yours`;
    lines.push(`  "${h.shortId}" [shape=box, style="rounded,filled,dashed", fillcolor="#fbf1ec", color="#efd3c6", fontcolor="#933617", label="${label}"];`);
  }
  for (const [a, b] of internal) lines.push(`  "${a}" -> "${b}" [color="#b4441c", penwidth=1.5, arrowsize=0.7];`);
  for (const [a, b] of external) lines.push(`  "${a}" -> "${b}" [color="#c9c9c4", style=dashed, arrowsize=0.6];`);
  lines.push('}');
  return lines.join('\n');
}
