/**
 * Loads the vendored binjgb Emscripten module.
 *
 * binjgb is not an npm package (see D-006), so the glue script is served from
 * /public and loaded at runtime rather than bundled. Keeping it out of the
 * bundler also stops Turbopack from trying to resolve Emscripten's Node-only
 * branches.
 *
 * Each emulator gets its OWN module instance. Reusing one instance across games
 * traps: after `_emulator_delete` and `_free`, allocating a differently sized
 * ROM corrupts the core and the next `_emulator_new_simple` dies with "memory
 * access out of bounds". The glue script and the .wasm bytes are still fetched
 * once and shared, so the repeat cost is instantiation only.
 */

const SCRIPT_URL = '/emulator/binjgb/binjgb.js';
const WASM_URL = '/emulator/binjgb/binjgb.wasm';

/** The subset of the Emscripten module surface this project uses. */
export interface BinjgbModule {
  HEAP8: Int8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  _emulator_new_simple(
    romPtr: number,
    romSize: number,
    audioFrequency: number,
    audioFrames: number,
    cgbColorCurve: number,
  ): number;
  _emulator_delete(e: number): void;
  _emulator_run_until_f64(e: number, ticks: number): number;
  _emulator_get_ticks_f64(e: number): number;

  /**
   * Input plumbing. `set_joyp_*` writes into a joypad buffer that the core only
   * reads once this callback is installed — without it every button press is
   * silently discarded and the game looks unplayable.
   */
  _joypad_new(): number;
  _joypad_delete(joypadPtr: number): void;
  _emulator_set_default_joypad_callback(e: number, joypadPtr: number): void;

  _get_frame_buffer_ptr(e: number): number;
  _get_frame_buffer_size(e: number): number;
  _get_audio_buffer_ptr(e: number): number;
  _get_audio_buffer_capacity(e: number): number;

  _set_joyp_up(e: number, v: number): void;
  _set_joyp_down(e: number, v: number): void;
  _set_joyp_left(e: number, v: number): void;
  _set_joyp_right(e: number, v: number): void;
  _set_joyp_A(e: number, v: number): void;
  _set_joyp_B(e: number, v: number): void;
  _set_joyp_start(e: number, v: number): void;
  _set_joyp_select(e: number, v: number): void;
}

type BinjgbFactory = (moduleArg?: Record<string, unknown>) => Promise<BinjgbModule>;

declare global {
  interface Window {
    Binjgb?: BinjgbFactory;
  }
}

let scriptPromise: Promise<void> | null = null;
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.Binjgb) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error('binjgb glue script failed to load')),
      { once: true },
    );
    if (!existing) {
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    scriptPromise = null; // allow a retry
    throw error;
  });

  return scriptPromise;
}

function loadWasmBinary(): Promise<ArrayBuffer> {
  if (wasmBinaryPromise) return wasmBinaryPromise;

  wasmBinaryPromise = fetch(WASM_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`binjgb.wasm failed to load: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .catch((error: unknown) => {
      wasmBinaryPromise = null;
      throw error;
    });

  return wasmBinaryPromise;
}

/**
 * Creates a fresh, isolated binjgb module. Callers own the result and must not
 * share it between emulators.
 */
export async function createBinjgbModule(): Promise<BinjgbModule> {
  if (typeof window === 'undefined') {
    throw new Error('binjgb can only load in the browser');
  }

  const [, wasmBinary] = await Promise.all([loadScript(), loadWasmBinary()]);
  const factory = window.Binjgb;
  if (!factory) {
    throw new Error('binjgb glue loaded but did not define Binjgb');
  }

  // Emscripten transfers the buffer it is given, so hand over a copy and keep
  // the cached original for the next game.
  return factory({ wasmBinary: wasmBinary.slice(0) });
}
