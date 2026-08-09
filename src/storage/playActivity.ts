/**
 * Local record of what the player has actually played.
 *
 * Deliberately minimal: a slug and a timestamp. Playtime is not tracked —
 * ordering only needs recency, and a statistic nobody is shown is a feature
 * nobody asked for.
 *
 * The store interface exists so an account-backed implementation can replace
 * the localStorage one without changing any caller.
 */

import { readJson, removeKey, writeJson } from './localStore';

const KEY = 'gbstudio.activity.v1';

/** Beyond this the list stops being "what I was playing" and becomes a log. */
const MAX_ENTRIES = 24;

export interface PlayActivity {
  slug: string;
  lastPlayedAt: number;
}

export interface PlayActivityStore {
  record(slug: string): void;
  recent(limit?: number): PlayActivity[];
  forget(slug: string): void;
  clear(): void;
}

function load(): PlayActivity[] {
  const entries = readJson<PlayActivity[]>(KEY, []);
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(
      (entry): entry is PlayActivity =>
        typeof entry?.slug === 'string' && typeof entry?.lastPlayedAt === 'number',
    )
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

/**
 * Snapshot plumbing for useSyncExternalStore. The cached array must keep the
 * same reference until something actually changes, or React re-renders forever.
 */
const EMPTY: PlayActivity[] = [];
let cache: PlayActivity[] | null = null;
const listeners = new Set<() => void>();

function invalidate(): void {
  cache = null;
  for (const listener of listeners) listener();
}

export function subscribeToActivity(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab writing the same key should update this one too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) invalidate();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function getActivitySnapshot(): PlayActivity[] {
  if (cache === null) cache = load();
  return cache;
}

/** Nothing is known on the server, so the shelf renders nothing there. */
export function getActivityServerSnapshot(): PlayActivity[] {
  return EMPTY;
}

export const playActivity: PlayActivityStore = {
  record(slug) {
    const entries = load().filter((entry) => entry.slug !== slug);
    entries.unshift({ slug, lastPlayedAt: Date.now() });
    writeJson(KEY, entries.slice(0, MAX_ENTRIES));
    invalidate();
  },

  recent(limit = MAX_ENTRIES) {
    return getActivitySnapshot().slice(0, limit);
  },

  forget(slug) {
    writeJson(KEY, load().filter((entry) => entry.slug !== slug));
    invalidate();
  },

  clear() {
    removeKey(KEY);
    invalidate();
  },
};
