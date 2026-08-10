'use client';

/**
 * Opens a room, on purpose and never by accident.
 *
 * D-017 promises that single-player pages make no network request to the relay.
 * That promise lives here: nothing connects until `open()` is called, which
 * happens only when a player asks to invite someone. A game page that nobody
 * invites anyone to behaves exactly as it did before M4.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogicalButton } from '@/emulation/core/types';
import type { PlayerIndex } from '@/input/InputRouter';
import type { PlayerSlots } from '@/input/PlayerSlots';
import { HostRoom } from './HostRoom';
import { WebSocketTransport, type TransportState } from './RemoteTransport';

/**
 * Where the relay lives. Unset means the feature is simply not offered, which
 * is the right behaviour for a build that has no Worker deployed rather than
 * an Invite button that fails when pressed.
 */
const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? '';

export const relayConfigured = RELAY_URL.length > 0;

export interface HostRoomHandle {
  code: string | null;
  state: TransportState | 'idle';
  guests: number;
  /** Absolute URL a phone can open. Null until the room exists. */
  joinUrl: string | null;
  open(): void;
  close(): void;
  /** Tells guests whether their buttons are currently reaching a running game. */
  broadcastStatus(paused: boolean, waiting: boolean): void;
}

export interface UseHostRoomOptions {
  slots: PlayerSlots;
  title: string;
  onInput(player: PlayerIndex, button: LogicalButton, pressed: boolean): void;
  onReleasePlayer(player: PlayerIndex): void;
}

export function useHostRoom({
  slots,
  title,
  onInput,
  onReleasePlayer,
}: UseHostRoomOptions): HostRoomHandle {
  const roomRef = useRef<HostRoom | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<TransportState | 'idle'>('idle');
  const [guests, setGuests] = useState(0);

  // The callbacks change identity on every render of the player; the room must
  // not be rebuilt for that, so they are read through refs.
  const inputRef = useRef(onInput);
  const releaseRef = useRef(onReleasePlayer);
  const titleRef = useRef(title);
  useEffect(() => {
    inputRef.current = onInput;
    releaseRef.current = onReleasePlayer;
    titleRef.current = title;
  });

  const close = useCallback(() => {
    roomRef.current?.close();
    roomRef.current = null;
    setCode(null);
    setState('idle');
    setGuests(0);
  }, []);

  const open = useCallback(() => {
    if (roomRef.current || !relayConfigured) return;
    setState('connecting');
    const room = new HostRoom({
      transport: new WebSocketTransport(`${RELAY_URL}/host`),
      slots,
      title: titleRef.current,
      onInput: (player, button, pressed) => inputRef.current(player, button, pressed),
      onReleasePlayer: (player) => releaseRef.current(player),
      onCode: (value) => setCode(value),
      onStateChange: (next) => {
        setState(next);
        if (next === 'closed') {
          roomRef.current = null;
          setCode(null);
          setGuests(0);
        }
      },
    });
    roomRef.current = room;
  }, [slots]);

  // Guest count is not pushed, so it is sampled. A room is a handful of people
  // and this only runs while one is open.
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => {
      setGuests(roomRef.current?.guestCount ?? 0);
    }, 500);
    return () => clearInterval(timer);
  }, [code]);

  // Leaving the page must take the room with it, or a phone keeps pressing
  // buttons at a game that is no longer on screen.
  useEffect(() => () => close(), [close]);

  const broadcastStatus = useCallback((paused: boolean, waiting: boolean) => {
    roomRef.current?.broadcastStatus(paused, waiting);
  }, []);

  const joinUrl =
    code && typeof window !== 'undefined'
      ? `${window.location.origin}/join?code=${code}`
      : null;

  return { code, state, guests, joinUrl, open, close, broadcastStatus };
}
