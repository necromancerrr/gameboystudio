'use client';

/**
 * A phone that has become a controller.
 *
 * The whole page is the deck. There is no game view, because in M4 the host
 * owns the only screen and the guest is looking at it across the room — see
 * D-016 for why streaming the picture was deliberately not built. Everything
 * here is therefore about answering one question at a glance: are my buttons
 * doing anything?
 *
 * It reuses `TouchControls`, so a guest gets the same deck the handheld player
 * does rather than a second-class one built in a hurry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { LogicalButton } from '@/emulation/core/types';
import { TouchControls } from '@/components/TouchControls';
import { GuestLink, type GuestSeat } from '@/net/GuestLink';
import { WebSocketTransport, type TransportState } from '@/net/RemoteTransport';
import { CODE_LENGTH, isRoomCode } from '@/net/protocol';
import { RELAY_URL, relayUrlIsUsable } from '@/net/relayConfig';

type Rejection = 'full' | 'no-room' | 'bad-version' | 'closed';

const REJECTION_TEXT: Record<Rejection, string> = {
  full: 'That game already has all its players.',
  'no-room': 'No game is using that code. Check it and try again.',
  'bad-version': 'This page is out of date. Reload and try again.',
  closed: 'The game ended.',
};

export function JoinController() {
  const params = useSearchParams();
  const codeFromUrl = (params.get('code') ?? '').toUpperCase();

  const [code, setCode] = useState(codeFromUrl);
  // Scanning a QR arrives with the code already in hand, so joining starts
  // immediately. Typing one is the fallback, not the main path. Initialised
  // rather than set from an effect, which would cost a cascading render.
  const [connected, setConnected] = useState(() => isRoomCode(codeFromUrl));
  const [seat, setSeat] = useState<GuestSeat | null>(null);
  const [state, setState] = useState<TransportState | 'idle'>('idle');
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [status, setStatus] = useState<{ paused: boolean; waiting: boolean } | null>(null);
  const linkRef = useRef<GuestLink | null>(null);

  const join = useCallback((next: string) => {
    if (!isRoomCode(next)) return;
    setRejection(null);
    setConnected(true);
  }, []);

  useEffect(() => {
    if (!connected || !isRoomCode(code) || !relayUrlIsUsable()) return;

    const link = new GuestLink({
      transport: new WebSocketTransport(`${RELAY_URL}/join?code=${code}`),
      code,
      onSeat: setSeat,
      onRejected: (reason) => {
        setRejection(reason);
        setConnected(false);
      },
      onStatus: setStatus,
      onStateChange: setState,
    });
    linkRef.current = link;

    return () => {
      link.close();
      linkRef.current = null;
      setSeat(null);
      setState('idle');
    };
  }, [connected, code]);

  /**
   * A phone that goes into a pocket must not leave a direction held. The host
   * releases everything when the socket drops, but backgrounding does not
   * always drop it quickly, and half a second of a stuck D-pad is a lost round.
   */
  useEffect(() => {
    const releaseOnHide = () => {
      if (document.hidden) linkRef.current?.releaseAll();
    };
    document.addEventListener('visibilitychange', releaseOnHide);
    window.addEventListener('pagehide', releaseOnHide);
    return () => {
      document.removeEventListener('visibilitychange', releaseOnHide);
      window.removeEventListener('pagehide', releaseOnHide);
    };
  }, []);

  // Nothing is more annoying than a controller that sleeps mid-game.
  useEffect(() => {
    if (!seat) return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      try {
        sentinel = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        // Refused or unsupported; the game still works, the screen just dims.
      }
    };
    void acquire();

    // iOS drops the lock whenever the page is backgrounded, so it is re-taken.
    const reacquire = () => {
      if (!released && !document.hidden) void acquire();
    };
    document.addEventListener('visibilitychange', reacquire);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', reacquire);
      void sentinel?.release().catch(() => {});
    };
  }, [seat]);

  const handleButton = useCallback((button: LogicalButton, pressed: boolean) => {
    linkRef.current?.setButton(button, pressed);
  }, []);

  const releaseAll = useCallback(() => {
    linkRef.current?.releaseAll();
  }, []);

  if (!RELAY_URL) {
    return (
      <Centered title="Joining is not available">
        <p>This copy of GameBoyStudio has no room relay configured.</p>
      </Centered>
    );
  }

  if (seat) {
    return (
      <div className="join">
        <header data-testid="join-header" className="join__header">
          <span className="join__seat" data-seat={seat.slot}>
            P{seat.slot + 1}
          </span>
          <span className="join__title">{seat.title}</span>
          <span
            data-testid="join-state"
            data-state={state}
            className="join__state"
            aria-label={state === 'open' ? 'Connected' : 'Reconnecting'}
          />
        </header>

        {status?.waiting || status?.paused ? (
          <p data-testid="join-status" className="join__status">
            {status.waiting ? 'Waiting for another player' : 'Paused on the main screen'}
          </p>
        ) : null}

        <TouchControls
          className="join__deck"
          onButton={handleButton}
          onReleaseAll={releaseAll}
        />
      </div>
    );
  }

  return (
    <Centered title="Join a game">
      {rejection ? (
        <p data-testid="join-error" className="text-red-400">
          {REJECTION_TEXT[rejection]}
        </p>
      ) : connected ? (
        <p data-testid="join-connecting">Connecting…</p>
      ) : null}

      <form
        className="flex flex-col items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          join(code);
        }}
      >
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, CODE_LENGTH))}
          placeholder="CODE"
          aria-label="Room code"
          data-testid="join-code-input"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="w-48 rounded-lg border border-hairline bg-surface px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] text-foreground focus:border-lcd-deep focus:outline-none"
        />
        <button
          type="submit"
          disabled={!isRoomCode(code)}
          data-testid="join-submit"
          className="rounded-md border border-hairline bg-surface px-4 py-2 text-sm text-muted transition-colors hover:border-hairline-strong hover:text-foreground disabled:opacity-40"
        >
          Join
        </button>
      </form>
    </Centered>
  );
}

function Centered({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-sm tracking-widest text-faint uppercase">{title}</h1>
      {children}
    </main>
  );
}
