/**
 * Console-agnostic emulator contract. UI code depends on this, never on a
 * specific core's API. See D-005.
 */

export type ConsoleId = 'GB' | 'GBC';

/** Logical inputs, normalized away from any physical keyboard or gamepad. */
export type LogicalButton =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'a'
  | 'b'
  | 'start'
  | 'select';

export const LOGICAL_BUTTONS: readonly LogicalButton[] = [
  'up',
  'down',
  'left',
  'right',
  'a',
  'b',
  'start',
  'select',
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

/** Native Game Boy screen dimensions. */
export const SCREEN_WIDTH = 160;
export const SCREEN_HEIGHT = 144;
