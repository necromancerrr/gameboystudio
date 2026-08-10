/**
 * One Durable Object per room.
 *
 * The mapping is exact, and is why Durable Objects were chosen over a service we
 * would have to operate: a room's lifetime is an object's lifetime, so there is
 * no room table, no expiry job over a database, and nothing to clean up when a
 * game ends. D-017 records the reasoning.
 *
 * WebSocket Hibernation means this object can be evicted from memory while its
 * sockets stay open, so `RoomServer` is rebuilt from those sockets on wake. Each
 * socket carries its own identity in its attachment, and that attachment is the
 * only state that survives — three strings and a flag.
 */

import { RoomServer, type ServerSocket } from '../../src/net/RoomServer';

/** A room nobody came back to is swept. Rooms are for one sitting. */
const IDLE_SWEEP_MS = 2 * 60 * 60 * 1000;
/** How often to re-check while people are still connected. */
const ACTIVE_RECHECK_MS = 30 * 60 * 1000;

interface Attachment {
  id: string;
  role: 'host' | 'guest';
  code: string;
  /**
   * Whether this socket ever became a room member.
   *
   * A socket is accepted before its owner has said what it wants, and the room
   * only knows a peer once `host` or `join` arrives. Without this flag a wake
   * would restore a half-open socket as an established host, and the real host's
   * `host` message would then be refused as a takeover attempt.
   */
  joined: boolean;
}

export class RoomDurableObject {
  private readonly state: DurableObjectState;
  private server: RoomServer | null = null;
  private code: string | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code') ?? '';
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';

    const { 0: client, 1: server } = new WebSocketPair();
    const attachment: Attachment = { id: crypto.randomUUID(), role, code, joined: false };
    server.serializeAttachment(attachment);

    // Hibernation-aware: the runtime may evict this object and still deliver
    // messages on this socket later.
    this.state.acceptWebSocket(server);
    await this.state.storage.setAlarm(Date.now() + ACTIVE_RECHECK_MS);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    // No binary channel exists. `frames` and `state` are reserved names the
    // relay refuses; see D-016.
    if (typeof message !== 'string') return;

    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment) return;

    const room = this.room(attachment.code);
    const wrapped = this.wrap(socket, attachment);
    room.onMessage(wrapped, message);

    // Promote the socket once the room has actually accepted it, so a later
    // wake restores it as a member rather than as a stranger.
    if (!attachment.joined && room.roleOf(attachment.id) !== null) {
      socket.serializeAttachment({ ...attachment, joined: true } satisfies Attachment);
    }
  }

  webSocketClose(socket: WebSocket): void {
    this.dropSocket(socket);
  }

  webSocketError(socket: WebSocket): void {
    this.dropSocket(socket);
  }

  /**
   * Sweeps a room nobody came back to.
   *
   * A room with people still in it is not swept — it is rescheduled. A long
   * game is not an abandoned one.
   */
  async alarm(): Promise<void> {
    const sockets = this.state.getWebSockets();
    if (sockets.length > 0) {
      await this.state.storage.setAlarm(Date.now() + ACTIVE_RECHECK_MS);
      return;
    }
    const openedAt = (await this.state.storage.get<number>('openedAt')) ?? 0;
    if (openedAt && Date.now() - openedAt < IDLE_SWEEP_MS) {
      await this.state.storage.setAlarm(Date.now() + ACTIVE_RECHECK_MS);
      return;
    }
    this.server = null;
    this.code = null;
    await this.state.storage.deleteAll();
  }

  private dropSocket(socket: WebSocket): void {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    this.room(attachment.code).onClose(this.wrap(socket, attachment));
  }

  /**
   * The room, rebuilt from live sockets when this object was hibernating.
   *
   * Rebuilding rather than persisting is the point: membership is derivable
   * from who is still connected, so there is no room record to keep in sync
   * with reality and no way for a stale one to outlive the game.
   */
  private room(code: string): RoomServer {
    if (this.server && this.code === code) return this.server;

    const server = new RoomServer({ maxGuests: 3, makeCode: () => code });
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (!attachment || !attachment.joined) continue;
      server.restore(this.wrap(socket, attachment), attachment.role, code);
    }
    this.server = server;
    this.code = code;
    return server;
  }

  private wrap(socket: WebSocket, attachment: Attachment): ServerSocket {
    return {
      id: attachment.id,
      send: (frame) => {
        try {
          socket.send(frame);
        } catch {
          // A socket that closed between the check and the send is routine.
        }
      },
      close: () => {
        try {
          socket.close(1000, 'closed by room');
        } catch {
          /* Already gone. */
        }
      },
    };
  }
}
