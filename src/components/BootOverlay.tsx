'use client';

/**
 * The Checkpoint Boot moment — a branded startup animation shown while a game
 * gets itself ready.
 *
 * Four rules shape this, in priority order:
 *
 * 1. It never delays gameplay. Game initialisation already runs in parallel;
 *    this is purely decorative and disappears the instant the game is ready,
 *    mid-animation if necessary.
 * 2. It does not flash on fast starts. Nothing renders for the first
 *    REVEAL_DELAY_MS, so a game that boots quickly never shows it at all.
 * 3. Sound plays only where the browser already allows it. No new click gate is
 *    introduced to earn audio.
 * 4. Reduced motion gets the original static loading treatment instead.
 *
 * Shared by the retro and native players so both boot identically — the player
 * should never be able to tell which runtime is behind it.
 */

import { useEffect, useRef, useState } from 'react';

/** Long enough that a fast start never flashes, short enough to feel instant. */
const REVEAL_DELAY_MS = 150;
/** Must match the CSS transition below. */
const FADE_MS = 260;

/**
 * One asset, always. It carries an audio track that plays only when the browser
 * already permits sound; otherwise it plays muted. Shipping a second silent
 * encode would save ~30KB once and cost two files that can drift apart.
 */
const BOOT_SRC = '/boot/checkpoint.webm';

/**
 * Whether this document has already seen a real interaction.
 *
 * Client-side navigation keeps the same document, so arriving from the library
 * — which required a tap or click on a game card — carries activation with it
 * and the boot moment gets its sound. A cold load straight to a game URL has no
 * activation, so it plays silently. That is the whole audio policy: no gate, no
 * prompt, no autoplay rejection surfaced to the player.
 */
function hasUserActivation(): boolean {
  if (typeof navigator === 'undefined') return false;
  const activation = (
    navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
  ).userActivation;
  return activation?.hasBeenActive === true;
}

export function BootOverlay({ ready }: { ready: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [revealed, setRevealed] = useState(false);
  /** Set only by the fade timer; every other transition is derived. */
  const [faded, setFaded] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Decided once, on mount, so the source never swaps mid-play.
  const [withSound] = useState(hasUserActivation);

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

  // Autoplay can still be refused even when activation looks available, so
  // fall back to muted rather than letting the animation silently not start.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !revealed || reducedMotion) return;
    video.play().catch(() => {
      video.muted = true;
      void video.play().catch(() => {
        /* Animation is decorative; a refusal must never surface to the player. */
      });
    });
  }, [revealed, reducedMotion]);

  // Fast start: the game was ready before the reveal delay, so it never shows.
  if (ready && !revealed) return null;
  if (faded) return null;

  return (
    <div
      data-testid="boot-state"
      data-revealed={revealed ? 'true' : 'false'}
      data-leaving={leaving ? 'true' : 'false'}
      data-sound={!reducedMotion && withSound ? 'true' : 'false'}
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
        <video
          ref={videoRef}
          data-testid="boot-video"
          className="boot-overlay__video"
          src={BOOT_SRC}
          muted={!withSound}
          autoPlay
          playsInline
          preload="auto"
          // Decorative: the player loses nothing by not seeing it.
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
    </div>
  );
}
