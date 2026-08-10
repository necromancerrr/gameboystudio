/**
 * One room, as the relay sees it.
 *
 * Written against a tiny socket interface rather than against Workers or Node,
 * for two reasons. It runs unchanged inside a Durable Object and inside the
 * in-process test harness, so the thing being tested is the thing being
 * deployed. And it keeps every validation rule in one file, which matters
 * because D-017 ratified this relay on the promise that it stays small, blind
 * to payloads, and impossible to grow into a social backend by accident.
 *
 * What it does: hands out a code, joins guests to it, forwards messages.
 * What it never does: read payloads, store anything, or outlive its room.
 */

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  encodeMessage,
  isImplementedChannel,
  isRoomCode,
  parseMessage,
  type ClientMessage,
  type PeerId,
  type ServerMessage,
} from './protocol';

export interface ServerSocket {
  readonly id: PeerId;
  send(frame: string): void;
  close(): void;
}

type ErrorCode = 'no-room' | 'room-full' | 'bad-version' | 'bad-message' | 'too-fast' | 'closed';

export interface RoomServerOptions {
  /** Beyond the host. Two-player games need one; the ceiling is a guard. */
  maxGuests?: number;
  /** Milliseconds, injectable so the rate limiter is testable. */
  now?: () => number;
  /** Injectable so tests get a predictable code. */
  makeCode?: () => string;
}

/**
 * Generous for button edges — a fast player produces maybe 20 a second — and
 * far below what it takes to make a relay useful for anything else.
 */
const RATE_LIMIT = { perSecond: 80, burst: 120 };

interface Peer {
  socket: ServerSocket;
  role: 'host' | 'guest';
  tokens: number;
  lastRefill: number;
}

export function defaultCodeMaker(random: () => number = Math.random): () => string {
  return () => {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
    }
    return code;
  };
}

export class RoomServer {
  private readonly peers = new Map<PeerId, Peer>();
  private readonly maxGuests: number;
  private readonly now: () => number;
  private readonly makeCode: () => string;

  private host: Peer | null = null;
  private code: string | null = null;

  constructor(options: RoomServerOptions = {}) {
    this.maxGuests = options.maxGuests ?? 3;
    this.now = options.now ?? (() => Date.now());
    this.makeCode = options.makeCode ?? defaultCodeMaker();
  }

  /** The role a socket holds, so a hibernating host can label its sockets. */
  roleOf(id: PeerId): 'host' | 'guest' | null {
    return this.peers.get(id)?.role ?? null;
  }

  get roomCode(): string | null {
    return this.code;
  }

  get peerCount(): number {
    return this.peers.size;
  }

  /** True once nobody is left, which is when the room should be discarded. */
  get empty(): boolean {
    return this.peers.size === 0;
  }

  /**
   * Re-registers a peer whose socket outlived this object's memory.
   *
   * WebSocket Hibernation is the reason Durable Objects were chosen (D-017): an
   * idle room costs nothing because the object is evicted while its sockets stay
   * open. The cost is that everything above is rebuilt on wake, so the room's
   * membership has to be restorable from the sockets themselves rather than
   * assumed to be in memory.
   *
   * Rate limit budget resets on wake. That is deliberate — the alternative is
   * persisting a token bucket, and a peer cannot flood while nothing is awake to
   * receive it.
   */
  restore(socket: ServerSocket, role: 'host' | 'guest', code: string): void {
    this.code = code;
    const peer = this.makePeer(socket, role);
    this.peers.set(socket.id, peer);
    if (role === 'host') this.host = peer;
  }

  onMessage(socket: ServerSocket, frame: string): void {
    if (frame.length > MAX_FRAME_BYTES) {
      this.reject(socket, 'bad-message', 'frame too large');
      return;
    }

    const existing = this.peers.get(socket.id);
    if (existing && !this.spend(existing)) {
      this.reject(socket, 'too-fast');
      return;
    }

    const message = parseMessage<ClientMessage>(frame);
    if (!message) {
      this.reject(socket, 'bad-message');
      return;
    }

    switch (message.t) {
      case 'host':
        this.openRoom(socket, message.v);
        return;
      case 'join':
        this.joinRoom(socket, message.v, message.code);
        return;
      case 'msg':
        this.forward(socket, message.ch, message.to, message.d);
        return;
      default:
        this.reject(socket, 'bad-message');
    }
  }

  onClose(socket: ServerSocket): void {
    const peer = this.peers.get(socket.id);
    if (!peer) return;
    this.peers.delete(socket.id);

    if (peer.role === 'host') {
      // The room is the host's screen. Without it there is nothing to control,
      // so guests are told rather than left holding a dead connection.
      this.host = null;
      this.code = null;
      for (const other of [...this.peers.values()]) {
        this.deliver(other.socket, { t: 'gone', peer: socket.id });
        other.socket.close();
      }
      this.peers.clear();
      return;
    }

    if (this.host) this.deliver(this.host.socket, { t: 'gone', peer: socket.id });
  }

  private openRoom(socket: ServerSocket, version: number): void {
    if (version !== PROTOCOL_VERSION) {
      this.reject(socket, 'bad-version');
      return;
    }
    if (this.host) {
      // A room has exactly one screen. A second host would silently take over
      // the code someone already handed to a friend.
      this.reject(socket, 'bad-message', 'room already hosted');
      return;
    }
    const peer = this.makePeer(socket, 'host');
    this.host = peer;
    this.peers.set(socket.id, peer);
    this.code = this.code ?? this.makeCode();
    this.deliver(socket, { t: 'room', code: this.code, peer: socket.id });
  }

  private joinRoom(socket: ServerSocket, version: number, code: unknown): void {
    if (version !== PROTOCOL_VERSION) {
      this.reject(socket, 'bad-version');
      return;
    }
    if (!isRoomCode(code) || !this.code || code !== this.code) {
      this.reject(socket, 'no-room');
      return;
    }
    if (this.peers.size - 1 >= this.maxGuests) {
      this.reject(socket, 'room-full');
      return;
    }

    const peer = this.makePeer(socket, 'guest');
    this.peers.set(socket.id, peer);
    this.deliver(socket, { t: 'welcome', peer: socket.id, code: this.code });
    if (this.host) this.deliver(this.host.socket, { t: 'peer', peer: socket.id });
  }

  private forward(socket: ServerSocket, channel: unknown, to: unknown, payload: unknown): void {
    const peer = this.peers.get(socket.id);
    if (!peer) {
      this.reject(socket, 'bad-message', 'not in a room');
      return;
    }
    // Reserved channels are refused rather than quietly dropped, so a client
    // that starts using one finds out immediately. See D-016.
    if (!isImplementedChannel(channel)) {
      this.reject(socket, 'bad-message', 'unsupported channel');
      return;
    }

    const message: ServerMessage = { t: 'msg', ch: channel, from: socket.id, d: payload };

    if (typeof to === 'string') {
      const target = this.peers.get(to);
      // Guests may only ever talk to the host. Without this a room code would
      // let strangers message each other through our relay.
      if (!target || (peer.role === 'guest' && target.role !== 'host')) return;
      this.deliver(target.socket, message);
      return;
    }

    for (const other of this.peers.values()) {
      if (other.socket.id === socket.id) continue;
      if (peer.role === 'guest' && other.role !== 'host') continue;
      this.deliver(other.socket, message);
    }
  }

  private makePeer(socket: ServerSocket, role: 'host' | 'guest'): Peer {
    return { socket, role, tokens: RATE_LIMIT.burst, lastRefill: this.now() };
  }

  /** Token bucket. Returns false when this peer is over its budget. */
  private spend(peer: Peer): boolean {
    const now = this.now();
    const elapsed = Math.max(0, now - peer.lastRefill) / 1000;
    peer.lastRefill = now;
    peer.tokens = Math.min(RATE_LIMIT.burst, peer.tokens + elapsed * RATE_LIMIT.perSecond);
    if (peer.tokens < 1) return false;
    peer.tokens -= 1;
    return true;
  }

  private reject(socket: ServerSocket, code: ErrorCode, detail?: string): void {
    this.deliver(socket, { t: 'err', code, detail });
    this.peers.delete(socket.id);
    if (this.host?.socket.id === socket.id) this.host = null;
    socket.close();
  }

  private deliver(socket: ServerSocket, message: ServerMessage): void {
    socket.send(encodeMessage(message));
  }
}
