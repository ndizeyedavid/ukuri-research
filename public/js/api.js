export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'unknown' } = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

export async function apiFetch(path, { timeoutMs = 8000, ...init } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError('That took too long. Check your connection and try again.', { kind: 'timeout' });
    }
    throw new ApiError('Could not reach the server. Is the API running?', { kind: 'network' });
  } finally {
    clearTimeout(t);
  }

  if (res.status === 429) {
    throw new ApiError('Rate limit hit. Cooling down, try again shortly.', { status: 429, kind: 'ratelimit' });
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch {  }
    throw new ApiError(detail || `Server error (${res.status}). Try again in a moment.`, { status: res.status, kind: 'http' });
  }
  try {
    return await res.json();
  } catch {
    throw new ApiError('Unexpected response from the server.', { kind: 'parse' });
  }
}

export function toast(message, { action = null, onAction = null, duration = 4200 } = {}) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  if (action && onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action;
    btn.addEventListener('click', () => { el.remove(); onAction(); });
    el.appendChild(btn);
  }
  wrap.appendChild(el);
  setTimeout(() => el.remove(), action ? Math.max(duration, 6000) : duration);
}
