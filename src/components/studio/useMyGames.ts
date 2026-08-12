'use client';

/**
 * Which generated games belong to this device.
 *
 * The list lives in localStorage, exactly as saves and recently-played already
 * do. The *games* do not: they live on the server behind a share link, so
 * losing this browser loses the index rather than the content. That is a
 * meaningfully better failure than pure-localStorage, and it is why the pointer
 * exists at all.
 *
 * No accounts. This is the honest cap on the experience and the UI says so once.
 *
 * localStorage is an external store, so it is read through
 * `useSyncExternalStore` rather than copied into state after mount. The server
 * snapshot is empty, which is what the server can actually know, so there is no
 * hydration mismatch — and unlike an effect, a write is visible to every hook
 * instance in the same render rather than one render later.
 */

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'gbstudio.mygames.v1';

const EMPTY: string[] = [];

/** Cached so repeated reads return the same array, as the store contract requires. */
let cachedRaw: string | null = null;
let cachedIds: string[] = EMPTY;

function parse(raw: string | null): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : EMPTY;
  } catch {
    return EMPTY;
  }
}

function snapshot(): string[] {
  const raw = window.localStorage.getItem(KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedIds = parse(raw);
  }
  return cachedIds;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab writing counts too: making a game in one tab should show up in
  // the other, and `storage` is the only event that fires for it.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useMyGames() {
  const ids = useSyncExternalStore(subscribe, snapshot, () => EMPTY);

  const remember = useCallback((id: string) => {
    const current = parse(window.localStorage.getItem(KEY));
    if (current.includes(id)) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify([id, ...current].slice(0, 50)));
    } catch {
      // A full or blocked store costs the index, not the game.
    }
    for (const listener of listeners) listener();
  }, []);

  return { ids, remember };
}
