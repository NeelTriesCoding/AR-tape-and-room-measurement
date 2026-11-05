// Measurement history. Entries live in localStorage; photos and sketches live in IndexedDB.
const KEY = 'tl.history';

export function listEntries() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
export function addEntry(e) {
  const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), ...e };
  const list = listEntries();
  list.unshift(entry);
  if (!write(list)) throw new Error('Storage is full or blocked');
  return entry;
}
export function updateEntry(id, patch) {
  const list = listEntries().map(e => (e.id === id ? { ...e, ...patch } : e));
  write(list);
}
export function removeEntry(id) {
  write(listEntries().filter(e => e.id !== id));
  deleteImage(id).catch(() => {});
}
export function clearEntries() {
  listEntries().forEach(e => deleteImage(e.id).catch(() => {}));
  write([]);
}

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('tapeline', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('images');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('images', mode);
    const req = fn(t.objectStore('images'));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
export const putImage = (id, blob) => tx('readwrite', s => s.put(blob, id));
export const getImage = id => tx('readonly', s => s.get(id));
export const deleteImage = id => tx('readwrite', s => s.delete(id));
