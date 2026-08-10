/**
 * The guest half of a room: a phone that has become a controller.
 *
 * It sends button edges and receives room business. It never receives gameplay,
 * because in M4 the host owns the only screen — the guest is looking at the
 * host's television, not at a stream. That is the ceiling D-016 accepted, and
 * this class is deliberately small enough to make the later frames/state
 * channels an addition rather than a rewrite.
 */

import type { LogicalButton } from '@/emulation/core/types';
import type { RemoteTransport, TransportState } from './RemoteTransport';
import {
  PROTOCOL_VERSION,
  encodeMessage,
  isControlPayload,
  parseMessage,
  type ControlPayload,
  type ServerMessage,
} from './protocol';

export interface GuestSeat {
  slot: number;
  title: string;
}

export interface GuestLinkOptions {
  transport: RemoteTransport;
  code: string;
  onSeat(seat: GuestSeat | null): void;
  /** 'full' when every seat was taken; the page has to say so. */
  onRejected(reason: 'full' | 'no-room' | 'bad-version' | 'closed'): void;
  onStatus?(status: { paused: boolean; waiting: boolean }): void;
  onStateChange?(state: TransportState): void;
}

export class GuestLink {
  private readonly options: GuestLinkOptions;
  private readonly unsubscribes: (() => void)[] = [];
  /** What we believe is down, so a reconnect can start from a clean slate. */
  private readonly held = new Set<LogicalButton>();
  private seat: GuestSeat | null = null;
  private closed = false;

  constructor(options: GuestLinkOptions) {
    this.options = options;
    const { transport } = options;

    this.unsubscribes.push(transport.onFrame((frame) => this.handleFrame(frame)));
    this.unsubscribes.push(
      transport.onStateChange((state) => {
        options.onStateChange?.(state);
        if (state === 'closed') {
          // Locally forget everything held. The host does its own release when
          // it sees the peer go, but a phone that reconnects must not believe
          // it is still holding a direction from before the drop.
          this.held.clear();
          this.seat = null;
          options.onSeat(null);
        }
      }),
    );

    transport.send(encodeMessage({ t: 'join', v: PROTOCOL_VERSION, code: options.code }));
  }

  get currentSeat(): GuestSeat | null {
    return this.seat;
  }

  /** Sends an edge only when it is one, so a held button is one message. */
  setButton(button: LogicalButton, pressed: boolean): void {
    if (this.closed || !this.seat) return;
    if (pressed === this.held.has(button)) return;
    if (pressed) this.held.add(button);
    else this.held.delete(button);
    this.options.transport.send(
      encodeMessage({ t: 'msg', ch: 'input', d: { b: button, p: pressed } }),
    );
  }

  /** Used when the controller page hides — a backgrounded phone holds nothing. */
  releaseAll(): void {
    for (const button of [...this.held]) this.setButton(button, false);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseAll();
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.options.transport.close();
  }

  private handleFrame(frame: string): void {
    const message = parseMessage<ServerMessage>(frame);
    if (!message) return;

    if (message.t === 'err') {
      this.options.onRejected(
        message.code === 'no-room' || message.code === 'bad-version' ? message.code : 'closed',
      );
      return;
    }
    if (message.t === 'gone') {
      // The host left. Without a screen there is nothing to control.
      this.seat = null;
      this.options.onSeat(null);
      this.options.onRejected('closed');
      return;
    }
    if (message.t !== 'msg' || message.ch !== 'control') return;
    if (!isControlPayload(message.d)) return;
    this.applyControl(message.d);
  }

  private applyControl(payload: ControlPayload): void {
    switch (payload.c) {
      case 'seat':
        this.seat = { slot: payload.slot, title: payload.title };
        this.options.onSeat(this.seat);
        return;
      case 'full':
        this.options.onRejected('full');
        return;
      case 'status':
        this.options.onStatus?.({ paused: payload.paused, waiting: payload.waiting });
        return;
      default:
        return;
    }
  }
}
