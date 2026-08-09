/**
 * Small typed wrapper over localStorage.
 *
 * Everything the player accumulates locally goes through here rather than
 * touching localStorage from components, so swapping in account-backed
 * persistence later means replacing one module, not auditing the UI.
 *
 * Every read is defensive: storage can be unavailable (blocked cookies,
 * private mode) or hold corrupt JSON, and neither should break the page.
 */

function backing(): Storage | null {
  try {
    // Access itself can throw when storage is blocked.
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const store = backing();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt entry — start clean rather than throwing on every render.
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  const store = backing();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  backing()?.removeItem(key);
}
