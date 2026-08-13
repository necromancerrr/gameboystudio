'use client';

/**
 * React shell for a GameBoyStudio Original.
 *
 * Deliberately a sibling of RetroPlayer rather than a refactor of it. The
 * retro player carries every fix from M1 and M2 and there is nothing to gain
 * from reopening it; the two share the input layer, the save store and the
 * activity store, which is where sharing actually pays.
 *
 * The runtime and the game itself are imported dynamically, so a Game Boy page
 * never downloads either one.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { NativeGameRuntime } from '@/native/NativeGameRuntime';
import type { LogicalButton } from '@/emulation/core/types';
import { InputRouter } from '@/input/InputRouter';
import { PlayerSlots, type SlotState } from '@/input/PlayerSlots';
import {
  bindKeyboard,
  P1_DUAL_CODE_MAP,
  P1_DUAL_KEY_MAP,
  P2_CODE_MAP,
  P2_KEY_MAP,
} from '@/input/keyboard';
import { bindGamepad, type GamepadInfo } from '@/input/gamepad';
import { TouchControls } from '@/components/TouchControls';
import { BootOverlay } from '@/components/BootOverlay';
import { InvitePanel } from '@/components/InvitePanel';
import { useHostRoom } from '@/net/useHostRoom';
import { relayConfigured } from '@/net/relayConfig';
import { readSave, writeSave } from '@/emulation/core/saveStorage';
import { playActivity } from '@/storage/playActivity';

type Status = 'loading' | 'ready' | 'error';

export interface NativePlayerProps {
  /** Catalog `entry` — the id the native registry resolves. */
  entry: string;
  /** Catalog slug, used for saved progress and recently-played. */
  slug: string;
  title: string;
  players: { min: number; max: number };
  supportsTouch: boolean;
}

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

export function NativePlayer({ entry, slug, title, players, supportsTouch }: NativePlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<NativeGameRuntime | null>(null);
  const routerRef = useRef<InputRouter | null>(null);

  const isHandheld = useCoarsePointer();
  const multiplayer = players.max > 1;
  /**
   * Only games that genuinely need a second person wait for one. A one-player
   * game must never gate on presence: on a phone its only input device is the
   * touch deck, and the deck does not appear until the game has started, so
   * gating would deadlock a game that has nothing to wait for.
   */
  const needsCompany = players.min > 1;

  const [slots] = useState(() => new PlayerSlots(Math.max(players.max, 1)));
  const slotStates = useSyncExternalStore(
    useCallback((notify) => slots.subscribe(notify), [slots]),
    useCallback(() => slots.snapshot(), [slots]),
    useCallback(() => slots.snapshot(), [slots]),
  );
  const presentPlayers = slotStates.filter((slot) => slot.devices.length > 0).length;
  const roomReady = !needsCompany || presentPlayers >= players.min;

  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [booted, setBooted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pads, setPads] = useState<GamepadInfo[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [touchForced, setTouchForced] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let runtime: NativeGameRuntime | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;

    const flushSave = () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const data = runtimeRef.current?.readSave();
      if (!data || data.byteLength === 0) return;
      writeSave(slug, data);
    };

    // Input binds before the runtime exists, so a key held during load is not
    // lost — the router simply writes into a runtime that is not there yet.
    const router = new InputRouter((player, button, pressed) =>
      runtimeRef.current?.setButton(player, button, pressed),
    );
    routerRef.current = router;

    const unbindKeyboard = multiplayer
      ? (() => {
          // Two people, one keyboard: player one keeps the arrows, player two
          // takes WASD. Not a substitute for two pads — a way to try the game
          // when only one is in the room.
          const one = bindKeyboard({
            onButton: (button, pressed) => router.set(0, 'keyboard', button, pressed),
            codeMap: P1_DUAL_CODE_MAP,
            keyMap: P1_DUAL_KEY_MAP,
          });
          const two = bindKeyboard({
            onButton: (button, pressed) => router.set(1, 'keyboard', button, pressed),
            codeMap: P2_CODE_MAP,
            keyMap: P2_KEY_MAP,
          });
          return () => {
            one();
            two();
          };
        })()
      : bindKeyboard({
          onButton: (button, pressed) => router.set(0, 'keyboard', button, pressed),
        });

    const unbindGamepad = bindGamepad({
      maxPlayers: players.max,
      slots,
      onButton: (player, button, pressed) => router.set(player, 'gamepad', button, pressed),
      onConnectionChange: (connected) => {
        if (cancelled) return;
        setPads(connected);
        const newest = connected[connected.length - 1];
        if (newest) {
          if (!supportsTouch) setTouchForced(false);
          router.releaseSource(newest.player, 'touch');
          setToast(
            `${newest.id.replace(/\s*\([^)]*\)\s*/g, ' ').trim()} — player ${newest.player + 1}`,
          );
          if (toastTimer) clearTimeout(toastTimer);
          toastTimer = setTimeout(() => setToast(null), 2600);
        }
      },
    });

    const flushOnHide = () => {
      if (saveTimer) flushSave();
    };
    window.addEventListener('pagehide', flushOnHide);
    document.addEventListener('visibilitychange', flushOnHide);

    void (async () => {
      try {
        const [{ NativeGameRuntime }, { isNativeGameId, loadNativeGame }] = await Promise.all([
          import('@/native/NativeGameRuntime'),
          import('@/native/games/registry'),
        ]);
        if (cancelled) return;
        if (!isNativeGameId(entry)) throw new Error(`Unknown game "${entry}".`);

        const game = await loadNativeGame(entry);
        if (cancelled) return;

        runtime = new NativeGameRuntime({
          canvas,
          game,
          players: players.max,
          onError: (error) => {
            if (cancelled) return;
            setStatus('error');
            setErrorMessage(error.message);
          },
          onFirstFrame: () => {
            if (cancelled) return;
            setBooted(true);
            // Same dwell as retro: opening a game is not playing it.
            dwellTimer = setTimeout(() => {
              if (!cancelled) playActivity.record(slug);
            }, 5000);
          },
          onSaveDirty: () => {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(flushSave, 700);
          },
        });
        runtimeRef.current = runtime;

        await runtime.load();
        if (cancelled) return;

        const existing = readSave(slug);
        if (existing) runtime.loadSave(existing);
        setStatus('ready');

        // Desktop starts immediately; a touch device waits for the Play tap,
        // which is also the gesture audio needs.
        if (!window.matchMedia('(pointer: coarse)').matches) {
          runtime.start();
          setStarted(true);
        }
      } catch (error: unknown) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      if (saveTimer) flushSave();
      cancelled = true;
      if (toastTimer) clearTimeout(toastTimer);
      if (dwellTimer) clearTimeout(dwellTimer);
      window.removeEventListener('pagehide', flushOnHide);
      document.removeEventListener('visibilitychange', flushOnHide);
      unbindKeyboard();
      unbindGamepad();
      runtime?.destroy();
      runtimeRef.current = null;
      routerRef.current = null;
    };
  }, [entry, slug, players.max, multiplayer, supportsTouch, slots]);

  /**
   * Whether a keyboard counts as a person sitting down.
   *
   * The binding is always attached — a Bluetooth keyboard can appear at any
   * moment and typing should work the instant it does — but on a touch device
   * nobody is at it, and claiming otherwise would report a phone as a full
   * two-player couch.
   */
  useEffect(() => {
    if (isHandheld) {
      slots.detach('keyboard', 'p1');
      slots.detach('keyboard', 'p2');
      return;
    }
    if (multiplayer) {
      slots.attach({ kind: 'keyboard', key: 'p1', label: 'Keyboard' }, 0);
      slots.attach({ kind: 'keyboard', key: 'p2', label: 'Keyboard' }, 1);
    } else {
      slots.attach({ kind: 'keyboard', key: 'p1', label: 'Keyboard' }, 0);
    }
    return () => {
      slots.detach('keyboard', 'p1');
      slots.detach('keyboard', 'p2');
    };
  }, [slots, isHandheld, multiplayer]);

  // Browsers keep audio suspended until a gesture. resume() is idempotent, so
  // the first click or key press unlocks sound without disturbing the loop.
  useEffect(() => {
    if (!started || paused) return;
    const unlock = () => runtimeRef.current?.resume();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [started, paused]);

  /**
   * Hold the loop while a seat is empty.
   *
   * Ring Out used to run regardless, leaving player two as a statue being shoved
   * around a shrinking platform. Waiting is both kinder and more honest, and it
   * is player chrome rather than game logic — the `NativeGame` contract knows
   * nothing about this.
   */
  useEffect(() => {
    if (status !== 'ready' || !started || paused) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (!roomReady) runtime.pause();
    // Never resume into a backgrounded tab; that is the other pause's business.
    else if (!document.hidden) runtime.resume();
  }, [status, started, paused, roomReady]);

  // Stop burning battery in a backgrounded tab. Separate from user pause.
  useEffect(() => {
    let autoPaused = false;
    const onVisibility = () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      if (document.hidden && started && !paused) {
        runtime.pause();
        autoPaused = true;
      } else if (!document.hidden && autoPaused) {
        runtime.resume();
        autoPaused = false;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [started, paused]);

  const handlePlay = useCallback(() => {
    runtimeRef.current?.resume();
    setStarted(true);
    setPaused(false);
    setTouchForced(false);
  }, []);

  const togglePause = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const next = !paused;
    if (next) runtime.pause();
    else runtime.resume();
    setPaused(next);
  }, [paused]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    runtimeRef.current?.setMuted(next);
    setMuted(next);
  }, [muted]);

  const handleRestart = useCallback(() => {
    void runtimeRef.current?.reset();
    setPaused(false);
  }, []);

  const handleFullscreen = useCallback(() => {
    void document.documentElement.requestFullscreen?.();
  }, []);

  const handleTouchButton = useCallback((button: LogicalButton, pressed: boolean) => {
    routerRef.current?.set(0, 'touch', button, pressed);
  }, []);

  const releaseTouch = useCallback(() => {
    routerRef.current?.releaseSource(0, 'touch');
  }, []);

  const handheldActive = isHandheld && started && status === 'ready';
  const showTouchDeck =
    handheldActive && supportsTouch && (pads.length === 0 || touchForced);

  // The deck is a device like any other, so the panel can say what player one
  // is actually holding rather than assuming.
  useEffect(() => {
    if (!showTouchDeck) {
      slots.detach('touch', 'deck');
      return;
    }
    slots.attach({ kind: 'touch', key: 'deck', label: 'Touch' }, 0);
    return () => {
      slots.detach('touch', 'deck');
    };
  }, [slots, showTouchDeck]);

  /**
   * Swapping is offered only when it is unambiguous: one person is holding one
   * controller and might have wanted the other seat. With two pads there is
   * nothing to disambiguate, and with none there is nothing to move.
   */
  const claimedSlots = slotStates.filter((slot) => slot.claimed);
  const canSwap = multiplayer && claimedSlots.length === 1;
  const handleSwapPlayers = useCallback(() => {
    routerRef.current?.releaseAll();
    slots.swap(0, 1);
  }, [slots]);

  // Remote input is merged exactly like a pad's. The runtime is never told.
  const handleRemoteInput = useCallback(
    (player: number, button: LogicalButton, pressed: boolean) => {
      routerRef.current?.set(player, 'remote', button, pressed);
    },
    [],
  );
  const handleRemoteRelease = useCallback((player: number) => {
    routerRef.current?.releaseSource(player, 'remote');
  }, []);

  const room = useHostRoom({
    slots,
    title,
    onInput: handleRemoteInput,
    onReleasePlayer: handleRemoteRelease,
  });

  // A guest whose buttons are going nowhere should be told why rather than
  // concluding their phone is broken.
  const broadcastStatus = room.broadcastStatus;
  useEffect(() => {
    if (!room.code) return;
    broadcastStatus(paused, !roomReady);
  }, [room.code, broadcastStatus, paused, roomReady]);

  return (
    <div className={handheldActive ? 'handheld' : 'flex flex-col items-center'}>
      <div
        className={
          handheldActive
            ? 'handheld__stage'
            : 'group relative w-full max-w-[560px] rounded-xl border border-hairline bg-black p-2'
        }
      >
        <div
          onPointerDown={
            handheldActive && supportsTouch && pads.length > 0 && !touchForced
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
            width={320}
            height={288}
            data-testid="native-screen"
            className={
              handheldActive ? 'handheld__screen' : 'aspect-gb block w-full rounded-md'
            }
          />

          {status === 'error' ? (
            <div className="absolute inset-0 flex items-center justify-center rounded bg-black/85 px-6 text-center">
              <p className="max-w-sm text-xs leading-relaxed text-red-400">{errorMessage}</p>
            </div>
          ) : null}

          {status !== 'error' ? <BootOverlay ready={booted} /> : null}

          {status === 'ready' && started && !roomReady ? (
            <div
              data-testid="waiting-for-players"
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded bg-black/70 px-6 text-center backdrop-blur-[2px]"
            >
              <p className="text-sm text-foreground">Waiting for player two</p>
              <p className="max-w-[14rem] text-xs leading-relaxed text-muted">
                {title} needs someone in the second seat.
              </p>
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

      {handheldActive && supportsTouch ? (
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
            <ControlButton onClick={handleRestart} disabled={status !== 'ready'}>
              Restart
            </ControlButton>
            <ControlButton onClick={toggleMute} disabled={status !== 'ready'}>
              {muted ? 'Unmute' : 'Mute'}
            </ControlButton>
            <ControlButton onClick={handleFullscreen} disabled={status !== 'ready'}>
              Fullscreen
            </ControlButton>
          </div>

          {multiplayer ? (
            <>
              <PlayerSeats
                slots={slotStates}
                canSwap={canSwap}
                onSwap={handleSwapPlayers}
              />
              <div className="mt-3 flex justify-center">
                <InvitePanel
                  available={relayConfigured}
                  code={room.code}
                  joinUrl={room.joinUrl}
                  guests={room.guests}
                  connecting={room.state === 'connecting'}
                  onOpen={room.open}
                  onClose={room.close}
                />
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {/* Two thumb decks on one phone is still not a control scheme — but a
          second phone is. What used to be an honest dead end is now a way in. */}
      {isHandheld && !supportsTouch && !roomReady ? (
        <div className="mt-3 flex max-w-xs flex-col items-center gap-3 text-center">
          <p data-testid="touch-unsupported" className="text-xs text-muted">
            {title} needs a player in each seat. One screen cannot hold two
            people — but another phone can be the second controller.
          </p>
          <InvitePanel
            available={relayConfigured}
            code={room.code}
            joinUrl={room.joinUrl}
            guests={room.guests}
            connecting={room.state === 'connecting'}
            onOpen={room.open}
            onClose={room.close}
          />
        </div>
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

/**
 * Who is sitting where, and on what.
 *
 * The colours match the fighters in Ring Out — player one green, player two
 * amber — so the panel answers "which one am I" without saying it in words.
 * This is presence, not diagnostics: it names devices a person recognises
 * ("DualSense", "Keyboard"), never indexes or mappings. D-014 bars runtime
 * internals from player-facing UI and the same reasoning applies here.
 */
function PlayerSeats({
  slots,
  canSwap,
  onSwap,
}: {
  slots: readonly SlotState[];
  canSwap: boolean;
  onSwap: () => void;
}) {
  return (
    <div data-testid="player-seats" className="mt-3 flex flex-col items-center gap-2">
      <ul className="flex flex-wrap items-center justify-center gap-2">
        {slots.map((slot) => {
          const present = slot.devices.length > 0;
          // Several devices can feed one seat; name them all rather than
          // picking one and being wrong about what someone is holding.
          const labels = [...new Set(slot.devices.map((device) => device.label))];
          return (
            <li
              key={slot.player}
              data-testid={`seat-${slot.player}`}
              data-present={present ? 'true' : 'false'}
              className={[
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
                present
                  ? 'border-hairline-strong text-foreground'
                  : 'border-dashed border-hairline text-faint',
              ].join(' ')}
            >
              <span
                aria-hidden="true"
                className={[
                  'size-2 rounded-full',
                  present
                    ? slot.player === 0
                      ? 'bg-lcd'
                      : 'bg-amber-400'
                    : 'bg-transparent ring-1 ring-hairline-strong',
                ].join(' ')}
              />
              <span>P{slot.player + 1}</span>
              <span className="text-muted">{present ? labels.join(' + ') : 'Empty'}</span>
            </li>
          );
        })}
      </ul>

      {canSwap ? (
        <button
          type="button"
          onClick={onSwap}
          data-testid="swap-players"
          className="rounded-md border border-hairline px-2.5 py-1 text-[0.7rem] text-muted transition-colors hover:border-hairline-strong hover:text-foreground"
        >
          Switch seats
        </button>
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
