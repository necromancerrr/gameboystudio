'use client';

/**
 * A code-native GameDex brand mark shown while a game
 * gets itself ready.
 *
 * Three rules shape this, in priority order:
 *
 * 1. It never delays gameplay. Game initialisation already runs in parallel;
 *    this is purely decorative and disappears the instant the game is ready,
 *    mid-animation if necessary.
 * 2. It does not flash on fast starts. Nothing renders for the first
 *    REVEAL_DELAY_MS, so a game that boots quickly never shows it at all.
 * 3. Reduced motion gets the original static loading treatment instead.
 *
 * The former video contains the retired brand baked into its frames. Using
 * real text keeps this identity accessible to future branding changes and
 * avoids fetching decorative media while a game is loading.
 *
 * Shared by the retro and native players so both boot identically — the player
 * should never be able to tell which runtime is behind it.
 */

import { useEffect, useState } from 'react';

/** Long enough that a fast start never flashes, short enough to feel instant. */
const REVEAL_DELAY_MS = 150;
/** Must match the CSS transition below. */
const FADE_MS = 260;

export function BootOverlay({ ready }: { ready: boolean }) {
  const [revealed, setRevealed] = useState(false);
  /** Set only by the fade timer; every other transition is derived. */
  const [faded, setFaded] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Hold everything back briefly; a game that is ready before this never shows.
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  // Ready wins immediately, whatever the animation is doing.
  const leaving = ready && revealed;

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setFaded(true), FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  // Fast start: the game was ready before the reveal delay, so it never shows.
  if (ready && !revealed) return null;
  if (faded) return null;

  return (
    <div
      data-testid="boot-state"
      data-revealed={revealed ? 'true' : 'false'}
      data-leaving={leaving ? 'true' : 'false'}
      data-sound="false"
      className={`boot-overlay ${revealed ? 'boot-overlay--in' : ''} ${
        leaving ? 'boot-overlay--out' : ''
      }`}
    >
      {reducedMotion ? (
        <span className="loading-dots text-xs tracking-widest text-faint">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <div className="flex items-center gap-4 text-lcd" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
            <rect x="1" y="1" width="30" height="30" rx="6" stroke="currentColor" strokeWidth="2" />
            <rect x="6" y="6" width="20" height="12" rx="2" fill="currentColor" />
            <path d="M7 24h8M11 20v8" stroke="currentColor" strokeWidth="2" />
            <circle cx="22" cy="24" r="2" fill="currentColor" />
          </svg>
          <span className="text-xl font-semibold tracking-tight sm:text-2xl">GameDex Studio</span>
        </div>
      )}
    </div>
  );
}
