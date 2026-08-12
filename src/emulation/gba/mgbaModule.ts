/**
 * Loads the vendored mGBA Emscripten module.
 *
 * Mirrors binjgbModule.ts, with one structural difference: binjgb's glue is a
 * classic script that hangs a factory off `window`, while mGBA's is an ES
 * module with a default export. It is imported through a variable URL so the
 * bundler cannot statically resolve it and try to walk Emscripten's Node-only
 * branches.
 *
 * The artifacts under /public/emulator/mgba are copied verbatim from
 * `@thenick775/mgba-wasm` (MPL-2.0). The package is installed only to produce
 * that copy; nothing imports it at build time. See GBA_SPIKE.md for why this is
 * a fork rather than upstream mGBA.
 */

import type { mGBAEmulator } from './mgbaTypes';

/** mgba.wasm sits beside this, which is how the core finds it. See below. */
const SCRIPT_URL = '/emulator/mgba/mgba.js';

type MgbaFactory = (moduleArg?: Record<string, unknown>) => Promise<mGBAEmulator>;

let factoryPromise: Promise<MgbaFactory> | null = null;

function loadFactory(): Promise<MgbaFactory> {
  if (factoryPromise) return factoryPromise;

  // Indirection through a variable defeats static analysis, which is the point.
  const url = SCRIPT_URL;
  factoryPromise = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)
    .then((mod: { default: MgbaFactory }) => mod.default)
    .catch((error: unknown) => {
      factoryPromise = null; // allow a retry
      throw error;
    });

  return factoryPromise;
}

/**
 * Creates a fresh mGBA instance bound to a canvas.
 *
 * One instance per player, for the same reason D-006 records for binjgb: these
 * cores are not built to be recycled across ROMs, and the failure mode is
 * memory corruption rather than a clean error.
 */
export async function createMgbaModule(
  canvas: HTMLCanvasElement,
): Promise<mGBAEmulator> {
  if (typeof window === 'undefined') {
    throw new Error('mGBA can only load in the browser');
  }

  const factory = await loadFactory();
  /**
   * Pass `canvas` and nothing else.
   *
   * Two Emscripten options that look harmless each break this build silently,
   * and both were found by bisection rather than by any error:
   *
   * - `locateFile` — the obvious way to point at the .wasm. This is a pthreads
   *   build, and the worker threads re-enter this same script and resolve the
   *   binary themselves; overriding resolution on the main thread only leaves
   *   the instance constructed, `loadGame()` returning true, and the main loop
   *   never running. Not needed anyway: the default resolves relative to
   *   mgba.js, which is already beside the .wasm.
   * - `setStatus` — a no-op looks like the right way to suppress Emscripten's
   *   DOM status writes, and it interferes with the generated `run()`.
   *
   * The failure mode in both cases is a white canvas with no console error, no
   * rejected promise, and every readout claiming success. See GBA_SPIKE.md.
   */
  const module = await factory({ canvas });

  await module.FSInit();
  return module;
}
