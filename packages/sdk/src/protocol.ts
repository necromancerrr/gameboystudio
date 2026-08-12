/**
 * The frame protocol: what the host and a hosted game say to each other.
 *
 * This file lives in the SDK rather than the application because the SDK is the
 * authoring boundary (D-020): a game is built against the package, so the
 * package has to be where the contract is defined. The application imports it
 * from here, which is what keeps host and guest from drifting apart.
 *
 * The verbs are deliberately the ones the player component already calls —
 * load, start, pause, resume, reset, setMuted, readSave, loadSave, destroy —
 * because that is what makes this an adapter alongside `BinjgbAdapter` and
 * `NativeGameRuntime` rather than a second architecture. A verb that no player
 * control maps onto does not belong here; without that rule this becomes an
 * engine by accretion (D-018).
 *
 * The button vocabulary is declared here too, rather than imported from the
 * application's input layer. A package that reached back into the application
 * for its own types would not be installable anywhere else, which is the whole
 * thing M6 is trying to fix.
 *
 * Two security facts shape the details:
 *
 * 1. The frame has an **opaque origin**, because it is sandboxed without
 *    `allow-same-origin`. So its messages arrive with `origin: "null"` and the
 *    origin cannot be used to identify it — the host must check `event.source`
 *    against the iframe's own `contentWindow` instead.
 * 2. For the same reason the host must post with `targetOrigin: '*'`. That is
 *    safe only because nothing sent to a game is a secret: lifecycle verbs,
 *    button edges, and the game's own save data. Nothing else may ever be added
 *    to a host-to-frame message.
 */

/**
 * Bumped when a message shape changes incompatibly.
 *
 * This is a compatibility contract now, not a private detail (D-021): the host
 * supports this version and the previous supported one, and a bundle outside
 * that range is refused before play rather than failing during it.
 */
export const FRAME_PROTOCOL_VERSION = 1;

/**
 * Versions a host will still talk to. Dropping one is a deliberate act with a
 * note, not a side effect of a refactor.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1];

/**
 * The eight buttons every GameBoyStudio input source produces.
 *
 * Declared here, not imported, so this package stands alone. It must stay equal
 * to the application's `GbsButton`; a type-level assertion in the app holds
 * the two together, and a mismatch is a compile error rather than a silent
 * divergence.
 */
export const GBS_BUTTONS = [
  'up',
  'down',
  'left',
  'right',
  'a',
  'b',
  'start',
  'select',
] as const;

export type GbsButton = (typeof GBS_BUTTONS)[number];

/** Guards against a hostile or broken frame flooding the host. */
export const MAX_SAVE_BYTES = 512 * 1024;

/* --- Host to frame -------------------------------------------------------- */

export interface LoadMessage {
  t: 'load';
  v: number;
  /** How many players this session has, so the game can size its state. */
  players: number;
  muted: boolean;
}

export interface InputMessage {
  t: 'input';
  player: number;
  button: GbsButton;
  pressed: boolean;
}

export interface MuteMessage {
  t: 'mute';
  muted: boolean;
}

export interface RestoreMessage {
  t: 'restore';
  data: Uint8Array;
}

export interface SimpleHostMessage {
  t: 'start' | 'pause' | 'resume' | 'reset' | 'readSave' | 'destroy';
}

export type HostMessage =
  | LoadMessage
  | InputMessage
  | MuteMessage
  | RestoreMessage
  | SimpleHostMessage;

/* --- Frame to host -------------------------------------------------------- */

/** The handshake. Sent unprompted once the game's code is running. */
export interface HelloMessage {
  t: 'hello';
  v: number;
  /** The game's own resolution, so the host can size the frame correctly. */
  width: number;
  height: number;
}

export interface FrameErrorMessage {
  t: 'error';
  message: string;
}

export interface SaveMessage {
  t: 'save';
  data: Uint8Array;
}

export interface SimpleFrameMessage {
  /** `painted` is the first visible frame, which retires the boot overlay. */
  t: 'ready' | 'painted' | 'saveDirty';
}

export type FrameMessage =
  | HelloMessage
  | FrameErrorMessage
  | SaveMessage
  | SimpleFrameMessage;

/* --- Validation ----------------------------------------------------------- */

const BUTTONS: ReadonlySet<string> = new Set(GBS_BUTTONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parses a message from the frame.
 *
 * Returns null rather than throwing for anything unrecognised. A hosted game is
 * code we did not write running in a sandbox; the only thing that stops it
 * confusing the host is that nothing unvalidated gets past here.
 */
export function parseFrameMessage(value: unknown): FrameMessage | null {
  if (!isRecord(value) || typeof value.t !== 'string') return null;

  switch (value.t) {
    case 'hello':
      if (typeof value.v !== 'number') return null;
      if (typeof value.width !== 'number' || typeof value.height !== 'number') return null;
      if (!Number.isInteger(value.width) || !Number.isInteger(value.height)) return null;
      if (value.width < 1 || value.height < 1 || value.width > 4096 || value.height > 4096) {
        return null;
      }
      return { t: 'hello', v: value.v, width: value.width, height: value.height };

    case 'error':
      return {
        t: 'error',
        message: typeof value.message === 'string' ? value.message.slice(0, 500) : 'unknown error',
      };

    case 'save': {
      const data = value.data;
      if (!(data instanceof Uint8Array)) return null;
      if (data.byteLength === 0 || data.byteLength > MAX_SAVE_BYTES) return null;
      return { t: 'save', data };
    }

    case 'ready':
    case 'painted':
    case 'saveDirty':
      return { t: value.t };

    default:
      return null;
  }
}

/**
 * Parses a message from the host, inside the frame.
 *
 * The guest validates too. The host is trusted, but a game that crashes on an
 * unexpected message is a game that breaks when the protocol gains a verb it
 * does not know.
 */
export function parseHostMessage(value: unknown): HostMessage | null {
  if (!isRecord(value) || typeof value.t !== 'string') return null;

  switch (value.t) {
    case 'load':
      if (typeof value.v !== 'number') return null;
      if (typeof value.players !== 'number' || !Number.isInteger(value.players)) return null;
      if (value.players < 1 || value.players > 8) return null;
      if (typeof value.muted !== 'boolean') return null;
      return { t: 'load', v: value.v, players: value.players, muted: value.muted };

    case 'input':
      if (typeof value.player !== 'number' || !Number.isInteger(value.player)) return null;
      if (value.player < 0 || value.player > 7) return null;
      if (typeof value.button !== 'string' || !BUTTONS.has(value.button)) return null;
      if (typeof value.pressed !== 'boolean') return null;
      return {
        t: 'input',
        player: value.player,
        button: value.button as GbsButton,
        pressed: value.pressed,
      };

    case 'mute':
      if (typeof value.muted !== 'boolean') return null;
      return { t: 'mute', muted: value.muted };

    case 'restore': {
      const data = value.data;
      if (!(data instanceof Uint8Array)) return null;
      if (data.byteLength > MAX_SAVE_BYTES) return null;
      return { t: 'restore', data };
    }

    case 'start':
    case 'pause':
    case 'resume':
    case 'reset':
    case 'readSave':
    case 'destroy':
      return { t: value.t };

    default:
      return null;
  }
}
