/**
 * Keyboard -> logical button mapping.
 *
 * Two decisions worth knowing about:
 *
 * 1. Events are matched on BOTH `event.code` and `event.key`. `code` is the
 *    physical key position, which keeps WASD in the right shape on any layout;
 *    `key` is the character actually produced, which is what makes the keys
 *    labelled Z and X work on non-QWERTY layouts (on AZERTY the key printed Z
 *    reports `code: "KeyW"`). Some environments also omit `code` entirely.
 *
 * 2. Listening is global rather than scoped to a focused element. Requiring a
 *    click first fails silently and looks like broken input. Events are ignored
 *    when they target a form field or control, so typing and button activation
 *    still behave normally, and the binding only exists while a player is
 *    mounted.
 */

import type { LogicalButton } from '@/emulation/core/types';

/** Matched against `event.code` — physical key position. */
export const DEFAULT_CODE_MAP: Readonly<Record<string, LogicalButton>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyX: 'a',
  KeyZ: 'b',
  Enter: 'start',
  ShiftLeft: 'select',
  ShiftRight: 'select',
};

/** Matched against `event.key`, lowercased — the character produced. */
export const DEFAULT_KEY_MAP: Readonly<Record<string, LogicalButton>> = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  x: 'a',
  z: 'b',
  enter: 'start',
  shift: 'select',
};

/**
 * Two-player keyboard split. Player one loses the WASD aliases here because
 * player two needs them — in single-player both schemes stay available.
 *
 * This exists so couch multiplayer is testable without two physical pads.
 */
export const P1_DUAL_CODE_MAP: Readonly<Record<string, LogicalButton>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyX: 'a',
  KeyZ: 'b',
  Enter: 'start',
  ShiftRight: 'select',
};

export const P1_DUAL_KEY_MAP: Readonly<Record<string, LogicalButton>> = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  x: 'a',
  z: 'b',
  enter: 'start',
};

export const P2_CODE_MAP: Readonly<Record<string, LogicalButton>> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyH: 'a',
  KeyG: 'b',
  Tab: 'start',
};

export const P2_KEY_MAP: Readonly<Record<string, LogicalButton>> = {
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  h: 'a',
  g: 'b',
};

/** Arrow keys scroll the page; nothing else we map has a default worth blocking. */
const SCROLL_KEYS = new Set(['up', 'down', 'left', 'right']);

/** Elements where every keystroke belongs to the element, not the game. */
const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Elements that own only their activation keys; other keys still reach the game. */
const ACTIVATABLE = new Set(['BUTTON', 'A', 'SUMMARY']);

function isActivationKey(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' ||
    event.key === ' ' ||
    event.code === 'Enter' ||
    event.code === 'Space'
  );
}

/**
 * Deliberately narrow. Treating every focusable element as off-limits kills the
 * whole keyboard the moment someone clicks Pause or the Library link — the
 * focus stays there and nothing works, with no visible reason why.
 */
function ownsEvent(target: EventTarget | null, event: KeyboardEvent): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (TEXT_ENTRY.has(target.tagName)) return true;
  if (ACTIVATABLE.has(target.tagName)) return isActivationKey(event);
  return false;
}

export interface KeyboardBindingOptions {
  onButton: (button: LogicalButton, pressed: boolean) => void;
  codeMap?: Readonly<Record<string, LogicalButton>>;
  keyMap?: Readonly<Record<string, LogicalButton>>;
}

/** Returns an unbind function; callers must invoke it on teardown. */
export function bindKeyboard({
  onButton,
  codeMap = DEFAULT_CODE_MAP,
  keyMap = DEFAULT_KEY_MAP,
}: KeyboardBindingOptions): () => void {
  if (typeof window === 'undefined') return () => {};

  const pressed = new Set<LogicalButton>();

  const resolve = (event: KeyboardEvent): LogicalButton | undefined => {
    // Never swallow browser and OS shortcuts.
    if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
    if (ownsEvent(event.target, event)) return undefined;
    return codeMap[event.code] ?? keyMap[event.key?.toLowerCase() ?? ''];
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const button = resolve(event);
    if (!button) return;
    if (SCROLL_KEYS.has(button)) event.preventDefault();
    if (pressed.has(button)) return; // ignore auto-repeat
    pressed.add(button);
    onButton(button, true);
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    const button = resolve(event);
    if (!button) return;
    if (SCROLL_KEYS.has(button)) event.preventDefault();
    if (!pressed.delete(button)) return;
    onButton(button, false);
  };

  // Alt-tabbing away mid-press would otherwise leave a button stuck down.
  const releaseAll = () => {
    for (const button of pressed) onButton(button, false);
    pressed.clear();
  };

  // Capture phase on the document: this runs before any element can call
  // stopPropagation, so an overlay or extension that swallows keys in the
  // bubble phase cannot silently kill game input.
  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('keyup', handleKeyUp, true);
  window.addEventListener('blur', releaseAll);

  return () => {
    releaseAll();
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('keyup', handleKeyUp, true);
    window.removeEventListener('blur', releaseAll);
  };
}
