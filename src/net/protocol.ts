/**
 * The room protocol.
 *
 * A room is a session with typed channels, not a pipe for button presses. That
 * distinction is the whole reason this file exists: a protocol that only knows
 * how to carry button edges would box out video and state sync even behind a
 * swappable transport, and D-016 is explicit that M4 must not do that.
 *
 * M4 implements exactly one channel. `frames` and `state` are reserved names,
 * rejected by the relay — not stubs, not empty handlers, not speculative code.
 * Reserving a name costs two identifiers and makes the later addition an
 * additive protocol change rather than a redesign.
 *
 * Everything here is shared by the browser and the relay, so it must stay free
 * of both DOM and Workers APIs.
 */

import type { LogicalButton } from '@/emulation/core/types';

/** Bumped when a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 1;

export const CHANNELS = ['control', 'input', 'frames', 'state'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * What the relay will actually carry today.
 *
 * `control` is room business — which seat you got, whether the game is paused.
 * `input` is the one gameplay channel M4 builds. `frames` (host video) and
 * `state` (simulation snapshots) are the two ways different-places play could
 * work; see D-016 for why neither is being built yet. The relay rejects them,
 * so a client cannot quietly start using one.
 */
export const IMPLEMENTED_CHANNELS: readonly Channel[] = ['control', 'input'];

/** Room codes avoid vowels and lookalikes, so nobody reads a code out wrong. */
export const CODE_ALPHABET = '23456789ACDEFGHJKLMNPQRTUVWXYZ';
export const CODE_LENGTH = 6;

/** A generous ceiling for an input message, and a hard one for anything else. */
export const MAX_FRAME_BYTES = 1024;

export type PeerId = string;
export type Role = 'host' | 'guest';

/* --- Client to relay ------------------------------------------------------ */

export interface HostMessage {
  t: 'host';
  v: number;
}

export interface JoinMessage {
  t: 'join';
  v: number;
  code: string;
}

/**
 * Payload is opaque to the relay. It validates the envelope — channel, size,
 * rate — and forwards; it never inspects or stores what is inside.
 */
export interface RelayMessage {
  t: 'msg';
  ch: Channel;
  /** Omitted broadcasts to everyone else in the room. */
  to?: PeerId;
  d: unknown;
}

export type ClientMessage = HostMessage | JoinMessage | RelayMessage;

/* --- Relay to client ------------------------------------------------------ */

export interface RoomOpenedMessage {
  t: 'room';
  code: string;
  peer: PeerId;
}

export interface WelcomeMessage {
  t: 'welcome';
  peer: PeerId;
  code: string;
}

export interface PeerJoinedMessage {
  t: 'peer';
  peer: PeerId;
}

export interface PeerLeftMessage {
  t: 'gone';
  peer: PeerId;
}

export interface DeliverMessage {
  t: 'msg';
  ch: Channel;
  from: PeerId;
  d: unknown;
}

/** Terminal: the relay closes the socket immediately after sending one. */
export interface ErrorMessage {
  t: 'err';
  code: 'no-room' | 'room-full' | 'bad-version' | 'bad-message' | 'too-fast' | 'closed';
  detail?: string;
}

export type ServerMessage =
  | RoomOpenedMessage
  | WelcomeMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | DeliverMessage
  | ErrorMessage;

/* --- The input channel ---------------------------------------------------- */

/**
 * One button edge. Guests send these; the host merges them into its router as
 * the `remote` source. There is no analog, no timestamp and no sequence number:
 * the host owns the simulation, so a message is only ever "this button is down
 * now", and a lost one is corrected by the next edge or by the release sweep
 * that runs when a guest disconnects.
 */
export interface InputPayload {
  b: LogicalButton;
  p: boolean;
}

const BUTTONS: ReadonlySet<string> = new Set([
  'up',
  'down',
  'left',
  'right',
  'a',
  'b',
  'start',
  'select',
]);

export function isInputPayload(value: unknown): value is InputPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.b === 'string' && BUTTONS.has(payload.b) && typeof payload.p === 'boolean';
}

/* --- The control channel -------------------------------------------------- */

/**
 * Room business, host to guest. Kept separate from `input` so that "which seat
 * am I" never rides on the same channel as gameplay, where it would have to be
 * filtered out of the hot path.
 */
export type ControlPayload =
  /** You are player `slot`, playing `title`. */
  | { c: 'seat'; slot: number; title: string }
  /** Every seat is taken; the guest page says so rather than sitting blank. */
  | { c: 'full' }
  /** So a guest whose buttons do nothing can be told why. */
  | { c: 'status'; paused: boolean; waiting: boolean };

export function isControlPayload(value: unknown): value is ControlPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  switch (payload.c) {
    case 'seat':
      return typeof payload.slot === 'number' && typeof payload.title === 'string';
    case 'full':
      return true;
    case 'status':
      return typeof payload.paused === 'boolean' && typeof payload.waiting === 'boolean';
    default:
      return false;
  }
}

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

export function isImplementedChannel(value: unknown): value is Channel {
  return isChannel(value) && IMPLEMENTED_CHANNELS.includes(value);
}

export function isRoomCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === CODE_LENGTH &&
    [...value].every((character) => CODE_ALPHABET.includes(character))
  );
}

/**
 * Parses a frame from the wire.
 *
 * Returns null rather than throwing for anything malformed, because this runs
 * on input from strangers: a room code is a capability and the relay is public,
 * so every frame is treated as hostile until it parses.
 */
export function parseMessage<T>(frame: string, limit = MAX_FRAME_BYTES): T | null {
  if (frame.length > limit) return null;
  try {
    const value: unknown = JSON.parse(frame);
    if (typeof value !== 'object' || value === null) return null;
    if (typeof (value as { t?: unknown }).t !== 'string') return null;
    return value as T;
  } catch {
    return null;
  }
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
