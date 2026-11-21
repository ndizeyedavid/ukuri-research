import { toast } from './api.js';
const mounts = document.querySelectorAll('[data-component]');

const mountAll = Promise.all(
  [...mounts].map(async (mount) => {
    const name = mount.dataset.component;
    try {
      const res = await fetch(`/partials/${encodeURIComponent(name)}.html`);
      if (!res.ok) throw new Error(`partial ${name}: ${res.status}`);
      mount.innerHTML = await res.text();
    } catch (err) {
      console.error(`[components] failed to load ${name}`, err);
      mount.innerHTML = '';
    }
  })
);

function wireSidebar() {
  const page = document.body.dataset.page;
  document.querySelectorAll('.nav-item[data-nav]').forEach((item) => {
    if (item.dataset.nav === page) item.classList.add('is-active');
  });
  mountServerStatus();
}

function mountServerStatus() {
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    let actions = topbar.querySelector('.topbar-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'topbar-actions';
      topbar.querySelectorAll(':scope > .topbar-link').forEach((l) => actions.appendChild(l));
      topbar.appendChild(actions);
    }
    const chip = document.createElement('span');
    chip.className = 'served-by';
    chip.dataset.servedBy = '';
    chip.dataset.state = 'pending';
    chip.title = 'Which backend server answered this page';
    chip.innerHTML = '<span class="dot"></span><span class="served-text">connecting…</span>';
    actions.prepend(chip);
  }

  const targets = document.querySelectorAll('[data-served-by]');
  if (!targets.length) return;
  const set = (state, label) => targets.forEach((el) => {
    el.dataset.state = state;
    const t = el.querySelector('.served-text') || el;
    t.textContent = label;
  });
  fetch('/api/whoami')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(({ server }) => set('ok', server && server !== 'local' ? server : 'local'))
    .catch(() => set('error', 'offline'));
}

function updateReadingBadge() {
  const badge = document.getElementById('readingBadge');
  if (!badge) return;
  let n = 0;
  try {
    const raw = localStorage.getItem('ukuri.readinglist.v1');
    const arr = raw ? JSON.parse(raw) : [];
    n = Array.isArray(arr) ? arr.length : 0;
  } catch { /* corrupted list = 0 */ }
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

mountAll.then(() => {
  wireSidebar();
  updateReadingBadge();
  window.addEventListener('ukuri:list-changed', updateReadingBadge);
  window.addEventListener('storage', updateReadingBadge);
});

//  unhandled promise rejections surface as a toast
window.addEventListener('unhandledrejection', (event) => {
  console.error('[ukuri] unhandled rejection:', event.reason);
  toast('Something went wrong. Please try again');
});
