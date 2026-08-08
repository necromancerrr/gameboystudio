/**
 * Battery-save persistence.
 *
 * Console-agnostic on purpose: a save is an opaque byte array keyed by game.
 * localStorage is the right store for now — saves are tens of kilobytes, must
 * survive a reload, and must not require a backend (see the project scope).
 */

const PREFIX = 'gbstudio.save.v1.';

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
  storage()?.removeItem(PREFIX + key);
}

export function hasSave(key: string): boolean {
  return readSave(key) !== null;
}
