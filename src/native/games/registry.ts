/**
 * Maps a catalog `entry` to the module that implements it.
 *
 * Every loader is a dynamic import, which is what keeps each Original in its
 * own chunk: opening a Game Boy page must not download Drift, and opening
 * Drift must not download Ring Out.
 */

import type { NativeGame } from '../types';

export type NativeGameId = 'drift' | 'ring-out';

const LOADERS: Record<NativeGameId, () => Promise<{ default: () => NativeGame }>> = {
  drift: () => import('./drift'),
  'ring-out': () => import('./ring-out'),
};

export function isNativeGameId(id: string): id is NativeGameId {
  return Object.prototype.hasOwnProperty.call(LOADERS, id);
}

export async function loadNativeGame(id: NativeGameId): Promise<NativeGame> {
  const loaded = await LOADERS[id]();
  return loaded.default();
}
