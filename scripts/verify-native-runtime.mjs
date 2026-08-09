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

await check('the app only reaches native code through a dynamic import', () => {
  // A static import would put the runtime in the route bundle that Game Boy
  // pages also load. Types are erased, so `import type` is fine. What the
  // browser actually downloads is checked separately by verify:bundles.
  const roots = [`${REPO}/src/app`, `${REPO}/src/components`];
  const offenders = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${item.name}`;
      if (item.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(item.name)) continue;
      for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
        if (!/from '@\/native/.test(line)) continue;
        if (/^\s*import\s+type\s/.test(line)) continue;
        if (/^\s*import\s/.test(line)) offenders.push(`${path.relative(REPO, full)}: ${line.trim()}`);
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(offenders, []);
});

await check('the native runtime does not import emulator code', () => {
  const files = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory()) walk(`${dir}/${item.name}`);
      else if (item.name.endsWith('.ts')) files.push(`${dir}/${item.name}`);
    }
  };
  walk(`${REPO}/src/native`);
  assert.ok(files.length >= 7, 'found the native sources');
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const line of source.split('\n')) {
      const isImport = /^\s*import\s/.test(line);
      if (!isImport) continue;
      const isTypeOnly = /^\s*import type\s/.test(line);
      assert.ok(
        !/emulation/.test(line) || isTypeOnly,
        `${path.relative(REPO, file)} imports emulator code at runtime: ${line.trim()}`,
      );
    }
  }
});

/**
 * The Originals are checked by playing them, not by reading their internals.
 *
 * The canvas records every draw call, so the harness sees exactly what a
 * player sees — ship position, score, banners — and drives the games back
 * through the runtime's own setButton. Nothing below reaches into private
 * state, which is why these checks would survive a rewrite of either game.
 */
function recordingCanvas() {
  const calls = [];
  const gradient = { addColorStop() {} };
  const context = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          return () => gradient;
        }
        if (prop in target) return target[prop];
        return (...args) => { calls.push([prop, ...args]); };
      },
      set(target, prop, value) {
        target[prop] = value;
        calls.push(['=', prop, value]);
        return true;
      },
    },
  );
  return {
    width: 0,
    height: 0,
    getContext: () => context,
    calls,
    clear() { calls.length = 0; },
  };
}

/** Holds buttons across frames, emitting only edges, like a real input source. */
function pad(runtime) {
  const held = new Set();
  return {
    set(player, wanted) {
      const want = new Set(wanted.map((button) => `${player}:${button}`));
      for (const key of want) {
        if (!held.has(key)) {
          held.add(key);
          runtime.setButton(player, key.split(':')[1], true);
        }
      }
      for (const key of [...held]) {
        if (key.startsWith(`${player}:`) && !want.has(key)) {
          held.delete(key);
          runtime.setButton(player, key.split(':')[1], false);
        }
      }
    },
  };
}

const drift = require(`${OUT}/native/games/drift/index.js`);
const ringOut = require(`${OUT}/native/games/ring-out/index.js`);
const { PALETTE } = require(`${OUT}/native/games/palette.js`);

/** Reads the Drift screen: where the ship is, which way it faces, the score. */
function readDrift(calls) {
  const view = { ship: null, angle: null, score: null, best: null, lost: null };
  for (const [op, ...args] of calls) {
    if (op === 'translate') view.ship = { x: args[0], y: args[1] };
    else if (op === 'rotate') view.angle = args[0];
    else if (op === 'fillText') {
      const text = String(args[0]);
      if (/^\d\d$/.test(text)) view.score = Number(text);
      else if (text.startsWith('BEST ')) view.best = Number(text.slice(5));
      else if (text === 'BURNED UP' || text === 'LOST IN SPACE') view.lost = text;
      else if (text === 'NEW BEST') view.newBest = true;
    }
  }
  return view;
}

/** Reads the Ring Out screen: both fighters, and whatever the banner says. */
function readRingOut(calls) {
  const view = { texts: [] };
  let fill = null;
  for (const [op, ...args] of calls) {
    if (op === '=' && args[0] === 'fillStyle') fill = args[1];
    else if (op === 'arc' && args[2] === 13) {
      if (fill === PALETTE.lcd) view.p1 = { x: args[0], y: args[1] };
      else if (fill === PALETTE.amber) view.p2 = { x: args[0], y: args[1] };
    } else if (op === 'fillText') view.texts.push(String(args[0]));
  }
  return view;
}

async function bootGame(create, options = {}) {
  const canvas = recordingCanvas();
  const scheduler = testScheduler();
  const runtime = new NativeGameRuntime({
    canvas,
    game: create(),
    scheduler,
    createAudio: () => null,
    ...options,
  });
  await runtime.load();
  runtime.start();
  return { runtime, canvas, scheduler, buttons: pad(runtime) };
}

/** Advances one 60fps frame and returns what was drawn. */
function step(session, read) {
  session.canvas.clear();
  session.scheduler.frame(16);
  return read(session.canvas.calls);
}

console.log('\nDrift:');

await check('doing nothing holds a stable orbit — gravity teaches itself', async () => {
  const session = await bootGame(drift.default);
  let view = null;
  const radii = [];
  for (let i = 0; i < 600; i += 1) {
    view = step(session, readDrift);
    if (view.ship) {
      radii.push(Math.hypot(view.ship.x - drift.FIELD.center.x, view.ship.y - drift.FIELD.center.y));
    }
  }
  assert.equal(view.lost, null, 'still flying after ten seconds');
  assert.ok(Math.min(...radii) > 95 && Math.max(...radii) < 125, `orbit held: ${Math.min(...radii).toFixed(0)}–${Math.max(...radii).toFixed(0)}`);
});

await check('thrust is the only thing that changes the orbit', async () => {
  const session = await bootGame(drift.default);
  session.buttons.set(0, ['a']);
  let view = null;
  for (let i = 0; i < 60; i += 1) view = step(session, readDrift);
  const radius = Math.hypot(view.ship.x - drift.FIELD.center.x, view.ship.y - drift.FIELD.center.y);
  assert.ok(radius > drift.FIELD.startOrbit + 20, `thrust climbed to ${radius.toFixed(0)}`);
});

await check('over-thrusting loses the ship, and the run ends', async () => {
  const session = await bootGame(drift.default);
  session.buttons.set(0, ['a']);
  let view = null;
  for (let i = 0; i < 1200 && !view?.lost; i += 1) view = step(session, readDrift);
  assert.equal(view.lost, 'LOST IN SPACE');
});

/**
 * Flies the ship by looking at the screen. It reads the drawn position and
 * heading, holds a circular orbit and walks that orbit's radius toward the
 * next core, steering with the same two buttons a person has.
 *
 * Aiming straight at the core does not work, which is the game working: a
 * direct line passes through the star, and gravity wins. That the autopilot
 * has to fly orbits is evidence the physics is doing something.
 */
function fly(view, previous, dt) {
  if (!view.ship || view.angle === null) return [];
  const center = drift.FIELD.center;
  const target = drift.coreAt(view.score ?? 0);
  const targetRadius = Math.hypot(target.x - center.x, target.y - center.y);

  const velocity = previous
    ? { x: (view.ship.x - previous.x) / dt, y: (view.ship.y - previous.y) / dt }
    : { x: 0, y: 0 };

  const outX = view.ship.x - center.x;
  const outY = view.ship.y - center.y;
  const radius = Math.max(Math.hypot(outX, outY), 1);
  const radial = { x: outX / radius, y: outY / radius };
  const tangent = { x: -radial.y, y: radial.x };
  const spin = Math.sign(velocity.x * tangent.x + velocity.y * tangent.y) || 1;

  // Circular speed at the CURRENT radius: in a circular orbit gravity already
  // does the work, so a settled autopilot asks for no thrust at all.
  const orbitSpeed = Math.sqrt(drift.FIELD.mu / radius);
  const closing = Math.max(-28, Math.min(28, (targetRadius - radius) * 0.6));
  const wanted = {
    x: tangent.x * spin * orbitSpeed + radial.x * closing,
    y: tangent.y * spin * orbitSpeed + radial.y * closing,
  };

  const need = { x: (wanted.x - velocity.x) / 0.45, y: (wanted.y - velocity.y) / 0.45 };
  if (Math.hypot(need.x, need.y) < 6) return [];

  let error = Math.atan2(need.y, need.x) - view.angle;
  while (error > Math.PI) error -= Math.PI * 2;
  while (error < -Math.PI) error += Math.PI * 2;

  const buttons = [];
  if (error > 0.05) buttons.push('right');
  else if (error < -0.05) buttons.push('left');
  if (Math.abs(error) < 0.35) buttons.push('a');
  return buttons;
}

let driftSave = null;

await check('cores can be collected, and the score counts them', async () => {
  const session = await bootGame(drift.default);
  let view = step(session, readDrift);
  let previous = view.ship;
  for (let i = 0; i < 3600 && (view.score ?? 0) < 3; i += 1) {
    session.buttons.set(0, fly(view, previous, 1 / 62.5));
    previous = view.ship;
    view = step(session, readDrift);
  }
  assert.equal(view.lost, null, 'survived the run');
  assert.ok((view.score ?? 0) >= 3, `collected ${view.score} cores`);
  assert.equal(view.best, view.score, 'best tracks the run while it is the best');
  driftSave = session.runtime.readSave();
  assert.ok(driftSave && driftSave.byteLength > 0, 'a save was produced');
});

await check('the best score comes back on a later visit', async () => {
  const session = await bootGame(drift.default);
  assert.equal(session.runtime.loadSave(driftSave), true);
  const view = step(session, readDrift);
  assert.ok(view.best >= 3, `best restored as ${view.best}`);
  assert.equal(view.score, 0, 'but the run itself starts fresh');
});

await check('a corrupt or absurd save is ignored rather than shown as a record', async () => {
  const session = await bootGame(drift.default);
  const absurd = new Uint8Array([1, 0xff, 0xff, 0xff, 0xff]);
  session.runtime.loadSave(absurd);
  const view = step(session, readDrift);
  assert.equal(view.best, 0);
});

await check('a lost run restarts on A, keeping the best score', async () => {
  const session = await bootGame(drift.default);
  session.runtime.loadSave(driftSave);
  session.buttons.set(0, ['a']);
  let view = null;
  for (let i = 0; i < 1200 && !view?.lost; i += 1) view = step(session, readDrift);
  assert.ok(view.lost, 'run ended');

  session.buttons.set(0, []);
  for (let i = 0; i < 60; i += 1) view = step(session, readDrift);
  session.buttons.set(0, ['a']);
  view = step(session, readDrift);
  session.buttons.set(0, []);
  view = step(session, readDrift);

  assert.equal(view.lost, null, 'flying again');
  assert.equal(view.score, 0, 'new run');
  assert.ok(view.best >= 3, 'best kept');
});

console.log('\nRing Out:');

await check('needs two players, and the runtime gives it two', async () => {
  const session = await bootGame(ringOut.default);
  assert.equal(session.runtime.players, 2);
});

await check('each player drives only their own fighter', async () => {
  const session = await bootGame(ringOut.default);
  let view = null;
  for (let i = 0; i < 60; i += 1) view = step(session, readRingOut); // past READY
  const start = { p1: view.p1, p2: view.p2 };

  session.buttons.set(0, ['right']);
  for (let i = 0; i < 30; i += 1) view = step(session, readRingOut);
  assert.ok(view.p1.x > start.p1.x + 5, 'player one moved');
  assert.ok(Math.abs(view.p2.x - start.p2.x) < 0.5, 'player two did not');

  session.buttons.set(0, []);
  session.buttons.set(1, ['up']);
  const beforeP2 = view.p2.y;
  for (let i = 0; i < 30; i += 1) view = step(session, readRingOut);
  assert.ok(view.p2.y < beforeP2 - 5, 'player two moved on their own input');
});

await check('a dash is a burst, and it has a cooldown', async () => {
  const session = await bootGame(ringOut.default);
  let view = null;
  for (let i = 0; i < 60; i += 1) view = step(session, readRingOut);

  session.buttons.set(0, ['up', 'a']);
  view = step(session, readRingOut);
  const dashStart = view.p1.y;
  for (let i = 0; i < 9; i += 1) view = step(session, readRingOut);
  const dashed = dashStart - view.p1.y;

  session.buttons.set(0, ['up']);
  view = step(session, readRingOut);
  session.buttons.set(0, ['up', 'a']); // immediate second press, still cooling down
  const retryStart = view.p1.y;
  for (let i = 0; i < 9; i += 1) view = step(session, readRingOut);
  const retried = retryStart - view.p1.y;

  assert.ok(dashed > 30, `dash covered ${dashed.toFixed(0)}px`);
  assert.ok(retried < dashed * 0.75, `cooldown held the second dash back (${retried.toFixed(0)}px)`);
});

await check('the shrinking ring resolves a round, and the winner scores', async () => {
  const session = await bootGame(ringOut.default);
  let view = null;
  for (let i = 0; i < 60; i += 1) view = step(session, readRingOut);
  // Player one walks to the middle; player two stands still and the ring
  // closes on them. No fighting required to prove a round can end.
  session.buttons.set(0, ['right']);
  for (let i = 0; i < 60; i += 1) view = step(session, readRingOut);
  session.buttons.set(0, []);
  for (let i = 0; i < 1200 && !view.texts.some((t) => t.endsWith('SCORES')); i += 1) {
    view = step(session, readRingOut);
  }
  assert.ok(view.texts.includes('P1 SCORES'), `banner said: ${view.texts.join(', ')}`);
});

await check('three rounds decide a match, and either player can rematch', async () => {
  const session = await bootGame(ringOut.default);
  let view = null;
  const seen = new Set();
  for (let i = 0; i < 6000; i += 1) {
    // Player one keeps to the middle; player two never moves, so the ring
    // decides every round the same way.
    session.buttons.set(0, view?.p1 && view.p1.x < 158 ? ['right'] : []);
    view = step(session, readRingOut);
    for (const text of view.texts) seen.add(text);
    if (seen.has('P1 WINS')) break;
  }
  assert.ok(seen.has('P1 WINS'), 'match ended');

  // Player two calls the rematch, which proves it is not player one's button.
  for (let i = 0; i < 60; i += 1) view = step(session, readRingOut);
  session.buttons.set(1, ['a']);
  view = step(session, readRingOut);
  session.buttons.set(1, []);
  for (let i = 0; i < 5; i += 1) view = step(session, readRingOut);
  assert.ok(view.texts.includes('READY'), `rematch started: ${view.texts.join(', ')}`);
});

await check('Ring Out has nothing to save, and says so', async () => {
  const session = await bootGame(ringOut.default);
  assert.equal(session.runtime.readSave(), null);
});

console.log(`\n${passed} native runtime checks pass`);
if (failures.length) {
  console.log('failed:', failures.join(', '));
  process.exit(1);
}
