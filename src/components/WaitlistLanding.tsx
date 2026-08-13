'use client';

/**
 * The early-access landing.
 *
 * Lives on its own route rather than in front of the library: the games here
 * already play, and a waitlist gate over a working product would be a lie the
 * homepage does not need to tell. This page pitches what is *not* shipped yet.
 *
 * Two numbers on this page are real or absent. The catalog count comes from
 * the catalog, and there is no "N players joined" counter, because nothing in
 * the system knows that number.
 */

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import styles from './WaitlistLanding.module.css';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export function WaitlistLanding({ gameCount }: { gameCount: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [formState, setFormState] = useState<FormState>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let frame = 0;
    const updateProgress = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      root.style.setProperty('--waitlist-scroll', progress.toFixed(4));
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(updateProgress);
    };

    updateProgress();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) entry.target.setAttribute('data-revealed', 'true');
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );

    root.querySelectorAll(`.${styles.reveal}`).forEach((element) => observer.observe(element));

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formState === 'submitting') return;

    // Captured before the first await: currentTarget is nulled once the event
    // finishes dispatching, so reading it after the fetch would throw.
    const formElement = event.currentTarget;
    const email = String(new FormData(formElement).get('email') ?? '').trim();
    if (!email) return;

    setFormState('submitting');
    setMessage('');

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(body.message || 'Could not register this player yet.');

      setFormState('success');
      setMessage(body.message || 'PLAYER REGISTERED — we’ll send the signal when it is ready.');
      formElement.reset();
    } catch (error) {
      setFormState('error');
      setMessage(error instanceof Error ? error.message : 'Could not register this player yet.');
    }
  }

  const busy = formState === 'submitting' || formState === 'success';

  return (
    <div ref={rootRef} className={styles.shell}>
      <div className={styles.noise} aria-hidden="true" />
      <div className={styles.progress} aria-hidden="true">
        <span className={styles.progressTrack} />
        <span className={styles.progressFill} />
        <span className={styles.progressLight} />
      </div>

      <nav className={`${styles.container} ${styles.nav}`} aria-label="GameBoyStudio">
        <Link className={styles.brand} href="/">
          <Mark />
          <span className={styles.brandText}>
            <b>GAMEBOY</b>
            <span>STUDIO</span>
          </span>
        </Link>
        <span className={styles.power}>
          POWER
          <i />
          <i />
          <i />
          <i />
        </span>
      </nav>

      <div className={styles.rule} aria-hidden="true" />

      <header className={`${styles.container} ${styles.hero}`}>
        <div className={styles.reveal}>
          <p className={styles.eyebrow}>
            <Caret /> A NEW HOME FOR GAMES
          </p>
          <h1 className={styles.headline}>
            Games belong somewhere <em>fun again.</em>
          </h1>
          <p className={styles.intro}>
            Play retro classics, discover original games, and eventually build worlds that only
            make sense inside <b>GameBoyStudio</b>.
          </p>

          <form className={styles.form} onSubmit={submit} data-state={formState}>
            <label className="sr-only" htmlFor="waitlist-email">
              Your email address
            </label>
            <div className={styles.formRow}>
              <MailIcon />
              <input
                id="waitlist-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@email.com"
                required
                disabled={busy}
              />
              <button type="submit" disabled={busy}>
                {formState === 'submitting'
                  ? 'SENDING…'
                  : formState === 'success'
                    ? 'REGISTERED ✓'
                    : 'GET EARLY ACCESS →'}
              </button>
            </div>
            <p className={styles.status} role="status" aria-live="polite">
              {message || 'Join the waitlist. Be one of the first players.'}
            </p>
          </form>

          {/* Deliberately not a signup counter: nothing here knows how many
              people have joined, and inventing the number is not an option.
              The catalog size is true and it is the better invitation. */}
          <Link className={styles.proof} href="/">
            <span className={styles.proofDot} aria-hidden="true" />
            <span>
              <b>{gameCount} GAMES</b> PLAYABLE RIGHT NOW →
            </span>
          </Link>
        </div>

        <div className={`${styles.console} ${styles.reveal} ${styles.delayed}`}>
          <div className={styles.consoleCap}>
            <span className={styles.consoleLed} aria-hidden="true" />
            POWER
          </div>
          <div className={styles.screen}>
            <video autoPlay muted loop playsInline preload="metadata" aria-hidden="true">
              <source src="/boot/checkpoint.webm" type="video/webm" />
            </video>
            <div className={styles.scan} aria-hidden="true" />
            <div className={styles.glare} aria-hidden="true" />
          </div>
          <div className={styles.consoleFoot}>
            <span>GAMEBOY STUDIO</span>
            <span className={styles.grille} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      </header>

      <a className={`${styles.container} ${styles.scrollCue}`} href="#features">
        SCROLL TO EXPLORE
        <ChevronDown />
      </a>

      <div className={styles.rule} aria-hidden="true" />

      <section id="features" className={`${styles.container} ${styles.features}`}>
        <div className={styles.reveal}>
          <GamepadIcon />
          <h2>PLAY ANYWHERE.</h2>
          <p>Browser-based. Controller-ready. Pick up and play, anywhere.</p>
        </div>
        <div className={styles.reveal}>
          <HeartIcon />
          <h2>BUILT FOR CONTROLLERS.</h2>
          <p>Designed from the ground up for real gameplay.</p>
        </div>
        <div className={styles.reveal}>
          <StarIcon />
          <h2>NEW GAMES LIVE HERE.</h2>
          <p>Original games, fresh ideas, made for GameBoyStudio.</p>
        </div>
      </section>

      <div className={styles.rule} aria-hidden="true" />

      <section className={`${styles.container} ${styles.featured}`}>
        <div className={styles.reveal}>
          <p className={styles.eyebrow}>
            <Caret /> FEATURED GAME
          </p>
          <h2>DRIFT</h2>
          <p>
            One thumb, one orbit, one long dive toward the sun. Built for the web. Built for fun.
          </p>
          <Link className={styles.play} href="/games/drift">
            PLAY NOW <PlayIcon />
          </Link>
        </div>
        <div className={`${styles.art} ${styles.reveal} ${styles.delayed}`}>
          {/* The real game's art, not a mock-up of one. */}
          <Image src="/originals/drift.png" alt="Drift" width={320} height={288} priority />
          <span className={styles.artTag}>ORIGINAL</span>
        </div>
      </section>

      <div className={styles.rule} aria-hidden="true" />

      <section className={`${styles.container} ${styles.closing}`}>
        <div className={`${styles.cart} ${styles.reveal}`}>
          <Cartridge />
        </div>
        <div className={styles.reveal}>
          <p className={styles.eyebrow}>THIS ISN’T AN EMULATOR.</p>
          <h2>
            This is the start of <em>something new.</em>
          </h2>
          <p>
            GameBoyStudio is becoming a place for games made specifically for the browser:
            controllers, friends in the same room, phones as extra pads, and whatever we invent
            next.
          </p>
          <p>
            The best games aren’t behind a download. They’re in a place that gets better over
            time.
          </p>
          <p>
            Welcome to <b>GameBoyStudio</b>.
          </p>
        </div>
      </section>

      <div className={styles.rule} aria-hidden="true" />

      <footer className={`${styles.container} ${styles.footer}`}>
        <Link className={styles.brand} href="/">
          <Mark size={26} />
          <span className={styles.brandText}>
            <b style={{ fontSize: '0.8rem' }}>GAMEBOY</b>
            <span style={{ fontSize: '0.5rem' }}>STUDIO</span>
          </span>
        </Link>
        <span>© {new Date().getFullYear()} GameBoyStudio</span>
        <span className={styles.footerLinks}>
          <Link href="/">Library</Link>
          <Link href="/games/drift">Drift</Link>
        </span>
      </footer>
    </div>
  );
}

/* --- Marks and icons ------------------------------------------------------- */

function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg
      className={styles.logo}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="30" height="30" rx="6" fill="#9bbc0f" />
      <rect x="6" y="6" width="20" height="13" rx="2" fill="#0b1408" />
      <rect x="9" y="9" width="3" height="3" fill="#9bbc0f" />
      <rect x="20" y="9" width="3" height="3" fill="#9bbc0f" />
      <rect x="7" y="23" width="7" height="2" fill="#0b1408" />
      <rect x="9.5" y="20.5" width="2" height="7" fill="#0b1408" />
      <circle cx="21" cy="23" r="1.8" fill="#0b1408" />
      <circle cx="25" cy="21" r="1.8" fill="#0b1408" />
    </svg>
  );
}

function Caret() {
  return (
    <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden="true">
      <path d="M0 0l8 4.5L0 9z" fill="currentColor" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true">
      <path d="M0 0l9 5-9 5z" fill="currentColor" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="16" height="9" viewBox="0 0 16 9" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M1 1l7 6.5L15 1" />
    </svg>
  );
}

function GamepadIcon() {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <rect x="2" y="7" width="20" height="11" rx="5.5" />
      <path d="M6.2 10.5v3.4M4.5 12.2h3.4" strokeLinecap="round" />
      <circle cx="16.4" cy="11.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="18.8" cy="13.4" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M12 3.6l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 10l6-.8z" strokeLinejoin="round" />
    </svg>
  );
}

/** An isometric wireframe cartridge, drawn rather than photographed. */
function Cartridge() {
  return (
    <svg viewBox="0 0 260 250" fill="none" stroke="currentColor" aria-hidden="true">
      {/* Grid floor */}
      <g opacity="0.16" strokeWidth="0.8">
        <path d="M20 200l110-42 110 42-110 42z" />
        <path d="M57 186l110 42M94 172l110 42M20 200l110 42M57 214l110-42M94 228l110-42" />
      </g>

      {/* Cartridge, tilted rather than drawn in perspective by hand */}
      <g transform="translate(96 26) matrix(1 0.3 -0.62 0.86 0 0)">
        {/* Depth: a second shell behind, joined at the corners */}
        <g opacity="0.4" strokeWidth="1.2">
          <rect x="12" y="-9" width="120" height="140" rx="7" />
          <path d="M0 0l12-9M120 0l12-9M120 140l12-9M0 140l12-9" />
        </g>
        <rect x="0" y="0" width="120" height="140" rx="7" strokeWidth="1.6" />
        <rect x="15" y="17" width="90" height="63" rx="3" strokeWidth="1.2" opacity="0.85" />
        {/* The mark on the label */}
        <g strokeWidth="1.2" opacity="0.7">
          <rect x="44" y="31" width="32" height="35" rx="3" />
          <rect x="51" y="37" width="18" height="13" rx="1" />
          <path d="M52 58h8M56 54v8" />
          <circle cx="66" cy="58" r="1.6" />
        </g>
        {/* Grip ridges */}
        <g strokeWidth="1.2" opacity="0.6">
          <path d="M20 100h80M20 110h80M20 120h80" />
        </g>
      </g>
    </svg>
  );
}
