'use client';

/**
 * Touch control deck for Handheld Mode.
 *
 * Pointer events are hit-tested at the deck level rather than bound per button.
 * Per-button handlers cannot express the two things that make a touch pad feel
 * right: sliding between D-pad directions without lifting, and rolling from B to
 * A. For the same reason nothing calls setPointerCapture — capture would pin a
 * pointer to the control it started on and defeat sliding.
 *
 * Geometry here is a starting assumption, to be tuned against real devices.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogicalButton } from '@/emulation/core/types';

/** Layout is data so richer input profiles can drive it later. See D-014. */
type ControlSpec =
  | { id: 'dpad'; kind: 'dpad' }
  | { id: string; kind: 'round' | 'pill'; button: LogicalButton; label: string };

const ACTION_CONTROLS: ControlSpec[] = [
  { id: 'b', kind: 'round', button: 'b', label: 'B' },
  { id: 'a', kind: 'round', button: 'a', label: 'A' },
];

const MENU_CONTROLS: ControlSpec[] = [
  { id: 'select', kind: 'pill', button: 'select', label: 'SELECT' },
  { id: 'start', kind: 'pill', button: 'start', label: 'START' },
];

/** Fraction of the D-pad half-extent that counts as centre. */
const DPAD_DEADZONE = 0.32;

interface CachedRect {
  id: string;
  kind: ControlSpec['kind'];
  button?: LogicalButton;
  rect: DOMRect;
}

export interface TouchControlsProps {
  onButton: (button: LogicalButton, pressed: boolean) => void;
  /** Called when every touch is released, so the router can clear the source. */
  onReleaseAll: () => void;
  haptics?: boolean;
  className?: string;
}

export function TouchControls({
  onButton,
  onReleaseAll,
  haptics = true,
  className = '',
}: TouchControlsProps) {
  const deckRef = useRef<HTMLDivElement>(null);
  const rectsRef = useRef<CachedRect[]>([]);
  const pointersRef = useRef(new Map<number, Set<LogicalButton>>());
  const [pressed, setPressed] = useState<ReadonlySet<LogicalButton>>(new Set());

  const measure = useCallback(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const nodes = deck.querySelectorAll<HTMLElement>('[data-control]');
    rectsRef.current = Array.from(nodes).map((node) => ({
      id: node.dataset.control ?? '',
      kind: node.dataset.kind as ControlSpec['kind'],
      button: node.dataset.button as LogicalButton | undefined,
      rect: node.getBoundingClientRect(),
    }));
  }, []);

  // Rects must be re-measured whenever the deck moves or resizes — rotation,
  // the deck fading in, or mobile browser chrome collapsing.
  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (deckRef.current) observer.observe(deckRef.current);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  const buzz = useCallback(() => {
    if (!haptics) return;
    // Android Chrome only; iOS Safari has no vibration API. Fails silent.
    navigator.vibrate?.(10);
  }, [haptics]);

  /** Which logical buttons does this point activate? */
  const hitTest = useCallback((x: number, y: number): Set<LogicalButton> => {
    const hits = new Set<LogicalButton>();
    for (const entry of rectsRef.current) {
      const { rect } = entry;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;

      if (entry.kind === 'dpad') {
        const nx = (x - (rect.left + rect.width / 2)) / (rect.width / 2);
        const ny = (y - (rect.top + rect.height / 2)) / (rect.height / 2);
        // Independent axes, so straight up never leaks a horizontal press but
        // a corner press yields a true diagonal.
        if (nx <= -DPAD_DEADZONE) hits.add('left');
        if (nx >= DPAD_DEADZONE) hits.add('right');
        if (ny <= -DPAD_DEADZONE) hits.add('up');
        if (ny >= DPAD_DEADZONE) hits.add('down');
      } else if (entry.kind === 'round') {
        // Circular hit area so the corners of the square box do not respond.
        const dx = x - (rect.left + rect.width / 2);
        const dy = y - (rect.top + rect.height / 2);
        if (Math.hypot(dx, dy) <= rect.width / 2 && entry.button) hits.add(entry.button);
      } else if (entry.button) {
        hits.add(entry.button);
      }
    }
    return hits;
  }, []);

  const applyPointer = useCallback(
    (pointerId: number, next: Set<LogicalButton>) => {
      const pointers = pointersRef.current;
      const previous = pointers.get(pointerId) ?? new Set<LogicalButton>();

      for (const button of next) {
        if (!previous.has(button)) {
          onButton(button, true);
          buzz();
        }
      }
      for (const button of previous) {
        if (!next.has(button)) onButton(button, false);
      }

      if (next.size > 0) pointers.set(pointerId, next);
      else pointers.delete(pointerId);

      // Recompute the union across live pointers for the visual state.
      const union = new Set<LogicalButton>();
      for (const set of pointers.values()) for (const b of set) union.add(b);
      setPressed(union);
    },
    [onButton, buzz],
  );

  const handleDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      measure();
      applyPointer(event.pointerId, hitTest(event.clientX, event.clientY));
    },
    [applyPointer, hitTest, measure],
  );

  const handleMove = useCallback(
    (event: React.PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      event.preventDefault();
      applyPointer(event.pointerId, hitTest(event.clientX, event.clientY));
    },
    [applyPointer, hitTest],
  );

  const handleUp = useCallback(
    (event: React.PointerEvent) => {
      applyPointer(event.pointerId, new Set());
    },
    [applyPointer],
  );

  // A pointer that stops being tracked must never leave a button stuck down.
  useEffect(() => {
    const releaseEverything = () => {
      pointersRef.current.clear();
      setPressed(new Set());
      onReleaseAll();
    };
    window.addEventListener('blur', releaseEverything);
    document.addEventListener('visibilitychange', releaseEverything);
    window.addEventListener('orientationchange', releaseEverything);
    return () => {
      window.removeEventListener('blur', releaseEverything);
      document.removeEventListener('visibilitychange', releaseEverything);
      window.removeEventListener('orientationchange', releaseEverything);
      releaseEverything();
    };
  }, [onReleaseAll]);

  const isDown = (button: LogicalButton) => pressed.has(button);

  return (
    <div
      ref={deckRef}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onContextMenu={(e) => e.preventDefault()}
      className={`touch-deck ${className}`}
      aria-hidden="true"
    >
      <div className="touch-deck__cluster touch-deck__cluster--left">
        <DPad pressed={pressed} />
      </div>

      <div className="touch-deck__cluster touch-deck__cluster--right">
        {ACTION_CONTROLS.map((control) =>
          control.kind === 'round' ? (
            <button
              key={control.id}
              type="button"
              tabIndex={-1}
              data-control={control.id}
              data-kind="round"
              data-button={control.button}
              data-down={isDown(control.button) ? 'true' : 'false'}
              className={`touch-btn touch-btn--round touch-btn--${control.id}`}
            >
              {control.label}
            </button>
          ) : null,
        )}
      </div>

      <div className="touch-deck__menu">
        {MENU_CONTROLS.map((control) =>
          control.kind === 'pill' ? (
            <button
              key={control.id}
              type="button"
              tabIndex={-1}
              data-control={control.id}
              data-kind="pill"
              data-button={control.button}
              data-down={isDown(control.button) ? 'true' : 'false'}
              className="touch-btn touch-btn--pill"
            >
              {control.label}
            </button>
          ) : null,
        )}
      </div>
    </div>
  );
}

function DPad({ pressed }: { pressed: ReadonlySet<LogicalButton> }) {
  return (
    <div data-control="dpad" data-kind="dpad" className="touch-dpad">
      <span className="touch-dpad__arm touch-dpad__arm--v" />
      <span className="touch-dpad__arm touch-dpad__arm--h" />
      {(['up', 'down', 'left', 'right'] as const).map((dir) => (
        <span
          key={dir}
          data-down={pressed.has(dir) ? 'true' : 'false'}
          className={`touch-dpad__pad touch-dpad__pad--${dir}`}
        />
      ))}
      <span className="touch-dpad__hub" />
    </div>
  );
}
