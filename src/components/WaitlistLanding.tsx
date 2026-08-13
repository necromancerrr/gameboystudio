'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import styles from './WaitlistLanding.module.css';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export function WaitlistLanding() {
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
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
    );

    root.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element));

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
    const form = new FormData(formElement);
    const email = String(form.get('email') ?? '').trim();
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
      setMessage(body.message || 'PLAYER REGISTERED — we’ll send the access signal when it is ready.');
      formElement.reset();
    } catch (error) {
      setFormState('error');
      setMessage(error instanceof Error ? error.message : 'Could not register this player yet.');
    }
  }

  return (
    <div ref={rootRef} className={styles.shell}>
      <div className={styles.noise} aria-hidden="true" />
      <div className={styles.progress} aria-hidden="true">
        <span className={styles.progressTrack} />
        <span className={styles.progressFill} />
        <span className={styles.progressLight} />
      </div>

      <nav className={styles.nav} aria-label="GameBoyStudio">
        <a className={styles.brand} href="#top" aria-label="GameBoyStudio home">
          <span className={styles.mark} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>GAMEBOYSTUDIO</span>
        </a>
        {/* The console is the library section further down this page, not a
            separate route — an in-page anchor rather than a link to /play,
            which does not exist. */}
        <a className={styles.navPlay} href="#console">
          ENTER CONSOLE <span aria-hidden="true">↗</span>
        </a>
      </nav>

      <section id="top" className={styles.hero}>
        <div className={styles.heroCopy} data-reveal>
          <p className={styles.kicker}>
            <span>EARLY ACCESS</span>
            <span aria-hidden="true">{'//'}</span>
            <span>PLAYER REGISTRATION</span>
          </p>
          <h1>
            Games belong
            <br />
            somewhere <em>fun</em> again.
          </h1>
          <p className={styles.intro}>
            Retro classics, original worlds, couch multiplayer, and games that can only exist
            here. GameBoyStudio is becoming a console for the browser.
          </p>

          <form className={styles.form} onSubmit={submit} data-state={formState}>
            <label htmlFor="waitlist-email">Your email</label>
            <div className={styles.formRow}>
              <input
                id="waitlist-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="player@email.com"
                required
                disabled={formState === 'submitting' || formState === 'success'}
              />
              <button type="submit" disabled={formState === 'submitting' || formState === 'success'}>
                {formState === 'submitting'
                  ? 'INSERTING…'
                  : formState === 'success'
                    ? 'REGISTERED ✓'
                    : 'GET EARLY ACCESS →'}
              </button>
            </div>
            <p className={styles.formStatus} role="status" aria-live="polite">
              {message || 'One email when the doors open. No feed. No noise.'}
            </p>
          </form>
        </div>

        <div className={styles.console} data-reveal>
          <div className={styles.consoleCap}>
            <span>GBS / CHECKPOINT</span>
            <span className={styles.live}>
              <i /> SIGNAL LIVE
            </span>
          </div>
          <div className={styles.consoleScreen}>
            <video autoPlay muted loop playsInline preload="metadata" aria-hidden="true">
              <source src="/boot/checkpoint.webm" type="video/webm" />
            </video>
            <div className={styles.scan} aria-hidden="true" />
          </div>
          <div className={styles.consoleMeta}>
            <span>01 / BOOT</span>
            <span>PLAYER ONE</span>
          </div>
        </div>

        <a className={styles.scrollCue} href="#world" aria-label="Scroll to learn more">
          <span>SCROLL TO START</span>
          <i aria-hidden="true" />
        </a>
      </section>

      <section id="world" className={`${styles.world} ${styles.section}`}>
        <div className={styles.sectionLine} aria-hidden="true" />
        <div className={styles.sectionIndex} data-reveal>
          01
        </div>
        <div className={styles.worldCopy} data-reveal>
          <p className={styles.eyebrow}>NOT ANOTHER EMULATOR TAB</p>
          <h2>A place for games, not a folder full of them.</h2>
          <p>
            GameBoyStudio starts with games you can open instantly, then goes further: original
            games, shared screens, controllers, phones as inputs, and a growing system creators
            can build inside.
          </p>
        </div>
        <div className={styles.cards} data-reveal>
          <article>
            <span>PLAY</span>
            <strong>Anywhere.</strong>
            <p>Phone, keyboard, or controller. The screen meets you where you are.</p>
          </article>
          <article>
            <span>CONNECT</span>
            <strong>Together.</strong>
            <p>One screen can become the room. More players can join without another install.</p>
          </article>
          <article>
            <span>MAKE</span>
            <strong>What is next.</strong>
            <p>Games made for this platform instead of squeezed into somebody else’s store.</p>
          </article>
        </div>
      </section>

      <section className={`${styles.signal} ${styles.section}`}>
        <div className={styles.sectionLine} aria-hidden="true" />
        <div className={styles.sectionIndex} data-reveal>
          02
        </div>
        <div className={styles.signalStage} data-reveal>
          <p className={styles.eyebrow}>THE SIGNAL</p>
          <h2>Games that could only exist here.</h2>
          <div className={styles.beam} aria-hidden="true">
            <span />
          </div>
          <p className={styles.signalBody}>
            The browser is not the compromise. It is the hardware: instant distribution, weird
            inputs, shared links, live iteration, and no download ritual between an idea and play.
          </p>
        </div>
      </section>

      <section className={`${styles.final} ${styles.section}`}>
        <div className={styles.sectionLine} aria-hidden="true" />
        <div className={styles.finalInner} data-reveal>
          <span className={`${styles.mark} ${styles.markLarge}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <p className={styles.eyebrow}>PLAYER SELECT</p>
          <h2>Be there when the console opens.</h2>
          <a className={styles.finalCta} href="#top">
            JOIN THE EARLY ACCESS LIST ↑
          </a>
          <p>GameBoyStudio · built on the web, made for play.</p>
        </div>
      </section>
    </div>
  );
}
