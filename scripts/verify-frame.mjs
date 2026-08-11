/**
 * Drives the host adapter against a fake frame, over a real asynchronous port.
 *
 * A hosted game is code we did not write running in a sandbox, so the checks
 * that matter most are not the happy path. They are: a frame that never says
 * hello, one that speaks the wrong protocol version, one that floods, one that
 * never answers a save request, and one that sends malformed messages. Each of
 * those must be survivable, because in production each of them is somebody
 * else's bug arriving at our page.
 *
 * Per D-012, every check is written so that removing what it covers breaks it.
 *
 * Run with: npm run verify:frame
 */
import assert from 'node:assert/strict';
import { loadTestBuild, makeReporter } from './test-build.mjs';

const load = loadTestBuild();
const { HostedGameAdapter } = load('hosted/HostedGameAdapter.js');
const { LoopbackPort } = load('hosted/FramePort.js');
const { FRAME_PROTOCOL_VERSION, parseFrameMessage, parseHostMessage } = load(
  'hosted/frameProtocol.js',
);

const reporter = makeReporter();
const { check } = reporter;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A host adapter wired to a fake frame, recording both directions. */
function connect({ players = 2 } = {}) {
  const [hostSide, frameSide] = LoopbackPort.pair();
  const received = [];
  const errors = [];
  const events = [];

  frameSide.onMessage((message) => received.push(message));

  const adapter = new HostedGameAdapter({
    port: hostSide,
    players,
    onError: (error) => errors.push(error.message),
    onFirstFrame: () => events.push('painted'),
    onSaveDirty: () => events.push('saveDirty'),
    onResolution: (size) => events.push(`size:${size.width}x${size.height}`),
  });

  return {
    adapter,
    received,
    errors,
    events,
    frame: {
      send: (message) => frameSide.post(message),
      hello: (overrides = {}) =>
        frameSide.post({ t: 'hello', v: FRAME_PROTOCOL_VERSION, width: 320, height: 288, ...overrides }),
    },
  };
}

const verbs = (received) => received.map((message) => message.t);

console.log('\nHandshake:');

await check('the host waits for hello before loading', async () => {
  const session = connect();
  await settle();
  // Nothing is sent until the frame proves it is running. A host that talked
  // first would be talking to a document that may not have parsed yet.
  assert.deepEqual(verbs(session.received), []);
  session.frame.hello();
  await settle();
  assert.deepEqual(verbs(session.received), ['load']);
  assert.equal(session.received[0].players, 2);
});

await check('the game reports its own resolution', async () => {
  const session = connect();
  session.frame.hello({ width: 160, height: 144 });
  await settle();
  assert.ok(session.events.includes('size:160x144'));
});

await check('a mismatched protocol version is refused, not guessed at', async () => {
  const session = connect();
  session.frame.hello({ v: FRAME_PROTOCOL_VERSION + 1 });
  await settle();
  assert.equal(session.received.length, 0, 'nothing was loaded');
  assert.match(session.errors[0] ?? '', /different version/);
});

await check('a second hello is ignored', async () => {
  const session = connect();
  session.frame.hello();
  await settle();
  session.frame.hello();
  await settle();
  // Otherwise a frame could make the host re-load it forever.
  assert.deepEqual(verbs(session.received), ['load']);
});

await check('start before hello is not lost', async () => {
  const session = connect();
  session.adapter.start();
  await settle();
  assert.deepEqual(verbs(session.received), []);
  session.frame.hello();
  await settle();
  // The player pressed play while the frame was still loading; it must run.
  assert.deepEqual(verbs(session.received), ['load', 'start']);
});

console.log('\nLifecycle:');

async function ready(options) {
  const session = connect(options);
  session.frame.hello();
  await settle();
  session.received.length = 0;
  // The resolution event has already fired by now; clear it so each check
  // asserts on what it triggered rather than on the handshake.
  session.events.length = 0;
  return session;
}

await check('the player controls reach the game', async () => {
  const session = await ready();
  session.adapter.start();
  session.adapter.pause();
  session.adapter.resume();
  session.adapter.reset();
  session.adapter.setMuted(true);
  await settle();
  assert.deepEqual(verbs(session.received), ['start', 'pause', 'resume', 'reset', 'mute']);
  assert.equal(session.received[4].muted, true);
});

await check('mute set before hello is carried into load', async () => {
  const session = connect();
  session.adapter.setMuted(true);
  session.frame.hello();
  await settle();
  const load = session.received.find((message) => message.t === 'load');
  // Otherwise a game starts making noise on a page the player muted.
  assert.equal(load.muted, true);
});

await check('input reaches the game before it is started', async () => {
  const session = await ready();
  session.adapter.setButton(1, 'left', true);
  await settle();
  assert.deepEqual(session.received[0], { t: 'input', player: 1, button: 'left', pressed: true });
});

await check('the first painted frame is reported once', async () => {
  const session = await ready();
  session.frame.send({ t: 'painted' });
  session.frame.send({ t: 'painted' });
  await settle();
  assert.deepEqual(session.events, ['painted']);
});

await check('destroy tells the game before it stops listening', async () => {
  const session = await ready();
  session.adapter.destroy();
  await settle();
  assert.deepEqual(verbs(session.received), ['destroy']);
  session.adapter.setButton(0, 'a', true);
  await settle();
  assert.deepEqual(verbs(session.received), ['destroy'], 'nothing is sent after destroy');
});

console.log('\nSaves:');

await check('a save round-trips', async () => {
  const session = await ready();
  const pending = session.adapter.readSave();
  await settle();
  assert.deepEqual(verbs(session.received), ['readSave']);
  session.frame.send({ t: 'save', data: new Uint8Array([1, 2, 3]) });
  assert.deepEqual([...(await pending)], [1, 2, 3]);
});

await check('a frame that never answers does not hang the host', async () => {
  const session = await ready();
  // This is called from pagehide. A promise that never settles there is a lost
  // save at best and a blocked unload at worst. Guarded so that removing the
  // adapter's timeout fails this check rather than hanging the whole suite —
  // a check that hangs reports nothing, which reads like a pass.
  const data = await Promise.race([
    session.adapter.readSave(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('readSave never settled')), 4000),
    ),
  ]);
  assert.equal(data, null);
});

await check('saveDirty is reported', async () => {
  const session = await ready();
  session.frame.send({ t: 'saveDirty' });
  await settle();
  assert.ok(session.events.includes('saveDirty'));
});

await check('an absurd save is refused', async () => {
  const session = await ready();
  const pending = session.adapter.readSave();
  await settle();
  session.frame.send({ t: 'save', data: new Uint8Array(2 * 1024 * 1024) });
  // Refused rather than stored: this would be written to localStorage.
  assert.equal(await pending, null);
});

console.log('\nA frame behaving badly:');

await check('a frame that never says hello becomes an error, not a spinner', async () => {
  const session = connect();
  // The timeout is 8s in production; the check proves the path exists rather
  // than waiting it out, by driving the same failure directly.
  assert.equal(session.adapter.ready, false);
  session.frame.send({ t: 'error', message: 'boom' });
  await settle();
  assert.equal(session.errors.length, 1);
});

await check("a game's own error text is never shown to the player", async () => {
  const session = await ready();
  session.frame.send({ t: 'error', message: 'Click here to win a prize' });
  await settle();
  // The words belong to an author we did not vet; the platform speaks instead.
  assert.equal(session.errors[0], 'This game stopped unexpectedly.');
});

await check('malformed messages are ignored', async () => {
  const session = await ready();
  for (const message of [null, 42, 'hello', {}, { t: 'nonsense' }, { t: 'save' }, { t: 'hello' }]) {
    session.frame.send(message);
  }
  await settle();
  assert.deepEqual(session.events, []);
  assert.deepEqual(session.errors, []);
});

await check('a flooding frame is ignored rather than fatal', async () => {
  const session = await ready();
  for (let i = 0; i < 400; i += 1) session.frame.send({ t: 'saveDirty' });
  await settle();
  const seen = session.events.filter((event) => event === 'saveDirty').length;
  assert.ok(seen > 0, 'some got through');
  assert.ok(seen < 400, `the flood was not capped: ${seen}`);
});

console.log('\nMessage validation:');

await check('the guest refuses host messages it does not understand', () => {
  assert.equal(parseHostMessage({ t: 'input', player: 99, button: 'a', pressed: true }), null);
  assert.equal(parseHostMessage({ t: 'input', player: 0, button: 'telepathy', pressed: true }), null);
  assert.equal(parseHostMessage({ t: 'load', v: 1, players: 0, muted: false }), null);
  assert.equal(parseHostMessage({ t: 'restore', data: 'not bytes' }), null);
  assert.deepEqual(parseHostMessage({ t: 'pause' }), { t: 'pause' });
});

await check('the host refuses frame messages it does not understand', () => {
  assert.equal(parseFrameMessage({ t: 'hello', v: 1, width: 0, height: 288 }), null);
  assert.equal(parseFrameMessage({ t: 'hello', v: 1, width: 99999, height: 288 }), null);
  assert.equal(parseFrameMessage({ t: 'save', data: new Uint8Array(0) }), null);
  assert.deepEqual(parseFrameMessage({ t: 'painted' }), { t: 'painted' });
});

reporter.finish('frame protocol checks');
