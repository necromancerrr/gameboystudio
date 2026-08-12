'use client';

/**
 * SPIKE harness for the GBA runtime. Deliberately ugly: this is instrumentation,
 * not a player. Every readout on screen is something GBA_SPIKE.md claims and
 * something a person can check by looking.
 *
 * The real player chrome stays untouched — proving the runtime works must not
 * require rewriting the product first.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { bindGamepad, padLabel, type GamepadInfo } from '@/input/gamepad';
import { bindKeyboard } from '@/input/keyboard';
import type { LogicalButton } from '@/emulation/core/types';
import {
  GBA_SCREEN_HEIGHT,
  GBA_SCREEN_WIDTH,
  MgbaAdapter,
  type GbaButton,
} from '@/emulation/gba/MgbaAdapter';

const ROMS = [
  { name: 'MeteoRain', url: '/spike-roms/MeteoRain.gba', license: 'MIT', mb: 1.7 },
  { name: 'The Purple Night', url: '/spike-roms/the-purple-night.gba', license: 'MPL-2.0', mb: 8 },
  { name: 'Skyland', url: '/spike-roms/Skyland.gba', license: 'MPL-2.0', mb: 24 },
];

const TOUCH_BUTTONS: GbaButton[] = [
  'up', 'down', 'left', 'right', 'a', 'b', 'start', 'select', 'l', 'r',
];

/**
 * L and R are the two buttons the Game Boy contract does not have. Bound here
 * rather than in src/input/keyboard.ts: widening the shared LogicalButton union
 * is a production change, and this branch is not allowed to make one.
 */
const SHOULDER_CODES: Record<string, GbaButton> = {
  KeyQ: 'l',
  KeyE: 'r',
};

export function GbaSpike() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adapterRef = useRef<MgbaAdapter | null>(null);

  const [rom, setRom] = useState<(typeof ROMS)[number] | null>(null);
  const [status, setStatus] = useState('idle');
  const [fps, setFps] = useState(0);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [firstFrameMs, setFirstFrameMs] = useState<number | null>(null);
  const [pressed, setPressed] = useState<GbaButton[]>([]);
  const [pads, setPads] = useState<GamepadInfo[]>([]);
  const [saveInfo, setSaveInfo] = useState('no save read yet');
  const [saveWrites, setSaveWrites] = useState(0);
  const [muted, setMuted] = useState(false);
  const [isolated, setIsolated] = useState<boolean | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const say = useCallback((line: string) => {
    setLog((previous) => [`${new Date().toISOString().slice(11, 19)}  ${line}`, ...previous].slice(0, 14));
  }, []);

  useEffect(() => {
    setIsolated(window.crossOriginIsolated);
  }, []);

  const press = useCallback((button: GbaButton, down: boolean) => {
    adapterRef.current?.setButton(button, down);
    setPressed((previous) =>
      down
        ? previous.includes(button) ? previous : [...previous, button]
        : previous.filter((held) => held !== button),
    );
  }, []);

  // Keyboard: the eight shared buttons through the production binding, plus the
  // two GBA-only shoulders alongside it.
  useEffect(() => {
    const unbind = bindKeyboard({
      onButton: (button: LogicalButton, down) => press(button, down),
    });

    const onKey = (event: KeyboardEvent) => {
      const button = SHOULDER_CODES[event.code];
      if (button) press(button, event.type === 'keydown');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    return () => {
      unbind();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [press]);

  // Gamepad: production binding for the eight, raw polling for L/R (indexes 4
  // and 5 in the standard mapping).
  useEffect(() => {
    const unbind = bindGamepad({
      onButton: (_player, button, down) => press(button, down),
      onConnectionChange: setPads,
    });

    let frame = 0;
    const held = new Set<GbaButton>();
    const poll = () => {
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue;
        for (const [index, button] of [[4, 'l'], [5, 'r']] as const) {
          const down = !!pad.buttons[index]?.pressed;
          if (down !== held.has(button)) {
            if (down) held.add(button);
            else held.delete(button);
            press(button, down);
          }
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);

    return () => {
      unbind();
      cancelAnimationFrame(frame);
    };
  }, [press]);

  const load = useCallback(
    async (choice: (typeof ROMS)[number]) => {
      adapterRef.current?.destroy();
      adapterRef.current = null;
      setFirstFrameMs(null);
      setProgress(null);
      setSaveWrites(0);
      setRom(choice);
      setStatus(`loading ${choice.name}`);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const startedAt = performance.now();
      const adapter = new MgbaAdapter({
        canvas,
        onFps: setFps,
        onProgress: (received, total) => setProgress({ received, total }),
        onFirstFrame: () => {
          setFirstFrameMs(Math.round(performance.now() - startedAt));
          setStatus('running');
        },
        onSaveDirty: () => setSaveWrites((n) => n + 1),
        onError: (error) => {
          setStatus(`error: ${error.message}`);
          say(`ERROR ${error.message}`);
        },
      });
      adapterRef.current = adapter;
      // Spike instrumentation: the verification harness drives the adapter
      // directly, so it does not have to fake clicks to prove anything.
      (window as unknown as { __gbaAdapter?: MgbaAdapter }).__gbaAdapter = adapter;

      try {
        await adapter.loadGame({ romUrl: choice.url, saveKey: `spike:${choice.name}` });
        say(`loaded ${choice.name} (${choice.mb}MB, ${choice.license})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`error: ${message}`);
        say(`ERROR ${message}`);
      }
    },
    [say],
  );

  useEffect(() => () => adapterRef.current?.destroy(), []);

  const readSave = () => {
    const save = adapterRef.current?.readSave();
    if (!save) {
      setSaveInfo('getSave() returned null — no save data for this game yet');
      say('save: null');
      return;
    }
    let nonZero = 0;
    for (const byte of save) if (byte !== 0) nonZero += 1;
    setSaveInfo(`${save.byteLength} bytes, ${nonZero} non-zero`);
    say(`save: ${save.byteLength}B, ${nonZero} non-zero`);
  };

  const roundTripSave = async () => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const before = adapter.readSave();
    if (!before) {
      setSaveInfo('nothing to round-trip — save the game in-game first');
      return;
    }
    const copy = new Uint8Array(before);
    adapter.loadSave(copy);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const after = adapter.readSave();
    const same =
      after !== null &&
      after.byteLength === copy.byteLength &&
      copy.every((byte, index) => after[index] === byte);
    setSaveInfo(`round-trip ${same ? 'MATCHED' : 'DIFFERED'} (${copy.byteLength} bytes)`);
    say(`save round-trip: ${same ? 'match' : 'MISMATCH'}`);
  };

  return (
    <div className="mx-auto max-w-5xl p-6 font-mono text-sm">
      <h1 className="text-lg font-semibold">GBA runtime spike</h1>
      <p className="mt-1 text-muted">
        mGBA (MPL-2.0) via @thenick775/mgba-wasm. Not the product player. Not in
        the catalog.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {ROMS.map((choice) => (
          <button
            key={choice.name}
            onClick={() => void load(choice)}
            className="rounded border border-hairline px-3 py-1.5 hover:bg-white/5"
          >
            {choice.name} <span className="text-faint">{choice.mb}MB · {choice.license}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-start gap-6">
        <canvas
          ref={canvasRef}
          width={GBA_SCREEN_WIDTH}
          height={GBA_SCREEN_HEIGHT}
          className="border border-hairline"
          style={{
            width: GBA_SCREEN_WIDTH * 2,
            height: GBA_SCREEN_HEIGHT * 2,
            imageRendering: 'pixelated',
          }}
        />

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-faint">crossOriginIsolated</dt>
          <dd data-testid="isolated">{String(isolated)}</dd>
          <dt className="text-faint">status</dt>
          <dd data-testid="status">{status}</dd>
          <dt className="text-faint">rom</dt>
          <dd>{rom ? `${rom.name} (${rom.license})` : '—'}</dd>
          <dt className="text-faint">download</dt>
          <dd data-testid="progress">
            {progress
              ? `${(progress.received / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB`
              : '—'}
          </dd>
          <dt className="text-faint">time to first frame</dt>
          <dd data-testid="ttff">{firstFrameMs === null ? '—' : `${firstFrameMs} ms`}</dd>
          <dt className="text-faint">fps</dt>
          <dd data-testid="fps">{fps.toFixed(1)}</dd>
          <dt className="text-faint">held</dt>
          <dd data-testid="held">{pressed.join(' ') || '—'}</dd>
          <dt className="text-faint">gamepads</dt>
          <dd data-testid="pads">
            {pads.length ? pads.map((pad) => padLabel(pad.id)).join(', ') : 'none'}
          </dd>
          <dt className="text-faint">save writes</dt>
          <dd data-testid="save-writes">{saveWrites}</dd>
          <dt className="text-faint">save</dt>
          <dd data-testid="save-info">{saveInfo}</dd>
        </dl>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => adapterRef.current?.pause()} className="rounded border border-hairline px-3 py-1.5">pause</button>
        <button onClick={() => adapterRef.current?.resume()} className="rounded border border-hairline px-3 py-1.5">resume</button>
        <button onClick={() => adapterRef.current?.reset()} className="rounded border border-hairline px-3 py-1.5">reset</button>
        <button
          onClick={() => {
            const next = !muted;
            setMuted(next);
            adapterRef.current?.setMuted(next);
          }}
          className="rounded border border-hairline px-3 py-1.5"
          data-testid="mute"
        >
          {muted ? 'unmute' : 'mute'}
        </button>
        <button onClick={readSave} className="rounded border border-hairline px-3 py-1.5" data-testid="read-save">read save</button>
        <button onClick={() => void roundTripSave()} className="rounded border border-hairline px-3 py-1.5">round-trip save</button>
        <button onClick={() => void adapterRef.current?.flush()} className="rounded border border-hairline px-3 py-1.5">flush to IndexedDB</button>
      </div>

      {/* Touch: pointer events rather than click, so a press can be held. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {TOUCH_BUTTONS.map((button) => (
          <button
            key={button}
            data-testid={`touch-${button}`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              press(button, true);
            }}
            onPointerUp={() => press(button, false)}
            onPointerCancel={() => press(button, false)}
            className="w-16 rounded border border-hairline px-2 py-3 uppercase"
          >
            {button}
          </button>
        ))}
      </div>

      <pre className="mt-4 whitespace-pre-wrap text-xs text-faint">{log.join('\n')}</pre>
    </div>
  );
}
