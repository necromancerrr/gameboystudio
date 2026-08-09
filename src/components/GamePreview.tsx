'use client';

/**
 * Plays a gameplay loop from a sprite strip.
 *
 * A strip driven by a CSS steps() animation rather than an animated image
 * format: it works everywhere, and it leaves playback under our control so the
 * loop can be paused when it is not on screen. Twenty tiles animating in a
 * background tab would be a real battery cost for no benefit.
 *
 * Falls back to a still frame when the visitor prefers reduced motion.
 */

import { useEffect, useRef, useState } from 'react';
import type { GamePreviewAsset } from '@/catalog';

export function GamePreview({
  preview,
  alt,
  eager = false,
}: {
  preview: GamePreviewAsset;
  alt: string;
  eager?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setPlaying(entry.isIntersecting),
      { rootMargin: '100px' },
    );
    observer.observe(node);

    // A hidden tab should not animate either.
    const onVisibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const animate = playing && !reduced;

  return (
    <div ref={ref} className="preview" role="img" aria-label={alt}>
      {reduced ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.still} alt="" className="preview__still" loading={eager ? 'eager' : 'lazy'} />
      ) : (
        <div
          className="preview__strip"
          data-playing={animate ? 'true' : 'false'}
          style={
            {
              backgroundImage: `url(${preview.loop})`,
              width: `${preview.frames * 100}%`,
              '--frames': preview.frames,
              '--duration': `${preview.frames / preview.fps}s`,
            } as React.CSSProperties
          }
        />
      )}
    </div>
  );
}
