"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SAVE_BYTES = exports.GBS_BUTTONS = exports.SUPPORTED_PROTOCOL_VERSIONS = exports.FRAME_PROTOCOL_VERSION = void 0;
exports.parseFrameMessage = parseFrameMessage;
exports.parseHostMessage = parseHostMessage;
/**
 * Bumped when a message shape changes incompatibly.
 *
 * This is a compatibility contract now, not a private detail (D-021): the host
 * supports this version and the previous supported one, and a bundle outside
 * that range is refused before play rather than failing during it.
 */
exports.FRAME_PROTOCOL_VERSION = 1;
/**
 * Versions a host will still talk to. Dropping one is a deliberate act with a
 * note, not a side effect of a refactor.
 */
exports.SUPPORTED_PROTOCOL_VERSIONS = [1];
/**
 * The eight buttons every GameBoyStudio input source produces.
 *
 * Declared here, not imported, so this package stands alone. It must stay equal
 * to the application's `GbsButton`; a type-level assertion in the app holds
 * the two together, and a mismatch is a compile error rather than a silent
 * divergence.
 */
exports.GBS_BUTTONS = [
    'up',
    'down',
    'left',
    'right',
    'a',
    'b',
    'start',
    'select',
];
/** Guards against a hostile or broken frame flooding the host. */
exports.MAX_SAVE_BYTES = 512 * 1024;
/* --- Validation ----------------------------------------------------------- */
const BUTTONS = new Set(exports.GBS_BUTTONS);
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
/**
 * Parses a message from the frame.
 *
 * Returns null rather than throwing for anything unrecognised. A hosted game is
 * code we did not write running in a sandbox; the only thing that stops it
 * confusing the host is that nothing unvalidated gets past here.
 */
function parseFrameMessage(value) {
    if (!isRecord(value) || typeof value.t !== 'string')
        return null;
    switch (value.t) {
        case 'hello':
            if (typeof value.v !== 'number')
                return null;
            if (typeof value.width !== 'number' || typeof value.height !== 'number')
                return null;
            if (!Number.isInteger(value.width) || !Number.isInteger(value.height))
                return null;
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
            if (!(data instanceof Uint8Array))
                return null;
            if (data.byteLength === 0 || data.byteLength > exports.MAX_SAVE_BYTES)
                return null;
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
function parseHostMessage(value) {
    if (!isRecord(value) || typeof value.t !== 'string')
        return null;
    switch (value.t) {
        case 'load':
            if (typeof value.v !== 'number')
                return null;
            if (typeof value.players !== 'number' || !Number.isInteger(value.players))
                return null;
            if (value.players < 1 || value.players > 8)
                return null;
            if (typeof value.muted !== 'boolean')
                return null;
            return { t: 'load', v: value.v, players: value.players, muted: value.muted };
        case 'input':
            if (typeof value.player !== 'number' || !Number.isInteger(value.player))
                return null;
            if (value.player < 0 || value.player > 7)
                return null;
            if (typeof value.button !== 'string' || !BUTTONS.has(value.button))
                return null;
            if (typeof value.pressed !== 'boolean')
                return null;
            return {
                t: 'input',
                player: value.player,
                button: value.button,
                pressed: value.pressed,
            };
        case 'mute':
            if (typeof value.muted !== 'boolean')
                return null;
            return { t: 'mute', muted: value.muted };
        case 'restore': {
            const data = value.data;
            if (!(data instanceof Uint8Array))
                return null;
            if (data.byteLength > exports.MAX_SAVE_BYTES)
                return null;
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
