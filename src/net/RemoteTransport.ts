/**
 * How room messages get from one device to another.
 *
 * Deliberately ignorant of what it carries. The transport moves opaque string
 * frames; the room protocol sits above it and the game input layer sits above
 * that. Swapping WebSockets for WebRTC DataChannels later has to be a change to
 * this file's implementations and nothing else — D-016 requires that WebSockets
 * not become a permanent assumption, and an interface that mentioned buttons
 * would already have broken that promise.
 *
 * The loopback implementation is not a mock of a network. It is a real
 * transport with a real asynchronous boundary, which is what makes the whole
 * join → input → game path testable before any relay exists.
 */

export type TransportState = 'connecting' | 'open' | 'closed';

export interface RemoteTransport {
  readonly state: TransportState;
  /** Ignored when not open; callers must not have to check first. */
  send(frame: string): void;
  /** Returns an unsubscribe function. */
  onFrame(handler: (frame: string) => void): () => void;
  onStateChange(handler: (state: TransportState) => void): () => void;
  close(): void;
}

abstract class BaseTransport implements RemoteTransport {
  protected currentState: TransportState = 'connecting';
  private readonly frameHandlers = new Set<(frame: string) => void>();
  private readonly stateHandlers = new Set<(state: TransportState) => void>();

  get state(): TransportState {
    return this.currentState;
  }

  abstract send(frame: string): void;
  abstract close(): void;

  onFrame(handler: (frame: string) => void): () => void {
    this.frameHandlers.add(handler);
    return () => {
      this.frameHandlers.delete(handler);
    };
  }

  onStateChange(handler: (state: TransportState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  protected emitFrame(frame: string): void {
    for (const handler of [...this.frameHandlers]) handler(frame);
  }

  protected setState(state: TransportState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const handler of [...this.stateHandlers]) handler(state);
  }
}

/**
 * A transport whose other end is in the same process.
 *
 * `deliver` is asynchronous on purpose. A synchronous pipe would let a test
 * pass while the real code depended on a reply arriving before send() returned,
 * which is exactly the bug a fake transport is supposed to catch rather than
 * hide.
 */
export class LoopbackTransport extends BaseTransport {
  private peer: LoopbackTransport | null = null;

  /** Creates a connected pair. */
  static pair(): [LoopbackTransport, LoopbackTransport] {
    const left = new LoopbackTransport();
    const right = new LoopbackTransport();
    left.peer = right;
    right.peer = left;
    left.setState('open');
    right.setState('open');
    return [left, right];
  }

  send(frame: string): void {
    if (this.currentState !== 'open') return;
    const peer = this.peer;
    if (!peer) return;
    queueMicrotask(() => {
      if (peer.currentState !== 'open') return;
      peer.emitFrame(frame);
    });
  }

  close(): void {
    if (this.currentState === 'closed') return;
    this.setState('closed');
    const peer = this.peer;
    this.peer = null;
    // A close has to reach the other end, or a disconnected guest would leave
    // its buttons held down on the host forever.
    if (peer) {
      peer.peer = null;
      queueMicrotask(() => peer.setState('closed'));
    }
  }
}

/**
 * The real thing: one WebSocket to the relay.
 *
 * Reconnection is not handled here. A transport that silently reconnects would
 * hide the one event the room actually has to react to — a player's device
 * going away — so the room layer owns retrying and this stays a dumb pipe.
 */
export class WebSocketTransport extends BaseTransport {
  private socket: WebSocket | null = null;
  /** Frames sent before the socket opened, replayed in order once it does. */
  private readonly queued: string[] = [];

  constructor(url: string) {
    super();
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.setState('open');
      for (const frame of this.queued.splice(0)) socket.send(frame);
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') this.emitFrame(event.data);
    });
    socket.addEventListener('close', () => {
      this.socket = null;
      this.setState('closed');
    });
    socket.addEventListener('error', () => {
      // 'error' is always followed by 'close', which is where state changes.
    });
  }

  send(frame: string): void {
    if (this.currentState === 'closed') return;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // Joining and sending happen in the same tick on the guest page.
      this.queued.push(frame);
      return;
    }
    socket.send(frame);
  }

  close(): void {
    if (this.currentState === 'closed') return;
    const socket = this.socket;
    this.socket = null;
    this.queued.length = 0;
    this.setState('closed');
    socket?.close();
  }
}
