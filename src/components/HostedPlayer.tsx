'use client';

/**
 * React shell for a hosted game.
 *
 * A sibling of `NativePlayer` for the same reason that one is a sibling of
 * `GameBoyPlayer`: the value is in sharing the input layer, the save store and
 * the room, not in one component that knows three runtimes. What differs here
 * is only where the game lives — behind a sandboxed frame instead of on our own
 * canvas — and the player is not supposed to be able to tell (D-014).
 *
 * The sandbox is the security boundary and it is one attribute:
 * `sandbox="allow-scripts"` with **no** `allow-same-origin`, which gives the
 * frame an opaque origin and no reach into our DOM, cookies or storage.
 * `allow-same-origin` must never be added here; with `allow-scripts` alongside
 * it, a frame can remove its own sandbox attribute from the parent document.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { HostedGameAdapter } from '@/hosted/HostedGameAdapter';
import { IframePort } from '@/hosted/FramePort';
import { readSave, writeSave } from '@/emulation/core/saveStorage';
import { playActivity } from '@/storage/playActivity';
import type { HostedGame } from '@/hosted/manifest';

type Status = 'loading' | 'ready' | 'error';

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

export function HostedPlayer({ game }: { game: HostedGame }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const adapterRef = useRef<HostedGameAdapter | null>(null);
  const routerRef = useRef<InputRouter | null>(null);

  const isHandheld = useCoarsePointer();
  const multiplayer = game.players.max > 1;
  const needsCompany = game.players.min > 1;
  const supportsTouch = game.inputs.supported.includes('touch');

  const [slots] = useState(() => new PlayerSlots(Math.max(game.players.max, 1)));
  const slotStates = useSyncExternalStore(
    useCallback((notify) => slots.subscribe(notify), [slots]),
    useCallback(() => slots.snapshot(), [slots]),
    useCallback(() => slots.snapshot(), [slots]),
  );
  const presentPlayers = slotStates.filter((slot) => slot.devices.length > 0).length;
  const roomReady = !needsCompany || presentPlayers >= game.players.min;

  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [booted, setBooted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pads, setPads] = useState<GamepadInfo[]>([]);
  const [touchForced, setTouchForced] = useState(false);
  const [aspect, setAspect] = useState('10 / 9');

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let cancelled = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;

    const flushSave = () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      // Fire and forget: the adapter resolves null rather than hanging if the
      // frame does not answer, which is what makes this safe on pagehide.
      void adapterRef.current?.readSave().then((data) => {
        if (data && data.byteLength > 0) writeSave(game.slug, data);
      });
    };

    const router = new InputRouter((player, button, pressed) =>
      adapterRef.current?.setButton(player, button, pressed),
    );
    routerRef.current = router;

    const adapter = new HostedGameAdapter({
      port: new IframePort(frame),
      players: game.players.max,
      onError: (error) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(error.message);
      },
      onFirstFrame: () => {
        if (cancelled) return;
        setBooted(true);
        setStatus('ready');
        dwellTimer = setTimeout(() => {
          if (!cancelled) playActivity.record(game.slug);
        }, 5000);
        const existing = readSave(game.slug);
        if (existing) adapter.loadSave(existing);
        // Desktop starts as soon as the game has drawn; a touch device waits
        // for the Play tap, which is also the gesture audio needs. Done here
        // rather than in the effect body because the frame is the external
        // system being synchronised with, and it has only just become ready.
        if (!window.matchMedia('(pointer: coarse)').matches) {
          adapter.start();
          setStarted(true);
        }
      },
      onSaveDirty: () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(flushSave, 700);
      },
      onResolution: ({ width, height }) => {
        if (!cancelled) setAspect(`${width} / ${height}`);
      },
    });
    adapterRef.current = adapter;

    const unbindKeyboard = multiplayer
      ? (() => {
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
      maxPlayers: game.players.max,
      slots,
      onButton: (player, button, pressed) => router.set(player, 'gamepad', button, pressed),
      onConnectionChange: (connected) => {
        if (cancelled) return;
        setPads(connected);
        const newest = connected[connected.length - 1];
        if (newest) router.releaseSource(newest.player, 'touch');
      },
    });

    const flushOnHide = () => {
      if (saveTimer) flushSave();
    };
    window.addEventListener('pagehide', flushOnHide);
    document.addEventListener('visibilitychange', flushOnHide);

    return () => {
      if (saveTimer) flushSave();
      cancelled = true;
      if (dwellTimer) clearTimeout(dwellTimer);
      window.removeEventListener('pagehide', flushOnHide);
      document.removeEventListener('visibilitychange', flushOnHide);
      unbindKeyboard();
      unbindGamepad();
      adapter.destroy();
      adapterRef.current = null;
      routerRef.current = null;
    };
  }, [game.slug, game.players.max, multiplayer, slots]);

  useEffect(() => {
    if (isHandheld) {
      slots.detach('keyboard', 'p1');
      slots.detach('keyboard', 'p2');
      return;
    }
    slots.attach({ kind: 'keyboard', key: 'p1', label: 'Keyboard' }, 0);
    if (multiplayer) slots.attach({ kind: 'keyboard', key: 'p2', label: 'Keyboard' }, 1);
    return () => {
      slots.detach('keyboard', 'p1');
      slots.detach('keyboard', 'p2');
    };
  }, [slots, isHandheld, multiplayer]);

  // Hold the game while a seat is empty, exactly as a native game does.
  useEffect(() => {
    if (status !== 'ready' || !started || paused) return;
    const adapter = adapterRef.current;
    if (!adapter) return;
    if (!roomReady) adapter.pause();
    else if (!document.hidden) adapter.resume();
  }, [status, started, paused, roomReady]);

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
    title: game.title,
    onInput: handleRemoteInput,
    onReleasePlayer: handleRemoteRelease,
  });

  const handlePlay = useCallback(() => {
    adapterRef.current?.start();
    setStarted(true);
    setPaused(false);
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
    const next = !muted;
    adapterRef.current?.setMuted(next);
    setMuted(next);
  }, [muted]);

  const handleRestart = useCallback(() => {
    adapterRef.current?.reset();
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

  const claimed = slotStates.filter((slot) => slot.claimed).length;
  const handleSwapPlayers = useCallback(() => {
    routerRef.current?.releaseAll();
    slots.swap(0, 1);
  }, [slots]);

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
          <iframe
            ref={frameRef}
            src={game.frameUrl}
            title={game.title}
            data-testid="hosted-frame"
            /* The security boundary. `allow-same-origin` must never be added:
               together with `allow-scripts` a frame could strip its own sandbox
               attribute from the parent document and escape entirely. */
            sandbox="allow-scripts"
            /* Delegated capabilities, not origin access. Autoplay so a game can
               make sound once the page has activation; fullscreen so the
               player's fullscreen button reaches the game. */
            allow="autoplay; fullscreen; gamepad"
            style={{ aspectRatio: aspect }}
            className={
              handheldActive
                ? 'handheld__screen border-0'
                : 'block w-full rounded-md border-0 bg-black'
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
                {game.title} needs someone in the second seat.
              </p>
            </div>
          ) : null}

          {status !== 'error' && !started ? (
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
              <span className="sr-only">Play {game.title}</span>
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
                canSwap={claimed === 1}
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
    </div>
  );
}

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
