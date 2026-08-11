/**
 * The SDK a hosted game is built against.
 *
 * This is a published contract, not an engine. It forwards lifecycle and input
 * and does nothing else — no rendering, no physics, no asset loading, no
 * opinions about how a game is written. That restraint is the point: D-018 says
 * a new verb needs a real game that needs it, or this becomes an engine by
 * accretion.
 *
 * A hosted game supplies the same three methods a native game does, so the two
 * are the same shape from the author's side even though one is compiled into
 * the site and the other is not.
 *
 * This file is bundled into the hosted artifact, not into the application.
 */

import type { LogicalButton } from '@/emulation/core/types';
import {
  FRAME_PROTOCOL_VERSION,
  parseHostMessage,
  type HostMessage,
} from '../frameProtocol';

export interface HostedInput {
  held(player: number, button: LogicalButton): boolean;
  /** True on exactly one frame per press, so a tap is never swallowed. */
  pressed(player: number, button: LogicalButton): boolean;
}

export interface HostedGameContext {
  players: number;
  canvas: HTMLCanvasElement;
  /**
   * Report that persistent state changed. The host decides when to actually
   * serialize and where the bytes go — the same division the native contract
   * uses, so a game written for one reads the same as a game written for the
   * other.
   */
  saveDirty(): void;
}

export interface HostedGameDefinition {
  readonly width: number;
  readonly height: number;
  init(context: HostedGameContext): void | Promise<void>;
  update(dt: number, input: HostedInput): void;
  render(g: CanvasRenderingContext2D): void;
  /** Opt into saves. A game without these simply has no save. */
  serialize?(): Uint8Array;
  restore?(data: Uint8Array): void;
  dispose?(): void;
}

/** A frame longer than this is a stall, not slow gameplay. Matches the host. */
const MAX_DELTA_SECONDS = 0.25;

class InputState implements HostedInput {
  private readonly held_ = new Map<string, Set<LogicalButton>>();
  private readonly pending = new Map<string, Set<LogicalButton>>();
  private readonly frame = new Map<string, Set<LogicalButton>>();

  private setFor(map: Map<string, Set<LogicalButton>>, player: number): Set<LogicalButton> {
    const key = String(player);
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    return set;
  }

  set(player: number, button: LogicalButton, pressed: boolean): void {
    const held = this.setFor(this.held_, player);
    if (pressed) {
      if (!held.has(button)) this.setFor(this.pending, player).add(button);
      held.add(button);
    } else {
      held.delete(button);
    }
  }

  beginFrame(): void {
    this.frame.clear();
    for (const [key, set] of this.pending) {
      this.frame.set(key, new Set(set));
      set.clear();
    }
  }

  releaseAll(): void {
    this.held_.clear();
    this.pending.clear();
    this.frame.clear();
  }

  held(player: number, button: LogicalButton): boolean {
    return this.held_.get(String(player))?.has(button) ?? false;
  }

  pressed(player: number, button: LogicalButton): boolean {
    return this.frame.get(String(player))?.has(button) ?? false;
  }
}

/**
 * Connects a game to the host and runs it.
 *
 * Everything about the surrounding page — the canvas, the loop, mute, pause —
 * is handled here so a hosted game is no harder to write than a compiled one.
 */
export function runHostedGame(game: HostedGameDefinition): void {
  const canvas = document.createElement('canvas');
  canvas.width = game.width;
  canvas.height = game.height;
  canvas.style.cssText = 'display:block;width:100%;height:100%;image-rendering:pixelated';
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  document.body.appendChild(canvas);

  const painter = canvas.getContext('2d');
  const input = new InputState();

  let running = false;
  let loaded = false;
  let players = 1;
  let last = 0;
  let handle: number | null = null;
  let painted = false;

  const send = (message: unknown) => window.parent.postMessage(message, '*');

  const context = (): HostedGameContext => ({
    players,
    canvas,
    saveDirty: () => send({ t: 'saveDirty' }),
  });

  const fail = (error: unknown) => {
    running = false;
    if (handle !== null) cancelAnimationFrame(handle);
    handle = null;
    send({ t: 'error', message: error instanceof Error ? error.message : String(error) });
  };

  const draw = () => {
    if (!painter) return;
    game.render(painter);
    if (!painted) {
      painted = true;
      send({ t: 'painted' });
    }
  };

  const tick = (timestamp: number) => {
    handle = null;
    const dt = Math.min((timestamp - last) / 1000, MAX_DELTA_SECONDS);
    last = timestamp;
    if (dt > 0) {
      input.beginFrame();
      try {
        game.update(dt, input);
        draw();
      } catch (error) {
        fail(error);
        return;
      }
    }
    if (running) handle = requestAnimationFrame(tick);
  };

  const startLoop = () => {
    if (running || !loaded) return;
    running = true;
    last = performance.now();
    handle = requestAnimationFrame(tick);
  };

  const stopLoop = () => {
    running = false;
    if (handle !== null) cancelAnimationFrame(handle);
    handle = null;
    // Anything held when the loop stops would still be held on resume, which is
    // how a player comes back to a character already walking into a wall.
    input.releaseAll();
  };

  const apply = async (message: HostMessage) => {
    switch (message.t) {
      case 'load':
        try {
          players = message.players;
          await game.init(context());
          loaded = true;
          draw(); // a paused-at-start player sees the game, not a black box
          send({ t: 'ready' });
        } catch (error) {
          fail(error);
        }
        return;
      case 'start':
      case 'resume':
        startLoop();
        return;
      case 'pause':
        stopLoop();
        return;
      case 'reset':
        try {
          const wasRunning = running;
          stopLoop();
          // The player count comes from the session, not from a guess. Passing
          // 1 here quietly turned a two-player game into a one-player one on
          // every press of Restart.
          await game.init(context());
          draw();
          if (wasRunning) startLoop();
        } catch (error) {
          fail(error);
        }
        return;
      case 'input':
        input.set(message.player, message.button, message.pressed);
        return;
      case 'mute':
        // The game owns its own audio; the host only says which way.
        window.dispatchEvent(new CustomEvent('gbs:mute', { detail: message.muted }));
        return;
      case 'restore':
        try {
          game.restore?.(message.data);
        } catch {
          // A save written by an older version must not brick the game.
        }
        return;
      case 'readSave':
        try {
          const data = game.serialize?.();
          if (data && data.byteLength > 0) send({ t: 'save', data });
        } catch (error) {
          fail(error);
        }
        return;
      case 'destroy':
        stopLoop();
        try {
          game.dispose?.();
        } catch {
          /* Teardown must not throw on the way out. */
        }
        return;
      default:
        return;
    }
  };

  window.addEventListener('message', (event: MessageEvent) => {
    // Only the embedder talks to us. Anything else is not part of this session.
    if (event.source !== window.parent) return;
    const message = parseHostMessage(event.data);
    if (message) void apply(message);
  });

  /**
   * Announce, and keep announcing until the host answers.
   *
   * The iframe's `src` is set during render, so the document can finish loading
   * before the host has attached its message listener. A single unprompted
   * hello is then lost forever: the game sits waiting for `load` that never
   * comes, having already created its canvas, so it looks like a game that
   * started and ignores input rather than one that never started.
   *
   * Retrying is the fix rather than reordering the host, because the race can
   * fall either way and only one side can be made to not care.
   */
  const hello = () =>
    send({ t: 'hello', v: FRAME_PROTOCOL_VERSION, width: game.width, height: game.height });

  hello();
  const announcing = setInterval(() => {
    if (loaded) {
      clearInterval(announcing);
      return;
    }
    hello();
  }, 250);
  // Nothing is listening, or the host refused this version. Stop talking to it.
  setTimeout(() => clearInterval(announcing), 15_000);
}
