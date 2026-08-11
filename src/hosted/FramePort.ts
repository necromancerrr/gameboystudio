/**
 * How host and frame exchange messages.
 *
 * Separated from the protocol for the same reason `RemoteTransport` is separate
 * from the room protocol: the thing that moves messages and the thing that
 * understands them should be replaceable independently. It is also what lets
 * the whole adapter be tested without a browser.
 *
 * `IframePort` carries the two security facts that come with sandboxing without
 * `allow-same-origin`, and they are easy to get wrong in opposite directions:
 *
 * - Messages arrive with `origin: "null"`, so **origin cannot identify the
 *   sender**. The port checks `event.source` against the iframe's own
 *   `contentWindow` instead. Filtering on origin here would either reject
 *   everything or, if written as `origin === 'null'`, accept any other opaque
 *   frame on the page.
 * - Posting must use `targetOrigin: '*'`, because an opaque origin matches
 *   nothing else. That is safe only because nothing sent to a game is a secret.
 */

export interface FramePort {
  post(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
  close(): void;
}

abstract class BasePort implements FramePort {
  protected closed = false;
  private readonly handlers = new Set<(message: unknown) => void>();

  abstract post(message: unknown): void;

  onMessage(handler: (message: unknown) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    this.closed = true;
    this.handlers.clear();
  }

  protected deliver(message: unknown): void {
    if (this.closed) return;
    for (const handler of [...this.handlers]) handler(message);
  }
}

export class IframePort extends BasePort {
  private readonly frame: HTMLIFrameElement;
  private readonly onWindowMessage: (event: MessageEvent) => void;

  constructor(frame: HTMLIFrameElement) {
    super();
    this.frame = frame;

    this.onWindowMessage = (event: MessageEvent) => {
      // The only usable identity check. A sandboxed frame's origin is "null",
      // which every other opaque frame on the page also reports.
      if (event.source !== frame.contentWindow) return;
      this.deliver(event.data);
    };
    window.addEventListener('message', this.onWindowMessage);
  }

  post(message: unknown): void {
    if (this.closed) return;
    // '*' is required: an opaque origin matches no specific target. Safe only
    // while host-to-frame messages carry nothing secret.
    this.frame.contentWindow?.postMessage(message, '*');
  }

  close(): void {
    window.removeEventListener('message', this.onWindowMessage);
    super.close();
  }
}

/**
 * A connected pair for tests, with a real asynchronous boundary.
 *
 * Delivery is deferred on purpose. A synchronous pipe would let a test pass
 * while the real code depended on a reply arriving before `post()` returned —
 * which is the bug a fake is supposed to catch rather than hide.
 */
export class LoopbackPort extends BasePort {
  private peer: LoopbackPort | null = null;

  static pair(): [LoopbackPort, LoopbackPort] {
    const left = new LoopbackPort();
    const right = new LoopbackPort();
    left.peer = right;
    right.peer = left;
    return [left, right];
  }

  post(message: unknown): void {
    if (this.closed) return;
    const peer = this.peer;
    if (!peer) return;
    queueMicrotask(() => peer.deliver(message));
  }

  close(): void {
    const peer = this.peer;
    this.peer = null;
    super.close();
    if (peer) peer.peer = null;
  }
}
