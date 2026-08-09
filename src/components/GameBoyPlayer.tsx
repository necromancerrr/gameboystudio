'use client';

/**
 * Thin React shell around BinjgbAdapter. The component owns mounting, layout
 * and teardown; it does not own the run loop.
 *
 * Layout note: the <canvas> keeps an identical ancestor chain in every layout.
 * Only class names change. If the element were re-parented, React would mount a
 * new canvas and the adapter would keep rendering into a detached one — a black
 * screen on every rotation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BinjgbAdapter } from '@/emulation/gameboy/BinjgbAdapter';
import {
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type GameSource,
  type LogicalButton,
} from '@/emulation/core/types';
import { bindKeyboard } from '@/input/keyboard';
import { bindGamepad, type GamepadInfo } from '@/input/gamepad';
import { InputRouter } from '@/input/InputRouter';
import { TouchControls } from '@/components/TouchControls';
import { readSave, writeSave } from '@/emulation/core/saveStorage';
import { playActivity } from '@/storage/playActivity';

type Status = 'loading' | 'ready' | 'error';

const IS_DEV = process.env.NODE_ENV === 'development';

/** Primary input is touch — the signal for Handheld Mode. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return coarse;
}

export interface GameBoyPlayerProps {
  source: GameSource;
  title: string;
}

export function GameBoyPlayer({ source, title }: GameBoyPlayerProps) {
  const { romUrl, console: consoleId, saveKey } = source;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adapterRef = useRef<BinjgbAdapter | null>(null);
  const routerRef = useRef<InputRouter | null>(null);

  const isHandheld = useCoarsePointer();

  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [booted, setBooted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [gamepad, setGamepad] = useState<GamepadInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Set when the player taps the screen while a pad is connected. */
  const [touchForced, setTouchForced] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    let padTimer: ReturnType<typeof setTimeout> | null = null;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;

    const flushSave = () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const data = adapterRef.current?.readSave();
      if (!data || data.byteLength === 0) return;
      writeSave(saveKey, data);
    };

    const adapter = new BinjgbAdapter({
      canvas,
      onError: (error) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(error.message);
      },
      onBatteryDirty: () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(flushSave, 700);
      },
      onFirstFrame: () => {
        if (cancelled) return;
        setBooted(true);
        // Record only after a real dwell. Recording on open would fill
        // "Continue" with games the player glanced at and backed out of.
        dwellTimer = setTimeout(() => {
          if (!cancelled) playActivity.record(saveKey);
        }, 5000);
      },
    });
    adapterRef.current = adapter;

    // Every source writes through the router so button state is the union of
    // sources rather than last-writer-wins.
    //
    // Retro games have one joypad, so every player collapses onto it: whichever
    // controller someone picks up drives the game. BinjgbAdapter never learns
    // that players exist.
    const router = new InputRouter((_player, button, pressed) =>
      adapter.setButton(button, pressed),
    );
    routerRef.current = router;

    if (IS_DEV) {
      (window as unknown as Record<string, unknown>).__gbstudio = adapter;
    }

    const unbindKeyboard = bindKeyboard({
      onButton: (button, pressed) => router.set(0, 'keyboard', button, pressed),
    });

    const unbindGamepad = bindGamepad({
      // Retro is one joypad, so every pad merges onto player 0.
      maxPlayers: 1,
      onButton: (player, button, pressed) =>
        router.set(player, 'gamepad', button, pressed),
      onConnectionChange: (pads) => {
        if (cancelled) return;
        const pad = pads[0] ?? null;
        // Debounced so a flaky Bluetooth reconnect cannot thrash the layout.
        if (padTimer) clearTimeout(padTimer);
        padTimer = setTimeout(() => {
          if (cancelled) return;
          setGamepad(pad);
          if (pad) {
            router.releaseSource(0, 'touch');
            setTouchForced(false);
            setToast(`${pad.id.replace(/\s*\([^)]*\)\s*/g, ' ').trim()} connected`);
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => setToast(null), 2600);
          }
        }, pad ? 0 : 500);
      },
    });

    const flushOnHide = () => {
      if (saveTimer) flushSave();
    };
    window.addEventListener('pagehide', flushOnHide);
    document.addEventListener('visibilitychange', flushOnHide);

    adapter
      .loadGame({ romUrl, console: consoleId, saveKey })
      .then(() => {
        if (cancelled) return;
        const existing = readSave(saveKey);
        if (existing) adapter.loadSave(existing);
        setStatus('ready');

        // Desktop auto-starts. Handheld waits for the Play tap, which doubles
        // as the user gesture browsers require before audio can start.
        if (!window.matchMedia('(pointer: coarse)').matches) {
          adapter.start();
          setStarted(true);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      if (saveTimer) flushSave();
      cancelled = true;
      if (toastTimer) clearTimeout(toastTimer);
      if (padTimer) clearTimeout(padTimer);
      if (dwellTimer) clearTimeout(dwellTimer);
      window.removeEventListener('pagehide', flushOnHide);
      document.removeEventListener('visibilitychange', flushOnHide);
      unbindKeyboard();
      unbindGamepad();
      adapter.destroy();
      adapterRef.current = null;
      routerRef.current = null;
    };
  }, [romUrl, consoleId, saveKey]);

  // Stop burning battery in a backgrounded tab. Kept separate from user pause.
  useEffect(() => {
    let autoPaused = false;
    const onVisibility = () => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      if (document.hidden && started && !paused) {
        adapter.pause();
        autoPaused = true;
      } else if (!document.hidden && autoPaused) {
        adapter.resume();
        autoPaused = false;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [started, paused]);

  const handlePlay = useCallback(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    // resume() also resumes the AudioContext, which needs this gesture.
    adapter.resume();
    setStarted(true);
    setPaused(false);
    setTouchForced(false);
  }, []);

  const togglePause = useCallback(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const next = !paused;
    if (next) adapter.pause();
    else adapter.resume();
    setPaused(next);
  }, [paused]);

  const toggleMute = useCallback(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const next = !muted;
    adapter.setMuted(next);
    setMuted(next);
  }, [muted]);

  const handleReset = useCallback(() => {
    void adapterRef.current?.reset();
    setPaused(false);
  }, []);

  const handleTouchButton = useCallback((button: LogicalButton, pressed: boolean) => {
    routerRef.current?.set(0, 'touch', button, pressed);
  }, []);

  const handleFullscreen = useCallback(() => {
    void document.documentElement.requestFullscreen?.();
  }, []);

  const releaseTouch = useCallback(() => {
    routerRef.current?.releaseSource(0, 'touch');
  }, []);

  const handheldActive = isHandheld && started && status === 'ready';
  // A connected pad hides the deck; tapping the screen brings it back, so the
  // most recently used input wins.
  const showTouchDeck = handheldActive && (!gamepad || touchForced);

  return (
    <div
      className={
        handheldActive
          ? 'handheld'
          : 'flex flex-col items-center'
      }
    >
      <div
        className={
          handheldActive
            ? 'handheld__stage'
            : 'group relative w-full max-w-[560px] rounded-xl border border-hairline bg-black p-2'
        }
      >
        <div
          onPointerDown={
            handheldActive && gamepad && !touchForced
              ? () => setTouchForced(true)
              : undefined
          }
          className={
            handheldActive
              ? 'relative flex h-full w-full items-center justify-center'
              : 'relative'
          }
        >
          <canvas
            ref={canvasRef}
            width={SCREEN_WIDTH}
            height={SCREEN_HEIGHT}
            data-testid="gb-screen"
            className={
              handheldActive
                ? 'handheld__screen'
                : 'aspect-gb pixelated block w-full rounded-md'
            }
          />

          {status === 'error' ? (
            <div className="absolute inset-0 flex items-center justify-center rounded bg-black/85 px-6 text-center">
              <p className="max-w-sm text-xs leading-relaxed text-red-400">
                {errorMessage}
              </p>
            </div>
          ) : null}

          {status !== 'error' && !booted ? (
            <div
              data-testid="boot-state"
              className="absolute inset-0 flex items-center justify-center rounded bg-black"
            >
              <span className="loading-dots text-xs tracking-widest text-faint">
                <i /><i /><i />
              </span>
            </div>
          ) : null}

          {status === 'ready' && !started ? (
            <button
              type="button"
              onClick={handlePlay}
              data-testid="play-gate"
              className="absolute inset-0 flex items-center justify-center rounded bg-black/70 backdrop-blur-[2px]"
            >
              <span className="flex size-20 items-center justify-center rounded-full bg-lcd text-black shadow-lg">
                <svg viewBox="0 0 24 24" className="ml-1 size-8 fill-current" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              <span className="sr-only">Play {title}</span>
            </button>
          ) : null}
        </div>
      </div>

      {handheldActive ? (
        <div className="handheld__deck" data-hidden={showTouchDeck ? 'false' : 'true'}>
          {showTouchDeck ? (
            <TouchControls onButton={handleTouchButton} onReleaseAll={releaseTouch} />
          ) : null}
        </div>
      ) : null}

      {!handheldActive ? (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 opacity-60 transition-opacity focus-within:opacity-100 hover:opacity-100">
            <ControlButton onClick={togglePause} disabled={status !== 'ready'}>
              {paused ? 'Resume' : 'Pause'}
            </ControlButton>
            <ControlButton onClick={handleReset} disabled={status !== 'ready'}>
              Reset
            </ControlButton>
            <ControlButton onClick={toggleMute} disabled={status !== 'ready'}>
              {muted ? 'Unmute' : 'Mute'}
            </ControlButton>
            <ControlButton onClick={handleFullscreen} disabled={status !== 'ready'}>
              Fullscreen
            </ControlButton>
          </div>

          {IS_DEV ? <DevReadout /> : null}
        </>
      ) : null}

      {toast ? (
        <div
          data-testid="toast"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-hairline bg-surface px-4 py-2 text-xs text-muted shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function ControlButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-hairline-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Development-only instrumentation. Never rendered in production. */
function DevReadout() {
  return (
    <p className="mt-2 font-mono text-[10px] text-faint">
      dev · window.__gbstudio
    </p>
  );
}
