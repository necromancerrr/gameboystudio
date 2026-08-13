/**
 * Battery-save persistence.
 *
 * Console-agnostic on purpose: a save is an opaque byte array keyed by game.
 *
 * Two backends, chosen by size rather than by console:
 *
 * - **localStorage** for Game Boy. Saves are 2-32KB, the API is synchronous,
 *   and everything that reads them today expects that. Unchanged.
 * - **IndexedDB** for anything larger, which in practice means Game Boy
 *   Advance. GBA saves reach 128KB of SRAM, Flash or EEPROM; base64 inflates
 *   that by a third, and localStorage gives an origin roughly 5MB in total for
 *   every game combined. A handful of GBA games would fill it, and the write
 *   would then fail at the exact moment a player's progress is being stored.
 *
 * `hasSave` stays synchronous either way, because the Continue shelf asks it
 * during render. IndexedDB writes leave a small marker in localStorage so that
 * question can still be answered without awaiting anything.
 */

const PREFIX = 'gbstudio.save.v1.';
/** Marks that an IndexedDB save exists, so `hasSave` can stay synchronous. */
const MARKER_PREFIX = 'gbstudio.save.idb.v1.';

const DB_NAME = 'gbstudio.saves';
const DB_VERSION = 1;
const STORE = 'saves';

export type SaveWriteResult =
  | { ok: true }
  | { ok: false; reason: 'quota' | 'unavailable' };

function storage(): Storage | null {
  try {
    // Access can throw outright when cookies/storage are blocked.
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large save can't blow the argument limit on String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function readSave(key: string): Uint8Array | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return null;
    const bytes = fromBase64(raw);
    return bytes.length > 0 ? bytes : null;
  } catch {
    // Corrupt entry — better to start fresh than to fail the whole page.
    return null;
  }
}

export function writeSave(key: string, data: Uint8Array): SaveWriteResult {
  const store = storage();
  if (!store) return { ok: false, reason: 'unavailable' };
  try {
    store.setItem(PREFIX + key, toBase64(data));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'quota' };
  }
}

export function clearSave(key: string): void {
  const store = storage();
  store?.removeItem(PREFIX + key);
  store?.removeItem(MARKER_PREFIX + key);
  void withStore('readwrite', (idb) => idb.delete(key));
}

/**
 * Whether real saved progress exists — not whether the cartridge *could* save.
 * A battery-backed game the player opened briefly has no save yet, and telling
 * them "Continue" in that case would be a lie.
 *
 * Checks for the key without decoding it; saves reach 128K and this runs for
 * every entry in the Continue shelf.
 */
export function hasSave(key: string): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const raw = store.getItem(PREFIX + key);
    if (typeof raw === 'string' && raw.length > 0) return true;
    return store.getItem(MARKER_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- */
/* IndexedDB, for saves too large to sit in localStorage                      */
/* ------------------------------------------------------------------------- */

/**
 * Above this, a save goes to IndexedDB. Comfortably above every Game Boy
 * cartridge (32KB is the largest in the catalog) and below every GBA one.
 */
const LARGE_SAVE_BYTES = 64 * 1024;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Private-browsing modes can throw here rather than report an error.
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

/**
 * Every IndexedDB path resolves rather than rejects. A save store that throws
 * would take down the player; one that returns null degrades to "no save",
 * which is the same thing a first-time player sees.
 */
function withStore<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const request = body(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/**
 * Reads a save from whichever backend holds it.
 *
 * localStorage first, so a game whose save once fitted there keeps it if the
 * save later grows — the player's progress does not care which store it landed
 * in.
 */
export async function readSaveAsync(key: string): Promise<Uint8Array | null> {
  const small = readSave(key);
  if (small) return small;

  const stored = await withStore<ArrayBuffer>('readonly', (store) =>
    store.get(key) as IDBRequest<ArrayBuffer>,
  );
  if (!stored) return null;
  const bytes = new Uint8Array(stored);
  return bytes.length > 0 ? bytes : null;
}

/**
 * Writes a save to the backend that suits its size.
 *
 * The bytes are copied before being handed to IndexedDB. Emulator cores return
 * views onto their own heap — mGBA's is a SharedArrayBuffer, which cannot be
 * structured-cloned at all — so storing the view directly would either throw or
 * persist memory the core is still writing to.
 */
export async function writeSaveAsync(
  key: string,
  data: Uint8Array,
): Promise<SaveWriteResult> {
  if (data.byteLength <= LARGE_SAVE_BYTES) return writeSave(key, data);

  const copy = new Uint8Array(data.byteLength);
  copy.set(data);

  const result = await withStore('readwrite', (store) =>
    store.put(copy.buffer, key),
  );
  if (result === null) return { ok: false, reason: 'unavailable' };

  try {
    storage()?.setItem(MARKER_PREFIX + key, '1');
  } catch {
    // The save itself landed. A missing marker only costs a Continue entry.
  }
  return { ok: true };
}
