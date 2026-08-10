'use client';

/**
 * Touch control deck for Handheld Mode.
 *
 * React is deliberately kept out of the input path. An earlier version called
 * setState on every pointermove, which re-rendered the whole deck at touch
 * sampling rate (up to 120Hz on a modern phone) and made direction changes feel
 * late. Now presses dispatch synchronously and visual feedback is written
 * straight to the DOM; the component re-renders only when its props change.
 *
 * Three more things this gets right, all of which were wrong before:
 *
 * - Rects are measured on mount and on layout changes, never inside
 *   pointerdown. Measuring there forced a synchronous layout on the one path
 *   that must be fastest.
 * - The pointer is captured by the DECK, not by a button. Capturing per button
 *   would pin a finger to whatever it touched first and break sliding; not
 *   capturing at all meant a finger that slid off the deck stopped delivering
 *   events, so the release never arrived and the button stuck down.
 * - Hit testing is manual against cached rects, so sliding between D-pad
 *   directions and rolling from B to A both work.
 *
 * Geometry is a starting assumption, to be tuned against real devices.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { LogicalButton } from '@/emulation/core/types';

/** Fraction of the D-pad half-extent that counts as centre. */
const DPAD_DEADZONE = 0.32;

type ControlKind = 'dpad' | 'round' | 'pill';

interface CachedControl {
  el: HTMLElement;
  kind: ControlKind;
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
  const controlsRef = useRef<CachedControl[]>([]);
  const pointersRef = useRef(new Map<number, Set<LogicalButton>>());
  /** Buttons currently shown as pressed, so DOM writes stay minimal. */
  const shownRef = useRef(new Set<LogicalButton>());

  // Props live in refs so changing them never re-attaches native listeners.
  const onButtonRef = useRef(onButton);
  const onReleaseAllRef = useRef(onReleaseAll);
  const hapticsRef = useRef(haptics);

  useEffect(() => {
    onButtonRef.current = onButton;
    onReleaseAllRef.current = onReleaseAll;
    hapticsRef.current = haptics;
  });

  const measure = useCallback(() => {
    const deck = deckRef.current;
    if (!deck) return;
    controlsRef.current = Array.from(
      deck.querySelectorAll<HTMLElement>('[data-control]'),
    ).map((el) => ({
      el,
      kind: el.dataset.kind as ControlKind,
      button: el.dataset.button as LogicalButton | undefined,
      rect: el.getBoundingClientRect(),
    }));
  }, []);

  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(deck);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.addEventListener('scroll', measure, true);

    /** Which logical buttons does this point activate? */
    const hitTest = (x: number, y: number): Set<LogicalButton> => {
      const hits = new Set<LogicalButton>();
      for (const entry of controlsRef.current) {
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
          // Circular hit area so the square box corners do not respond.
          const dx = x - (rect.left + rect.width / 2);
          const dy = y - (rect.top + rect.height / 2);
          if (Math.hypot(dx, dy) <= rect.width / 2 && entry.button) hits.add(entry.button);
        } else if (entry.button) {
          hits.add(entry.button);
        }
      }
      return hits;
    };

    /** Paint pressed state directly — no render, no reconciliation. */
    const paint = () => {
      const union = new Set<LogicalButton>();
      for (const set of pointersRef.current.values()) {
        for (const button of set) union.add(button);
      }
      const shown = shownRef.current;
      if (union.size === shown.size && [...union].every((b) => shown.has(b))) return;

      for (const entry of controlsRef.current) {
        if (entry.kind === 'dpad') continue;
        if (!entry.button) continue;
        entry.el.dataset.down = union.has(entry.button) ? 'true' : 'false';
      }
      const deckEl = deckRef.current;
      if (deckEl) {
        for (const dir of ['up', 'down', 'left', 'right'] as const) {
          const pad = deckEl.querySelector<HTMLElement>(`.touch-dpad__pad--${dir}`);
          if (pad) pad.dataset.down = union.has(dir) ? 'true' : 'false';
        }
      }
      shownRef.current = union;
    };

    const buzz = () => {
      if (!hapticsRef.current) return;
      // Android Chrome only; iOS Safari has no vibration API. Fails silent.
      navigator.vibrate?.(10);
    };

    const applyPointer = (pointerId: number, next: Set<LogicalButton>) => {
      const pointers = pointersRef.current;
      const previous = pointers.get(pointerId) ?? new Set<LogicalButton>();

      // Dispatch presses before releases so a slide never has a dead frame
      // where neither direction is held.
      for (const button of next) {
        if (!previous.has(button)) {
          onButtonRef.current(button, true);
          buzz();
        }
      }
      for (const button of previous) {
        if (!next.has(button)) onButtonRef.current(button, false);
      }

      if (next.size > 0) pointers.set(pointerId, next);
      else pointers.delete(pointerId);
      paint();
    };

    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      // Capture on the deck: sliding still works because hit testing is manual,
      // and the release is guaranteed even if the finger leaves the surface.
      try {
        deck.setPointerCapture(event.pointerId);
      } catch {
        /* Capture is an optimisation; tracking still works without it. */
      }
      applyPointer(event.pointerId, hitTest(event.clientX, event.clientY));
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      event.preventDefault();
      applyPointer(event.pointerId, hitTest(event.clientX, event.clientY));
    };

    const onPointerEnd = (event: PointerEvent) => {
      applyPointer(event.pointerId, new Set());
      try {
        if (deck.hasPointerCapture(event.pointerId)) {
          deck.releasePointerCapture(event.pointerId);
        }
      } catch {
        /* Already released. */
      }
    };

    const releaseEverything = () => {
      for (const [, buttons] of pointersRef.current) {
        for (const button of buttons) onButtonRef.current(button, false);
      }
      pointersRef.current.clear();
      paint();
      onReleaseAllRef.current();
    };

    // Native listeners rather than React's delegated synthetic events: one less
    // hop on the path that has to feel instant, and preventDefault is reliable.
    deck.addEventListener('pointerdown', onPointerDown, { passive: false });
    deck.addEventListener('pointermove', onPointerMove, { passive: false });
    deck.addEventListener('pointerup', onPointerEnd);
    deck.addEventListener('pointercancel', onPointerEnd);
    deck.addEventListener('lostpointercapture', onPointerEnd);
    window.addEventListener('blur', releaseEverything);
    document.addEventListener('visibilitychange', releaseEverything);
    window.addEventListener('orientationchange', releaseEverything);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.removeEventListener('scroll', measure, true);
      deck.removeEventListener('pointerdown', onPointerDown);
      deck.removeEventListener('pointermove', onPointerMove);
      deck.removeEventListener('pointerup', onPointerEnd);
      deck.removeEventListener('pointercancel', onPointerEnd);
      deck.removeEventListener('lostpointercapture', onPointerEnd);
      window.removeEventListener('blur', releaseEverything);
      document.removeEventListener('visibilitychange', releaseEverything);
      window.removeEventListener('orientationchange', releaseEverything);
      releaseEverything();
    };
  }, [measure]);

  return (
    <div
      ref={deckRef}
      onContextMenu={(e) => e.preventDefault()}
      className={`touch-deck ${className}`}
      aria-hidden="true"
    >
      {/* Actions on the left, D-pad on the right. The pair sits in one housing
          so it reads as a single control, not two floating circles. */}
      <div className="touch-deck__cluster touch-deck__cluster--left">
        <div className="touch-actions">
          <button
            type="button"
            tabIndex={-1}
            data-control="a"
            data-kind="round"
            data-button="a"
            data-down="false"
            className="touch-btn touch-btn--round touch-btn--a"
          >
            A
          </button>
          <button
            type="button"
            tabIndex={-1}
            data-control="b"
            data-kind="round"
            data-button="b"
            data-down="false"
            className="touch-btn touch-btn--round touch-btn--b"
          >
            B
          </button>
        </div>
      </div>

      <div className="touch-deck__cluster touch-deck__cluster--right">
        <DPad />
      </div>

      <div className="touch-deck__menu">
        <button
          type="button"
          tabIndex={-1}
          data-control="select"
          data-kind="pill"
          data-button="select"
          data-down="false"
          className="touch-btn touch-btn--pill"
        >
          SELECT
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-control="start"
          data-kind="pill"
          data-button="start"
          data-down="false"
          className="touch-btn touch-btn--pill"
        >
          START
        </button>
      </div>
    </div>
  );
}

function DPad() {
  return (
    <div data-control="dpad" data-kind="dpad" className="touch-dpad">
      <span className="touch-dpad__arm touch-dpad__arm--v" />
      <span className="touch-dpad__arm touch-dpad__arm--h" />
      {(['up', 'down', 'left', 'right'] as const).map((dir) => (
        <span
          key={dir}
          data-down="false"
          className={`touch-dpad__pad touch-dpad__pad--${dir}`}
        />
      ))}
      <span className="touch-dpad__hub" />
    </div>
  );
}
