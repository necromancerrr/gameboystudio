/**
 * Sequence — a GameBoyStudio game built entirely outside the platform's
 * repository, against the SDK package.
 *
 * Watch four panels flash a pattern, then repeat it. Each round adds one step.
 * Get it wrong and the run ends; your longest run is kept.
 *
 * It is deliberately not an action game. The corpus this platform has — orbital
 * physics and sumo shoving — is all reflex and continuous motion, and a
 * declarative format will eventually have to express more than that. A
 * turn-taking state machine with timers, discrete input and a win condition is
 * the shape that has been missing. It is also the case for `gbs check` not
 * requiring that "input moves something": here most input arrives while nothing
 * is meant to move at all.
 */
import {
  runHostedGame,
  type GbsButton,
  type HostedGameContext,
  type HostedInput,
} from '@gameboystudio/sdk';

const WIDTH = 320;
const HEIGHT = 288;

const PALETTE = {
  bg: '#0b0c0b',
  panel: '#1d201d',
  edge: '#282b28',
  text: '#e9eae7',
  muted: '#9a9e98',
  faint: '#6c706b',
  lit: '#9bbc0f',
  wrong: '#d2603c',
};

/** The four panels, in the D-pad's own geometry so the mapping needs no words. */
const PANELS: { button: GbsButton; x: number; y: number }[] = [
  { button: 'up', x: 0, y: -1 },
  { button: 'left', x: -1, y: 0 },
  { button: 'right', x: 1, y: 0 },
  { button: 'down', x: 0, y: 1 },
];

const CENTRE = { x: WIDTH / 2, y: HEIGHT / 2 + 8 };
const PANEL = { size: 64, gap: 6 };

type Phase = 'idle' | 'showing' | 'repeating' | 'wrong' | 'over';

/** How long each flash lasts, and the gap between. Slow enough to read. */
const FLASH_ON = 0.42;
const FLASH_OFF = 0.16;

class Sequence {
  private pattern: GbsButton[] = [];
  private phase: Phase = 'idle';
  private phaseFor = 0;
  private step = 0;
  private lit: GbsButton | null = null;
  private wrongPanel: GbsButton | null = null;
  private best = 0;
  private dirty: HostedGameContext['saveDirty'] | null = null;

  init(context: HostedGameContext): void {
    this.dirty = context.saveDirty;
    this.reset();
  }

  private reset(): void {
    this.pattern = [];
    this.phase = 'idle';
    this.phaseFor = 0;
    this.step = 0;
    this.lit = null;
    this.wrongPanel = null;
  }

  private extend(): void {
    const next = PANELS[Math.floor(Math.random() * PANELS.length)];
    this.pattern.push(next.button);
    this.phase = 'showing';
    this.phaseFor = 0;
    this.step = 0;
    this.lit = null;
  }

  update(dt: number, input: HostedInput): void {
    this.phaseFor += dt;

    switch (this.phase) {
      case 'idle':
      case 'over': {
        // `pressed`, not `held`: holding a button through a game over should
        // not immediately restart it.
        if (input.pressed(0, 'a') || input.pressed(0, 'start') || input.pressed(0, 'b')) {
          this.reset();
          this.extend();
        }
        return;
      }

      case 'showing': {
        const slot = FLASH_ON + FLASH_OFF;
        const index = Math.floor(this.phaseFor / slot);
        if (index >= this.pattern.length) {
          this.phase = 'repeating';
          this.phaseFor = 0;
          this.step = 0;
          this.lit = null;
          return;
        }
        const within = this.phaseFor - index * slot;
        this.lit = within < FLASH_ON ? this.pattern[index] : null;
        return;
      }

      case 'repeating': {
        for (const panel of PANELS) {
          if (!input.pressed(0, panel.button)) continue;
          if (panel.button === this.pattern[this.step]) {
            this.lit = panel.button;
            this.phaseFor = 0;
            this.step += 1;
            if (this.step >= this.pattern.length) {
              if (this.pattern.length > this.best) {
                this.best = this.pattern.length;
                this.dirty?.();
              }
              this.extend();
            }
          } else {
            this.phase = 'wrong';
            this.phaseFor = 0;
            this.wrongPanel = panel.button;
            this.lit = null;
          }
          return;
        }
        // The lit panel fades shortly after a correct press.
        if (this.phaseFor > 0.2) this.lit = null;
        return;
      }

      case 'wrong': {
        if (this.phaseFor > 1.1) {
          this.phase = 'over';
          this.phaseFor = 0;
          this.wrongPanel = null;
        }
        return;
      }
    }
  }

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = PALETTE.bg;
    g.fillRect(0, 0, WIDTH, HEIGHT);

    for (const panel of PANELS) {
      const x = CENTRE.x + panel.x * (PANEL.size + PANEL.gap) - PANEL.size / 2;
      const y = CENTRE.y + panel.y * (PANEL.size + PANEL.gap) - PANEL.size / 2;

      const isLit = this.lit === panel.button;
      const isWrong = this.wrongPanel === panel.button;
      g.fillStyle = isWrong ? PALETTE.wrong : isLit ? PALETTE.lit : PALETTE.panel;
      g.fillRect(x, y, PANEL.size, PANEL.size);
      g.strokeStyle = PALETTE.edge;
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, PANEL.size - 1, PANEL.size - 1);
    }

    g.textAlign = 'center';
    g.font = '11px ui-monospace, monospace';

    g.fillStyle = PALETTE.muted;
    g.fillText(`ROUND ${String(this.pattern.length).padStart(2, '0')}`, WIDTH / 2, 24);
    g.fillStyle = PALETTE.faint;
    g.fillText(`BEST ${String(this.best).padStart(2, '0')}`, WIDTH / 2, 40);

    g.fillStyle = PALETTE.text;
    g.font = '13px ui-monospace, monospace';
    if (this.phase === 'idle') g.fillText('PRESS A TO BEGIN', WIDTH / 2, HEIGHT - 26);
    if (this.phase === 'showing') g.fillText('WATCH', WIDTH / 2, HEIGHT - 26);
    if (this.phase === 'repeating') g.fillText('REPEAT IT', WIDTH / 2, HEIGHT - 26);
    if (this.phase === 'wrong') {
      g.fillStyle = PALETTE.wrong;
      g.fillText('WRONG', WIDTH / 2, HEIGHT - 26);
    }
    if (this.phase === 'over') g.fillText('PRESS A TO TRY AGAIN', WIDTH / 2, HEIGHT - 26);
    g.textAlign = 'left';
  }

  serialize(): Uint8Array {
    const bytes = new Uint8Array(3);
    bytes[0] = 1;
    new DataView(bytes.buffer).setUint16(1, this.best, true);
    return bytes;
  }

  restore(data: Uint8Array): void {
    if (data.length !== 3 || data[0] !== 1) return;
    const stored = new DataView(data.buffer, data.byteOffset).getUint16(1, true);
    // A best round is a claim about a person; refuse an implausible one rather
    // than displaying it.
    if (stored <= 999) this.best = stored;
  }
}

const game = new Sequence();
runHostedGame({
  width: WIDTH,
  height: HEIGHT,
  init: (context) => game.init(context),
  update: (dt, input) => game.update(dt, input),
  render: (g) => game.render(g),
  serialize: () => game.serialize(),
  restore: (data) => game.restore(data),
});
