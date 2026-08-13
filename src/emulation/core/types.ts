/**
 * Console-agnostic emulator contract. UI code depends on this, never on a
 * specific core's API. See D-005.
 */

export type ConsoleId = 'GB' | 'GBC' | 'GBA';

/** Logical inputs, normalized away from any physical keyboard or gamepad. */
export type LogicalButton =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'a'
  | 'b'
  | 'start'
  | 'select'
  /**
   * Shoulders. Game Boy has no L/R, so for GB and GBC these are simply never
   * produced: the keyboard and gamepad bindings emit them, and BinjgbAdapter's
   * setButton ignores anything it has no joypad setter for. Widening the union
   * rather than branching on console keeps the input layer console-agnostic,
   * which is the whole point of it (ARCHITECTURE.md).
   */
  | 'l'
  | 'r';

export const LOGICAL_BUTTONS: readonly LogicalButton[] = [
  'up',
  'down',
  'left',
  'right',
  'a',
  'b',
  'start',
  'select',
  'l',
  'r',
] as const;

export interface GameSource {
  /** URL the ROM is fetched from. */
  romUrl: string;
  console: ConsoleId;
  /** Stable id for persisting this game's battery save. */
  saveKey: string;
}

export interface EmulatorAdapter {
  loadGame(source: GameSource): Promise<void>;
  start(): void;
  pause(): void;
  resume(): void;
  reset(): Promise<void>;
  setButton(button: LogicalButton, pressed: boolean): void;
  setMuted(muted: boolean): void;
  /** Battery-backed cartridge RAM, or null when the cartridge has none. */
  readSave(): Uint8Array | null;
  loadSave(data: Uint8Array): boolean;
  destroy(): void;
}

/** Native Game Boy screen dimensions. Kept for GB/GBC call sites. */
export const SCREEN_WIDTH = 160;
export const SCREEN_HEIGHT = 144;

/**
 * Per-console framebuffer size. GBA is not just bigger, it is a different
 * aspect ratio (3:2 against the Game Boy's 10:9), so anything that lays out a
 * screen has to ask rather than assume.
 */
export const SCREEN_SIZE: Record<ConsoleId, { width: number; height: number }> = {
  GB: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  GBC: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  GBA: { width: 240, height: 160 },
};

/**
 * The console's screen ratio as a CSS aspect-ratio value, for the
 * --gbs-screen-aspect custom property. Layout asks for this rather than
 * hardcoding 10/9, which was true of every screen until GBA.
 */
export function screenAspect(console: ConsoleId | null): string {
  const size = console ? SCREEN_SIZE[console] : SCREEN_SIZE.GB;
  return `${size.width} / ${size.height}`;
}

/** True for consoles whose games can use the shoulder buttons. */
export function hasShoulders(console: ConsoleId): boolean {
  return console === 'GBA';
}
