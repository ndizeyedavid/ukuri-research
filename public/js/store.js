const KEY = 'ukuri.readinglist.v1';

const emit = () => window.dispatchEvent(new CustomEvent('ukuri:list-changed'));

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function getReadingList() {
  return readAll();
}

export function isInReadingList(id) {
  return readAll().some((w) => w.id === id);
}

// Returns true if the work was added, false if it was already present.
export function toggleReadingList(work) {
  const list = readAll();
  const i = list.findIndex((w) => w.id === work.id);
  if (i >= 0) {
    list.splice(i, 1);
    localStorage.setItem(KEY, JSON.stringify(list));
    emit();
    return false;
  }
  list.unshift({ ...work, savedAt: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(list));
  emit();
  return true;
}

export function removeFromReadingList(id) {
  localStorage.setItem(KEY, JSON.stringify(readAll().filter((w) => w.id !== id)));
  emit();
}

// Replace a saved work in place (keeps its position and savedAt).
export function upsertReadingList(work) {
  const list = readAll();
  const i = list.findIndex((w) => w.id === work.id);
  if (i >= 0) list[i] = { ...list[i], ...work, savedAt: list[i].savedAt };
  else list.unshift({ ...work, savedAt: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(list));
  emit();
}

export function restoreToReadingList(items) {
  const list = readAll();
  const have = new Set(list.map((w) => w.id));
  for (const { work, index } of [...items].sort((a, b) => a.index - b.index)) {
    if (have.has(work.id)) continue;
    list.splice(Math.min(index, list.length), 0, work);
  }
  localStorage.setItem(KEY, JSON.stringify(list));
  emit();
}

export function removeManyFromReadingList(ids) {
  const drop = new Set(ids);
  localStorage.setItem(KEY, JSON.stringify(readAll().filter((w) => !drop.has(w.id))));
  emit();
}

export function clearReadingList() {
  localStorage.removeItem(KEY);
  emit();
}

export function readingListCount() {
  return readAll().length;
}
