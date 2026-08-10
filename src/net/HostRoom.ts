/**
 * The host half of a room.
 *
 * Its entire job is to turn a remote device into a player slot and its button
 * messages into router input. Nothing above it — not the runtime, not the game,
 * not `BinjgbAdapter` — learns that a network exists, which is the whole claim
 * D-016 makes about putting multiplayer in the input layer.
 *
 * The rule that matters most here is the one D-010 learned from a yanked USB
 * cable: a device that disappears mid-press must not leave a button held down.
 * Over a network that is not an edge case, it is Tuesday — phones lock, Wi-Fi
 * drops, people walk out of range. Every path that removes a guest releases
 * what it was holding.
 */

import type { PlayerSlots } from '@/input/PlayerSlots';
import type { PlayerIndex } from '@/input/InputRouter';
import type { LogicalButton } from '@/emulation/core/types';
import type { RemoteTransport, TransportState } from './RemoteTransport';
import {
  PROTOCOL_VERSION,
  encodeMessage,
  isInputPayload,
  parseMessage,
  type ControlPayload,
  type PeerId,
  type ServerMessage,
} from './protocol';

export interface HostRoomOptions {
  transport: RemoteTransport;
  slots: PlayerSlots;
  /** Shown to the guest so their phone says what they are playing. */
  title: string;
  onInput(player: PlayerIndex, button: LogicalButton, pressed: boolean): void;
  /** Every guest holding a button for this player should let go. */
  onReleasePlayer(player: PlayerIndex): void;
  onCode(code: string | null): void;
  onStateChange?(state: TransportState): void;
}

export class HostRoom {
  private readonly options: HostRoomOptions;
  private readonly unsubscribes: (() => void)[] = [];
  /** peer -> the slot they were given. */
  private readonly seats = new Map<PeerId, PlayerIndex>();
  private code: string | null = null;
  private closed = false;

  constructor(options: HostRoomOptions) {
    this.options = options;
    const { transport } = options;

    this.unsubscribes.push(transport.onFrame((frame) => this.handleFrame(frame)));
    this.unsubscribes.push(
      transport.onStateChange((state) => {
        options.onStateChange?.(state);
        // The relay going away takes every guest with it.
        if (state === 'closed') this.evictEveryone();
      }),
    );

    transport.send(encodeMessage({ t: 'host', v: PROTOCOL_VERSION }));
  }

  get roomCode(): string | null {
    return this.code;
  }

  get guestCount(): number {
    return this.seats.size;
  }

  /** Tells every guest whether their buttons are currently doing anything. */
  broadcastStatus(paused: boolean, waiting: boolean): void {
    this.sendControl(undefined, { c: 'status', paused, waiting });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.evictEveryone();
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.options.transport.close();
    this.code = null;
    this.options.onCode(null);
  }

  private handleFrame(frame: string): void {
    const message = parseMessage<ServerMessage>(frame);
    if (!message) return;

    switch (message.t) {
      case 'room':
        this.code = message.code;
        this.options.onCode(message.code);
        return;
      case 'peer':
        this.admit(message.peer);
        return;
      case 'gone':
        this.evict(message.peer);
        return;
      case 'msg':
        this.deliver(message.from, message.ch, message.d);
        return;
      case 'err':
        // Nothing recoverable: a host whose room was refused has no room.
        this.close();
        return;
      default:
        return;
    }
  }

  private admit(peer: PeerId): void {
    const slot = this.options.slots.attach({
      kind: 'remote',
      key: peer,
      label: 'Phone',
    });
    if (slot === null) {
      // Better a phone that says the game is full than one that looks connected
      // and does nothing.
      this.sendControl(peer, { c: 'full' });
      return;
    }
    this.seats.set(peer, slot);
    this.sendControl(peer, { c: 'seat', slot, title: this.options.title });
  }

  private evict(peer: PeerId): void {
    const slot = this.seats.get(peer);
    this.seats.delete(peer);
    this.options.slots.detach('remote', peer);
    // Order matters: drop the buttons before the seat is reused, or a new guest
    // inherits a direction the last one was holding when their phone locked.
    if (slot !== undefined) this.options.onReleasePlayer(slot);
  }

  private evictEveryone(): void {
    for (const peer of [...this.seats.keys()]) this.evict(peer);
  }

  private deliver(from: PeerId, channel: string, payload: unknown): void {
    if (channel !== 'input') return;
    const slot = this.seats.get(from);
    // A message from someone with no seat is not an error worth surfacing; it
    // is a guest whose eviction and last button press crossed on the wire.
    if (slot === undefined) return;
    if (!isInputPayload(payload)) return;
    this.options.onInput(slot, payload.b, payload.p);
  }

  private sendControl(to: PeerId | undefined, payload: ControlPayload): void {
    this.options.transport.send(encodeMessage({ t: 'msg', ch: 'control', to, d: payload }));
  }
}
