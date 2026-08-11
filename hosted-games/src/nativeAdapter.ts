/**
 * Runs a `NativeGame` as a hosted game.
 *
 * The two contracts are close by design — the hosted SDK was shaped after the
 * native one — so this is a shim rather than a port. That closeness is the
 * point: Ring Out and Drift are unmodified here, which is what makes them a
 * usable control for "does hosting change how a game behaves".
 *
 * The one real difference is audio. A native game gets an `AudioHost` built by
 * the platform, because the platform owns the AudioContext and the mute. Inside
 * a sandboxed frame the platform cannot reach in, so the frame builds its own
 * and listens for the host's mute instruction. The game is unaware either way.
 */

import type { NativeGame, InputSnapshot, PlayerInput, AudioHost } from '@/native/types';
import type { HostedGameContext, HostedGameDefinition, HostedInput } from '@/hosted/sdk';

/** Bridges the hosted input shape to the one native games read. */
function snapshotFor(input: HostedInput, players: number): InputSnapshot {
  const absent: PlayerInput = { held: () => false, pressed: () => false };
  return {
    players,
    player(index: number): PlayerInput {
      if (index < 0 || index >= players) return absent;
      return {
        held: (button) => input.held(index, button),
        pressed: (button) => input.pressed(index, button),
      };
    },
  };
}

function createAudio(): AudioHost | null {
  if (typeof AudioContext === 'undefined') return null;
  try {
    const context = new AudioContext();
    const out = context.createGain();
    out.connect(context.destination);
    return { context, out };
  } catch {
    // Blocked audio is not a reason to refuse to run the game.
    return null;
  }
}

export function hostNativeGame(create: () => NativeGame): HostedGameDefinition {
  let game = create();
  let audio: AudioHost | null = null;
  let players = 1;
  let muted = false;

  const applyMute = () => {
    if (audio) audio.out.gain.value = muted ? 0 : 1;
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('gbs:mute', (event) => {
      muted = Boolean((event as CustomEvent<boolean>).detail);
      applyMute();
    });
  }

  return {
    width: game.resolution.width,
    height: game.resolution.height,

    async init(context: HostedGameContext) {
      players = Math.min(Math.max(context.players, game.players.min), game.players.max);
      if (!audio) audio = createAudio();
      applyMute();
      // The host's start and resume are the closest thing to a user gesture
      // that reaches this frame, and resume() is idempotent.
      void audio?.context.resume();
      await game.init({
        players,
        audio,
        saveDirty: () => context.saveDirty(),
      });
    },

    update(dt: number, input: HostedInput) {
      game.update(dt, snapshotFor(input, players));
    },

    render(g: CanvasRenderingContext2D) {
      game.render(g);
    },

    serialize: () => game.serialize?.() ?? new Uint8Array(0),
    restore: (data: Uint8Array) => game.restore?.(data),

    dispose() {
      game.dispose?.();
      void audio?.context.close();
      audio = null;
      // A fresh instance if this frame is ever reused, rather than a disposed
      // one that looks alive.
      game = create();
    },
  };
}
