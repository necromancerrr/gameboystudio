/**
 * Drives NativeGameRuntime headlessly and asserts what the runtime promises.
 *
 * There is no browser here, which is the point: the frame clock, the audio
 * host and the canvas are all injected, so the loop is a variable rather than
 * a wall clock and every assertion is deterministic.
 *
 * D-012 applies — an assertion that cannot fail is worse than none — so each
 * check is written so that removing the behaviour it covers breaks it.
 *
 * Run with: npm run verify:native
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = `${REPO}/.native-build`;

// Compiled rather than imported: Node cannot resolve the project's TypeScript
// on its own, and the runtime is worth checking as the compiler sees it.
fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(`${REPO}/node_modules/.bin/tsc`, ['-p', `${REPO}/scripts/tsconfig.native.json`], {
  cwd: REPO,
  stdio: 'inherit',
});

const require = createRequire(import.meta.url);
const { NativeGameRuntime } = require(`${OUT}/native/NativeGameRuntime.js`);
const { GameLoop, MAX_DELTA_SECONDS } = require(`${OUT}/native/GameLoop.js`);
const { InputState } = require(`${OUT}/native/InputState.js`);

let passed = 0;
const failures = [];

async function check(name, body) {
  try {
    await body();
    console.log(`  ok   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}\n       ${String(error.message).split('\n')[0]}`);
    failures.push(name);
  }
}

/** A frame clock the test drives by hand. */
function testScheduler() {
  let time = 0;
  let pending = null;
  let nextHandle = 1;
  return {
    now: () => time,
    requestFrame(callback) {
      pending = callback;
      return nextHandle++;
    },
    cancelFrame() {
      pending = null;
    },
    /** Advance the clock by `ms` and deliver one frame, if one is scheduled. */
    frame(ms = 16) {
      time += ms;
      const callback = pending;
      pending = null;
      if (callback) callback(time);
      return !!callback;
    },
    get scheduled() {
      return pending !== null;
    },
  };
}

function fakeCanvas() {
  const context = { clearRect() {}, fillRect() {} };
  return { width: 0, height: 0, getContext: () => context };
}

function fakeAudio() {
  const out = { gain: { value: 1 }, connect() {} };
  let resumes = 0;
  let closed = false;
  return {
    host: {
      context: {
        resume: async () => { resumes += 1; },
        close: async () => { closed = true; },
      },
      out,
    },
    out,
    get resumes() { return resumes; },
    get closed() { return closed; },
  };
}

/** The smallest legal game: no serialize, no restore, no dispose. */
function minimalGame() {
  const log = [];
  return {
    log,
    resolution: { width: 200, height: 100 },
    players: { min: 1, max: 1 },
    init() { log.push('init'); },
    update(dt, input) { log.push(['update', dt, input.player(0).held('a')]); },
    render(g) { log.push(['render', !!g]); },
  };
}

console.log('GameLoop:');

await check('runs the tick once per frame with a seconds delta', () => {
  const scheduler = testScheduler();
  const deltas = [];
  const loop = new GameLoop((dt) => deltas.push(dt), scheduler);
  loop.start();
  scheduler.frame(16);
  scheduler.frame(16);
  scheduler.frame(32);
  assert.deepEqual(deltas, [0.016, 0.016, 0.032]);
});

await check('clamps a stalled frame instead of teleporting the game', () => {
  const scheduler = testScheduler();
  const deltas = [];
  const loop = new GameLoop((dt) => deltas.push(dt), scheduler);
  loop.start();
  scheduler.frame(30_000);
  assert.equal(deltas[0], MAX_DELTA_SECONDS);
});

await check('restarting does not deliver the paused time as one frame', () => {
  const scheduler = testScheduler();
  const deltas = [];
  const loop = new GameLoop((dt) => deltas.push(dt), scheduler);
  loop.start();
  scheduler.frame(16);
  loop.stop();
  scheduler.frame(5_000); // time passes while stopped
  loop.start();
  scheduler.frame(16);
  assert.deepEqual(deltas, [0.016, 0.016]);
});

await check('stop halts ticking, and start is idempotent', () => {
  const scheduler = testScheduler();
  let ticks = 0;
  const loop = new GameLoop(() => { ticks += 1; }, scheduler);
  loop.start();
  loop.start();
  scheduler.frame(16);
  assert.equal(loop.running, true);
  loop.stop();
  assert.equal(loop.running, false);
  assert.equal(scheduler.scheduled, false);
  scheduler.frame(16);
  assert.equal(ticks, 1);
});

await check('a tick that stops the loop is not rescheduled', () => {
  const scheduler = testScheduler();
  let ticks = 0;
  const loop = new GameLoop(() => { ticks += 1; loop.stop(); }, scheduler);
  loop.start();
  scheduler.frame(16);
  assert.equal(ticks, 1);
  assert.equal(scheduler.scheduled, false);
});

console.log('\nInputState:');

await check('players are independent', () => {
  const input = new InputState(2);
  input.set(0, 'left', true);
  input.set(1, 'left', true);
  input.set(1, 'left', false);
  input.beginFrame();
  assert.equal(input.player(0).held('left'), true);
  assert.equal(input.player(1).held('left'), false);
});

await check('pressed is true for exactly one frame', () => {
  const input = new InputState(1);
  input.set(0, 'a', true);
  input.beginFrame();
  assert.equal(input.player(0).pressed('a'), true);
  input.beginFrame();
  assert.equal(input.player(0).pressed('a'), false);
  assert.equal(input.player(0).held('a'), true, 'still held');
});

await check('a tap that starts and ends between frames is not swallowed', () => {
  const input = new InputState(1);
  input.set(0, 'b', true);
  input.set(0, 'b', false);
  input.beginFrame();
  assert.equal(input.player(0).pressed('b'), true);
  assert.equal(input.player(0).held('b'), false);
});

await check('holding does not re-fire pressed', () => {
  const input = new InputState(1);
  input.set(0, 'a', true);
  input.beginFrame();
  input.set(0, 'a', true); // a repeat from a polling source
  input.beginFrame();
  assert.equal(input.player(0).pressed('a'), false);
});

await check('an absent player reads as never pressed rather than throwing', () => {
  const input = new InputState(1);
  assert.equal(input.player(1).held('a'), false);
  assert.equal(input.player(4).pressed('start'), false);
  input.set(1, 'a', true);
});

console.log('\nNativeGameRuntime — the minimal contract:');

{
  const scheduler = testScheduler();
  const canvas = fakeCanvas();
  const game = minimalGame();
  let firstFrame = 0;
  const runtime = new NativeGameRuntime({
    canvas,
    game,
    scheduler,
    createAudio: () => null,
    onFirstFrame: () => { firstFrame += 1; },
  });
  await runtime.load();

  await check('a game with only init/update/render runs', () => {
    assert.equal(game.log[0], 'init');
    assert.deepEqual(game.log[1], ['render', true]);
  });

  await check('load sizes the canvas from the game resolution', () => {
    assert.equal(canvas.width, 200);
    assert.equal(canvas.height, 100);
  });

  await check('load draws one frame before the loop starts', () => {
    assert.equal(firstFrame, 1);
    assert.equal(scheduler.scheduled, false, 'not running yet');
  });

  await check('start runs update then render each frame', () => {
    runtime.start();
    scheduler.frame(16);
    const tail = game.log.slice(2);
    assert.deepEqual(tail[0], ['update', 0.016, false]);
    assert.deepEqual(tail[1], ['render', true]);
  });

  await check('a game with no serialize simply has no save', () => {
    assert.equal(runtime.readSave(), null);
    assert.equal(runtime.loadSave(new Uint8Array([1])), false);
  });

  await check('pause stops updates, resume continues them', () => {
    runtime.pause();
    const before = game.log.length;
    scheduler.frame(16);
    assert.equal(game.log.length, before, 'paused');
    runtime.resume();
    scheduler.frame(16);
    assert.ok(game.log.length > before, 'resumed');
  });

  await check('pause releases held buttons, so nothing is stuck on resume', () => {
    runtime.setButton(0, 'a', true);
    scheduler.frame(16);
    assert.equal(game.log.at(-2)[2], true, 'held while running');
    runtime.pause();
    runtime.resume();
    scheduler.frame(16);
    assert.equal(game.log.at(-2)[2], false, 'released by pause');
  });

  await check('destroy stops the loop, and is idempotent and inert', () => {
    runtime.destroy();
    const before = game.log.length;
    scheduler.frame(16);
    assert.equal(game.log.length, before);
    runtime.destroy();
    runtime.start();
    runtime.setButton(0, 'a', true);
    scheduler.frame(16);
    assert.equal(game.log.length, before, 'inert after destroy');
  });
}

console.log('\nNativeGameRuntime — players, saves and audio:');

{
  const scheduler = testScheduler();
  const game = {
    resolution: { width: 8, height: 8 },
    players: { min: 1, max: 2 },
    score: 0,
    best: 0,
    seenPlayers: 0,
    disposed: 0,
    reportSave: null,
    init(ctx) {
      this.score = 0;
      // init fully re-initializes, best score included. Carrying that across a
      // reset is the host's job, which is what makes the reset check real.
      this.best = 0;
      this.seenPlayers = ctx.players;
      this.reportSave = ctx.saveDirty;
    },
    update() { this.score += 1; },
    render() {},
    serialize() { return new Uint8Array([this.best]); },
    restore(data) { this.best = data[0]; },
    dispose() { this.disposed += 1; },
  };
  const audio = fakeAudio();
  let dirty = 0;
  const runtime = new NativeGameRuntime({
    canvas: fakeCanvas(),
    game,
    players: 2,
    scheduler,
    createAudio: () => audio.host,
    onSaveDirty: () => { dirty += 1; },
  });
  await runtime.load();

  await check('the session player count reaches the game', () => {
    assert.equal(runtime.players, 2);
    assert.equal(game.seenPlayers, 2);
  });

  await check('a player count outside the declared range is clamped', () => {
    const solo = new NativeGameRuntime({
      canvas: fakeCanvas(),
      game: minimalGame(),
      players: 4,
      scheduler: testScheduler(),
      createAudio: () => null,
    });
    assert.equal(solo.players, 1);
  });

  await check('setButton is player-indexed all the way into the game', async () => {
    const seen = [];
    const twoPlayer = {
      resolution: { width: 8, height: 8 },
      players: { min: 2, max: 2 },
      init() {},
      update(_dt, input) {
        seen.push([input.player(0).held('left'), input.player(1).held('left')]);
      },
      render() {},
    };
    const s = testScheduler();
    const two = new NativeGameRuntime({
      canvas: fakeCanvas(), game: twoPlayer, scheduler: s, createAudio: () => null,
    });
    await two.load();
    two.start();
    two.setButton(1, 'left', true);
    s.frame(16);
    assert.deepEqual(seen[0], [false, true]);
  });

  await check('the game can report that persistent state changed', () => {
    assert.equal(dirty, 0);
    game.reportSave();
    assert.equal(dirty, 1);
  });

  await check('serialize and restore round-trip through the runtime', () => {
    assert.equal(runtime.loadSave(new Uint8Array([42])), true);
    assert.deepEqual(runtime.readSave(), new Uint8Array([42]));
  });

  await check('a save the game rejects does not brick it', async () => {
    const brittle = {
      resolution: { width: 8, height: 8 },
      players: { min: 1, max: 1 },
      init() {}, update() {}, render() {},
      restore() { throw new Error('bad save'); },
    };
    const r = new NativeGameRuntime({
      canvas: fakeCanvas(), game: brittle, scheduler: testScheduler(), createAudio: () => null,
    });
    await r.load();
    assert.equal(r.loadSave(new Uint8Array([9])), false);
  });

  await check('reset rebuilds run state but carries the save across', async () => {
    runtime.start();
    scheduler.frame(16);
    assert.ok(game.score > 0);
    await runtime.reset();
    assert.equal(game.score, 0, 'run state rebuilt');
    assert.equal(game.best, 42, 'save survived reset');
  });

  await check('reset leaves a running game running', () => {
    assert.equal(scheduler.scheduled, true);
    const before = game.score;
    scheduler.frame(16);
    assert.ok(game.score > before);
  });

  await check('mute is host-owned, so the game never participates', () => {
    runtime.setMuted(true);
    assert.equal(audio.out.gain.value, 0);
    runtime.setMuted(false);
    assert.equal(audio.out.gain.value, 1);
  });

  await check('audio unlocks on resume and closes on destroy', () => {
    const before = audio.resumes;
    runtime.resume();
    assert.ok(audio.resumes > before, 'resume unlocks audio');
    runtime.destroy();
    assert.equal(audio.closed, true);
    assert.equal(game.disposed, 1, 'dispose called once');
  });
}

console.log('\nFailure behaviour and isolation:');

await check('a game that throws stops the loop instead of throwing every frame', async () => {
  const scheduler = testScheduler();
  const errors = [];
  const exploding = {
    resolution: { width: 8, height: 8 },
    players: { min: 1, max: 1 },
    init() {}, render() {},
    update() { throw new Error('boom'); },
  };
  const runtime = new NativeGameRuntime({
    canvas: fakeCanvas(),
    game: exploding,
    scheduler,
    createAudio: () => null,
    onError: (error) => errors.push(error.message),
  });
  await runtime.load();
  runtime.start();
  scheduler.frame(16);
  assert.deepEqual(errors, ['boom']);
  assert.equal(scheduler.scheduled, false, 'loop stopped');
});

await check('the runtime touches the frame clock only through the scheduler', () => {
  // Read compiled, not source: a mention inside a doc comment should not pass
  // for a real one, and should not fail either.
  const compiled = fs.readFileSync(`${OUT}/native/NativeGameRuntime.js`, 'utf8');
  assert.ok(!/requestAnimationFrame|performance\.now/.test(compiled));
  // browserScheduler is the one place allowed to know about the browser.
  const loop = fs.readFileSync(`${OUT}/native/GameLoop.js`, 'utf8');
  assert.ok(/requestAnimationFrame/.test(loop), 'the seam has to exist somewhere');
});

await check('no page or component pulls the native runtime into a retro bundle', () => {
  // Stage 6 wires native games into the library; when it does, the import
  // must be dynamic so a Game Boy page never ships this code. Until then the
  // honest assertion is that nothing imports it at all.
  const roots = [`${REPO}/src/app`, `${REPO}/src/components`];
  const offenders = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${item.name}`;
      if (item.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(item.name) && /from '@\/native/.test(fs.readFileSync(full, 'utf8'))) {
        offenders.push(path.relative(REPO, full));
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(offenders, []);
});

await check('the native runtime does not import emulator code', () => {
  for (const file of fs.readdirSync(`${REPO}/src/native`)) {
    const source = fs.readFileSync(`${REPO}/src/native/${file}`, 'utf8');
    for (const line of source.split('\n')) {
      const isImport = /^\s*import\s/.test(line);
      if (!isImport) continue;
      const isTypeOnly = /^\s*import type\s/.test(line);
      assert.ok(
        !/emulation/.test(line) || isTypeOnly,
        `${file} imports emulator code at runtime: ${line.trim()}`,
      );
    }
  }
});

console.log(`\n${passed} native runtime checks pass`);
if (failures.length) {
  console.log('failed:', failures.join(', '));
  process.exit(1);
}
