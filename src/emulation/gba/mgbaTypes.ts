/**
 * The subset of the mGBA Emscripten surface this spike uses.
 *
 * The package ships a full `mgba.d.ts`, but it is `/// <reference
 * types="emscripten" />` and declared as a namespace with `export =`, which
 * pulls a DefinitelyTyped dependency into a project that has three. The core is
 * loaded at runtime from /public rather than imported, so the types are
 * redeclared here — the same call binjgbModule.ts makes.
 *
 * Only what is actually called is listed. Cheats, patches, rewind, save states
 * and the settings surface exist upstream and are deliberately absent: they are
 * exactly the emulator internals Product Principle 2 keeps out of the product.
 */

export interface MgbaFilePaths {
  root: string;
  gamePath: string;
  savePath: string;
  saveStatePath: string;
  screenshotsPath: string;
}

export interface MgbaCoreCallbacks {
  saveDataUpdatedCallback?: (() => void) | null;
  videoFrameEndedCallback?: (() => void) | null;
  coreCrashedCallback?: (() => void) | null;
}

/** Emscripten's FS, narrowed to the calls used here. */
export interface MgbaFS {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  readdir(path: string): string[];
  analyzePath(path: string): { exists: boolean };
}

export interface mGBAEmulator {
  FS: MgbaFS;
  FSInit(): Promise<void>;
  FSSync(): Promise<void>;
  filePaths(): MgbaFilePaths;

  /** Loads a ROM already written into the emulated filesystem, and runs it. */
  loadGame(romPath: string): boolean;
  quitGame(): void;
  quitMgba(): void;
  quickReload(): void;

  pauseGame(): void;
  resumeGame(): void;
  pauseAudio(): void;
  resumeAudio(): void;

  buttonPress(name: string): void;
  buttonUnpress(name: string): void;
  /**
   * mGBA installs its own document-level key handlers. Turned off so input
   * normalization stays in src/input/, the way D-006 did for binjgb's built-in
   * handling and on-screen pad.
   */
  toggleInput(enabled: boolean): void;

  /** Writes a PNG of the current frame into the screenshots directory. */
  screenshot(fileName?: string): boolean;

  getSave(): Uint8Array | null;
  getVolume(): number;
  setVolume(percent: number): void;

  addCoreCallbacks(callbacks: MgbaCoreCallbacks): void;
  setLogger(callback: ((entry: { level: number; message: string }) => void) | null): void;

  version: { projectName: string; projectVersion: string };
}
