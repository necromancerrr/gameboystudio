'use client';

/**
 * Thin React shell around BinjgbAdapter. The component owns mounting and
 * teardown; it does not own the run loop.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BinjgbAdapter } from '@/emulation/gameboy/BinjgbAdapter';
import { SCREEN_HEIGHT, SCREEN_WIDTH, type GameSource } from '@/emulation/core/types';
import { bindKeyboard } from '@/input/keyboard';
import { bindGamepad, type GamepadInfo } from '@/input/gamepad';
import { readSave, writeSave } from '@/emulation/core/saveStorage';

type Status = 'loading' | 'ready' | 'error';

export interface GameBoyPlayerProps {
  source: GameSource;
  title: string;
}

export function GameBoyPlayer({ source, title }: GameBoyPlayerProps) {
  // Depend on the primitive fields, never the object. Callers build `source`
  // inline, so its identity changes on every render — keying the effect on it
  // would tear down and rebuild the emulator each time state updates, which
  // thrashes WASM allocations badly enough to trap.
  const { romUrl, console: consoleId, saveKey } = source;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<BinjgbAdapter | null>(null);

  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [gamepad, setGamepad] = useState<GamepadInfo | null>(null);
  const [fps, setFps] = useState(0);
  // Lights up when pad input actually arrives, so "is my controller working?"
  // is answerable without opening a console.
  const [padActive, setPadActive] = useState(false);
  const padPulseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Same idea for the keyboard: shows whether keystrokes reach the app at all,
  // which separates "keys not arriving" from "keys arriving but mapped wrong".
  const [keyActive, setKeyActive] = useState(false);
  const keyPulseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const savePulseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    // Games write to battery RAM in bursts, so debounce rather than writing
    // localStorage on every dirty frame.
    const flushSave = () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const data = adapterRef.current?.readSave();
      if (!data || data.byteLength === 0) return;
      const result = writeSave(saveKey, data);
      if (cancelled) return;
      setSaveState(result.ok ? 'saved' : 'failed');
      if (savePulseRef.current) clearTimeout(savePulseRef.current);
      savePulseRef.current = setTimeout(() => setSaveState('idle'), 1600);
    };

    const adapter = new BinjgbAdapter({
      canvas,
      onFps: (value) => {
        if (!cancelled) setFps(value);
      },
      onError: (error) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(error.message);
      },
      onBatteryDirty: () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(flushSave, 700);
      },
    });
    adapterRef.current = adapter;

    // Dev-only handle for debugging and automated browser checks. Headless and
    // backgrounded tabs throttle requestAnimationFrame to zero, so the loop has
    // to be driven manually there.
    if (process.env.NODE_ENV === 'development') {
      (window as unknown as Record<string, unknown>).__gbstudio = adapter;
    }

    const unbindKeyboard = bindKeyboard({
      onButton: (button, pressed) => {
        adapter.setButton(button, pressed);
        if (cancelled || !pressed) return;
        setKeyActive(true);
        if (keyPulseRef.current) clearTimeout(keyPulseRef.current);
        keyPulseRef.current = setTimeout(() => setKeyActive(false), 400);
      },
    });

    // Unlike the keyboard binding this is not scoped to focus: gamepad input
    // cannot collide with typing, and requiring a click first would be a poor
    // controller experience. It is still bound only while a player is mounted.
    const unbindGamepad = bindGamepad({
      onButton: (button, pressed) => {
        adapter.setButton(button, pressed);
        if (cancelled || !pressed) return;
        setPadActive(true);
        if (padPulseRef.current) clearTimeout(padPulseRef.current);
        padPulseRef.current = setTimeout(() => setPadActive(false), 400);
      },
      onConnectionChange: (pad) => {
        if (!cancelled) setGamepad(pad);
      },
    });

    // A pending debounce would be lost if the tab is closed or backgrounded.
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
        adapter.start();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });

    // Runs on unmount and on StrictMode's immediate second pass.
    return () => {
      // Write before teardown, otherwise navigating away loses the last burst.
      if (saveTimer) flushSave();
      cancelled = true;
      window.removeEventListener('pagehide', flushOnHide);
      document.removeEventListener('visibilitychange', flushOnHide);
      if (padPulseRef.current) clearTimeout(padPulseRef.current);
      if (keyPulseRef.current) clearTimeout(keyPulseRef.current);
      if (savePulseRef.current) clearTimeout(savePulseRef.current);
      unbindKeyboard();
      unbindGamepad();
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [romUrl, consoleId, saveKey]);

  // Side effects stay OUT of the state updater. React double-invokes updaters
  // in development, which fired pause() and resume() back to back and left the
  // button toggling to nowhere.
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

  const handleFullscreen = useCallback(() => {
    void stageRef.current?.requestFullscreen?.();
  }, []);

  return (
    <div className="flex flex-col items-center">
      <div
        ref={stageRef}
        tabIndex={0}
        role="application"
        aria-label={`${title} play area`}
        className="group relative w-full max-w-[560px] rounded-xl border border-hairline bg-black p-2 outline-none focus-visible:border-lcd-deep focus-visible:ring-1 focus-visible:ring-lcd-deep"
      >
        <canvas
          ref={canvasRef}
          width={SCREEN_WIDTH}
          height={SCREEN_HEIGHT}
          data-testid="gb-screen"
          className="aspect-gb pixelated block w-full rounded-md"
        />

        {status !== 'ready' ? (
          <div className="absolute inset-2 flex items-center justify-center rounded-md bg-black/85 px-6 text-center">
            {status === 'loading' ? (
              <p className="font-mono text-xs text-muted">Loading…</p>
            ) : (
              <p className="max-w-sm font-mono text-xs leading-relaxed text-red-400">
                {errorMessage}
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
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

      <p
        data-testid="player-status"
        data-status={status}
        className="mt-3 text-center text-xs text-faint"
      >
        <Key>arrows</Key> move · <Key>X</Key> A · <Key>Z</Key> B ·{' '}
        <Key>Enter</Key> Start · <Key>Shift</Key> Select
        {status === 'ready' ? (
          <span
            data-testid="fps"
            data-key-active={keyActive ? 'true' : 'false'}
            className={[
              'ml-2 font-mono transition-colors',
              keyActive ? 'text-lcd' : 'text-faint',
            ].join(' ')}
          >
            {paused ? 'paused' : `${fps.toFixed(0)} fps`}
            {keyActive ? ' · key' : ''}
          </span>
        ) : null}
        {saveState !== 'idle' ? (
          <span
            data-testid="save-status"
            data-save-state={saveState}
            className={[
              'ml-2 font-mono',
              saveState === 'saved' ? 'text-lcd' : 'text-red-400',
            ].join(' ')}
          >
            {saveState === 'saved' ? '· saved' : '· save failed'}
          </span>
        ) : null}
      </p>

      <p
        data-testid="gamepad-status"
        data-connected={gamepad ? 'true' : 'false'}
        className="mt-2 flex items-center gap-1.5 text-center text-xs text-faint"
      >
        <span
          aria-hidden="true"
          data-pad-active={padActive ? 'true' : 'false'}
          className={[
            'inline-block rounded-full transition-all duration-150',
            padActive ? 'size-2.5 bg-lcd' : 'size-1.5',
            !padActive && gamepad ? 'bg-lcd/60' : '',
            !gamepad ? 'bg-hairline-strong' : '',
          ].join(' ')}
        />
        {gamepad ? (
          <span className="text-muted">
            {describePad(gamepad.id)} connected
            {gamepad.standardMapping ? '' : ' · non-standard layout, mapping may differ'}
            {padActive ? ' · input detected' : ''}
          </span>
        ) : (
          <span>No controller — press a button on one to connect</span>
        )}
      </p>
    </div>
  );
}

/**
 * Gamepad ids are verbose and vendor-specific, e.g.
 * "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)".
 * Strip the parenthesised hardware ids for display.
 */
function describePad(id: string): string {
  const trimmed = id.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : 'Controller';
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
      className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-hairline-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-hairline disabled:hover:text-muted"
    >
      {children}
    </button>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 rounded border border-hairline bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
      {children}
    </kbd>
  );
}
