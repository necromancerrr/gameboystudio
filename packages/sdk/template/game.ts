/**
 * A game that already runs.
 *
 * Every line here is meant to be deleted. It exists so your first minute is
 * spent playing something rather than configuring a build.
 *
 * The host owns the loop, input, audio unlock, mute, pause and where saves go.
 * You supply init, update and render — and serialize/restore if you have
 * something worth keeping.
 */
import { runHostedGame, type HostedGameContext, type HostedInput } from '@gameboystudio/sdk';

const WIDTH = 320;
const HEIGHT = 288;

let x = WIDTH / 2;
let y = HEIGHT / 2;
let best = 0;
let moved = 0;
let dirty: HostedGameContext['saveDirty'] | null = null;

runHostedGame({
  width: WIDTH,
  height: HEIGHT,

  init(context) {
    dirty = context.saveDirty;
    x = WIDTH / 2;
    y = HEIGHT / 2;
    moved = 0;
  },

  update(dt: number, input: HostedInput) {
    const speed = 120 * dt;
    let dx = 0;
    let dy = 0;
    if (input.held(0, 'left')) dx -= speed;
    if (input.held(0, 'right')) dx += speed;
    if (input.held(0, 'up')) dy -= speed;
    if (input.held(0, 'down')) dy += speed;

    x = Math.max(8, Math.min(WIDTH - 8, x + dx));
    y = Math.max(8, Math.min(HEIGHT - 8, y + dy));

    moved += Math.hypot(dx, dy);
    if (moved > best) {
      best = moved;
      dirty?.();
    }
  },

  render(g: CanvasRenderingContext2D) {
    g.fillStyle = '#0b0c0b';
    g.fillRect(0, 0, WIDTH, HEIGHT);

    g.fillStyle = '#9bbc0f';
    g.beginPath();
    g.arc(x, y, 8, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#6c706b';
    g.font = '12px ui-monospace, monospace';
    g.fillText('MOVE WITH THE D-PAD', 12, 20);
  },

  // Delete these two if your game has nothing worth keeping between sessions,
  // and set "saves": false in gbs.game.json. The platform checks that they agree.
  serialize() {
    const bytes = new Uint8Array(5);
    bytes[0] = 1;
    new DataView(bytes.buffer).setUint32(1, Math.floor(best), true);
    return bytes;
  },

  restore(data: Uint8Array) {
    if (data.length !== 5 || data[0] !== 1) return;
    best = new DataView(data.buffer, data.byteOffset).getUint32(1, true);
  },
});
