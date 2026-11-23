// Shared "citation map" widget: toggles between a Kroki-rendered mermaid mindmap
// and a Kroki-rendered graphviz web of the included works, inside a pan/zoom viewport.
import { buildMindmapSource, buildDotSource, computeEdges } from './map.js';

const MIN = 0.2, MAX = 6, STEP = 1.25;

// Font Awesome classes for the map controls (stylesheet loaded on every page)
const ICONS = {
  minus: 'fa-solid fa-minus',
  plus: 'fa-solid fa-plus',
  fit: 'fa-solid fa-arrows-to-dot',
  full: 'fa-solid fa-expand',
  exitFull: 'fa-solid fa-compress',
  download: 'fa-solid fa-download',
};

function iconBtn(icon, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'map-ctrl';
  b.innerHTML = `<i class="${ICONS[icon]}" aria-hidden="true"></i>`;
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}

// Pan/zoom controller for one viewport + one canvas child.
function createViewport(viewport, canvas, onChange) {
  const s = { scale: 1, x: 0, y: 0, natW: 0, natH: 0 };
  const apply = () => {
    canvas.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
    onChange(s.scale);
  };
  const clamp = (v) => Math.min(MAX, Math.max(MIN, v));

  function zoomAt(next, px, py) {
    next = clamp(next);
    s.x = px - (px - s.x) * (next / s.scale);
    s.y = py - (py - s.y) * (next / s.scale);
    s.scale = next;
    apply();
  }
  const center = () => [viewport.clientWidth / 2, viewport.clientHeight / 2];

  function fit() {
    if (!s.natW || !s.natH) return;
    const pad = 24;
    const sc = clamp(Math.min((viewport.clientWidth - pad) / s.natW, (viewport.clientHeight - pad) / s.natH, 1.5));
    s.scale = sc;
    s.x = (viewport.clientWidth - s.natW * sc) / 2;
    s.y = (viewport.clientHeight - s.natH * sc) / 2;
    apply();
  }

  function measure() {
    const svg = canvas.querySelector('svg');
    if (!svg) { s.natW = s.natH = 0; return; }
    const vb = svg.viewBox?.baseVal;
    const aw = svg.getAttribute('width') || '', ah = svg.getAttribute('height') || '';
    const abs = (v) => v && !/%$/.test(v) ? parseFloat(v) : 0; // ignore "100%" (mermaid)
    let w = abs(aw), h = abs(ah);
    if (/pt$/.test(aw)) { w *= 4 / 3; h *= 4 / 3; }
    if ((!w || !h) && vb && vb.width && vb.height) { w = vb.width; h = vb.height; }
    svg.style.maxWidth = 'none';
    if (!w || !h) { const r = svg.getBoundingClientRect(); w = r.width / s.scale; h = r.height / s.scale; }
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    s.natW = w; s.natH = h;
  }

  // ctrl/⌘ + wheel or trackpad pinch zooms; plain wheel keeps scrolling the page
  viewport.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(s.scale * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // drag to pan, two pointers to pinch
  const pts = new Map();
  let pinch = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('a')) return;
    viewport.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.classList.add('is-dragging');
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: s.scale };
    }
  });
  viewport.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const r = viewport.getBoundingClientRect();
      zoomAt(pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    s.x += e.clientX - prev.x;
    s.y += e.clientY - prev.y;
    apply();
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) viewport.classList.remove('is-dragging');
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);

  viewport.addEventListener('dblclick', (e) => {
    const r = viewport.getBoundingClientRect();
    zoomAt(s.scale * (e.shiftKey ? 1 / 1.6 : 1.6), e.clientX - r.left, e.clientY - r.top);
  });

  viewport.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === '+' || k === '=') { e.preventDefault(); zoomAt(s.scale * STEP, ...center()); }
    else if (k === '-' || k === '_') { e.preventDefault(); zoomAt(s.scale / STEP, ...center()); }
    else if (k === '0') { e.preventDefault(); fit(); }
    else if (k.startsWith('Arrow')) {
      e.preventDefault();
      const d = 40;
      if (k === 'ArrowLeft') s.x += d; if (k === 'ArrowRight') s.x -= d;
      if (k === 'ArrowUp') s.y += d; if (k === 'ArrowDown') s.y -= d;
      apply();
    }
  });

  new ResizeObserver(() => { if (s.natW) fit(); }).observe(viewport);

  return {
    zoomIn: () => zoomAt(s.scale * STEP, ...center()),
    zoomOut: () => zoomAt(s.scale / STEP, ...center()),
    fit,
    load() { s.scale = 1; s.x = 0; s.y = 0; apply(); measure(); fit(); },
  };
}

// renderCitationMap(container, { rootLabel, rootId, works })
// works: [{ shortId, title, year, citedByCount, refIds: [short ids] }]
// If rootId is given, root fan-out edges are included in the web view.
export function renderCitationMap(container, { rootLabel, rootId = null, works }) {
  const included = works.slice(0, 20);
  const edges = computeEdges(included, { rootId });
  const interEdges = edges.filter(([a]) => a !== rootId);
  renderDiagram(container, {
    title: 'Citation map',
    label: `Citation map of ${included.length} works`,
    footer: `${included.length} works · ${interEdges.length} internal citations`,
    views: [
      { key: 'mindmap', label: 'Mindmap', engine: 'mermaid', source: buildMindmapSource(rootLabel, rootId ? included.filter((w) => w.shortId !== rootId) : included) },
      { key: 'web', label: 'Web', engine: 'graphviz', source: buildDotSource(included, edges, { rootId }) },
    ],
  });
}

// Generic Kroki diagram with tabs + pan/zoom viewport.
// views: [{ key, label, engine: 'mermaid'|'graphviz', source }]
export function renderDiagram(container, { title, label, footer, views }) {
  container.textContent = '';

  const head = document.createElement('div');
  head.className = 'map-head';
  const heading = document.createElement('p');
  heading.className = 'preview-label';
  heading.textContent = title;
  const tabs = document.createElement('div');
  tabs.className = 'map-tabs';
  const tabBtns = views.map((v, i) => {
    const b = document.createElement('button');
    b.className = `tab${i === 0 ? ' is-active' : ''}`; b.type = 'button'; b.textContent = v.label;
    b.addEventListener('click', () => show(v.key));
    tabs.appendChild(b);
    return b;
  });
  if (views.length < 2) tabs.hidden = true;
  head.append(heading, tabs);

  const viewport = document.createElement('div');
  viewport.className = 'map-body map-viewport';
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'img');
  viewport.setAttribute('aria-label', `${label}. Use plus and minus to zoom, arrow keys to pan, 0 to fit.`);
  const canvas = document.createElement('div');
  canvas.className = 'map-canvas';
  const status = document.createElement('p');
  status.className = 'muted map-loading';
  viewport.append(canvas, status);

  const controls = document.createElement('div');
  controls.className = 'map-controls';
  const bOut = iconBtn('minus', 'Zoom out');
  const level = document.createElement('button');
  level.type = 'button';
  level.className = 'map-level';
  level.title = 'Reset to fit';
  level.textContent = '100%';
  const bIn = iconBtn('plus', 'Zoom in');
  const bFit = iconBtn('fit', 'Fit to view');
  const bFull = iconBtn('full', 'Full screen');
  const bDl = iconBtn('download', 'Download SVG');
  const sep = document.createElement('span');
  sep.className = 'map-ctrl-sep';
  controls.append(bOut, level, bIn, sep, bFit, bFull, bDl);
  viewport.appendChild(controls);

  const foot = document.createElement('p');
  foot.className = 'map-foot';
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  foot.textContent = `${footer} · drag to pan · ${isMac ? '⌘' : 'Ctrl'} + scroll or double-click to zoom · rendered by Kroki.io`;

  container.append(head, viewport, foot);

  const vp = createViewport(viewport, canvas, (sc) => { level.textContent = `${Math.round(sc * 100)}%`; });
  bIn.addEventListener('click', vp.zoomIn);
  bOut.addEventListener('click', vp.zoomOut);
  bFit.addEventListener('click', vp.fit);
  level.addEventListener('click', vp.fit);
  for (const b of [bIn, bOut, bFit, bFull, bDl, level]) b.addEventListener('pointerdown', (e) => e.stopPropagation());

  const card = container.closest('.map-card') || container;
  bFull.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else card.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === card;
    card.classList.toggle('is-fullscreen', on);
    bFull.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    bFull.querySelector('i').className = on ? ICONS.exitFull : ICONS.full;
    bFull.title = bFull.getAttribute('aria-label');
    requestAnimationFrame(vp.fit);
  });

  const sources = Object.fromEntries(views.map((v) => [v.key, [v.engine, v.source]]));
  const cache = {};
  let current = views[0].key;

  bDl.addEventListener('click', () => {
    if (!cache[current]) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([cache[current]], { type: 'image/svg+xml' }));
    a.download = `ukuri-${String(title).toLowerCase().replace(/\W+/g, '-')}-${current}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  });

  function setStatus(text) {
    status.textContent = text || '';
    status.hidden = !text;
    controls.hidden = !!text;
  }

  function mount(svg) {
    canvas.innerHTML = svg;
    setStatus('');
    vp.load();
  }

  async function show(which) {
    current = which;
    views.forEach((v, i) => tabBtns[i].classList.toggle('is-active', v.key === which));
    if (cache[which]) { mount(cache[which]); return; }
    canvas.innerHTML = '';
    setStatus('Drawing the map with Kroki.io…');
    const [engine, source] = sources[which];
    try {
      const res = await fetch('/api/mindmap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ engine, source }),
      });
      if (current !== which) return;
      if (!res.ok) {
        let msg = `Map failed (${res.status})`;
        try { msg = (await res.json()).error || msg; } catch { /* svg error body */ }
        setStatus(`${msg}. Try the other view.`);
        return;
      }
      const svg = await res.text();
      cache[which] = svg;
      if (current === which) mount(svg);
    } catch {
      if (current === which) setStatus('Could not reach Kroki.io. Check your connection.');
    }
  }

  show(current);
}
