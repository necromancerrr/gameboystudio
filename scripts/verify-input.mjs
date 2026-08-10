/**
 * Asserts the rules the input layer promises about players and slots.
 *
 * Slot assignment is the part of multiplayer that fails quietly: nothing throws
 * when two people end up driving player one, the game just feels broken. So
 * every rule gets a check, and per D-012 each is written so that removing the
 * behaviour it covers makes it fail.
 *
 * Run with: npm run verify:input
 */
import assert from 'node:assert/strict';
import { loadTestBuild, makeReporter } from './test-build.mjs';

const load = loadTestBuild();
const { PlayerSlots } = load('input/PlayerSlots.js');
const { InputRouter } = load('input/InputRouter.js');

const reporter = makeReporter();
const { check } = reporter;

const pad = (index, id = 'Test Controller') => ({
  kind: 'gamepad',
  key: String(index),
  label: id,
  memo: id,
});
const phone = (peer) => ({ kind: 'remote', key: peer, label: 'Phone' });
const keys = (scheme) => ({ kind: 'keyboard', key: scheme, label: 'Keyboard' });

console.log('\nSlot assignment:');

await check('a controller takes the lowest free slot', () => {
  const slots = new PlayerSlots(2);
  assert.equal(slots.attach(pad(0, 'A')), 0);
  assert.equal(slots.attach(pad(1, 'B')), 1);
});

await check('a third controller in a two-player game is refused', () => {
  const slots = new PlayerSlots(2);
  slots.attach(pad(0, 'A'));
  slots.attach(pad(1, 'B'));
  // Null rather than silently doubling up on player two, which would look like
  // a possessed character rather than a full game.
  assert.equal(slots.attach(pad(2, 'C')), null);
});

await check('a one-player game merges every controller onto player one', () => {
  const slots = new PlayerSlots(1);
  assert.equal(slots.attach(pad(0, 'A')), 0);
  assert.equal(slots.attach(pad(1, 'B')), 0);
});

await check('keyboard and touch never compete for a slot', () => {
  const slots = new PlayerSlots(2);
  slots.attach(pad(0, 'A')); // claims slot 0
  // Shared devices go where they are told, even into a claimed slot: someone
  // holding a pad can still reach over and hit Start on the keyboard.
  assert.equal(slots.attach(keys('p1'), 0), 0);
  assert.equal(slots.attach({ kind: 'touch', key: 'deck', label: 'Touch' }, 0), 0);
  assert.equal(slots.snapshot()[0].devices.length, 3);
  // And a shared device does not make the slot count as claimed.
  assert.equal(slots.snapshot()[1].claimed, false);
  assert.equal(slots.attach(keys('p2'), 1), 1);
  assert.equal(slots.snapshot()[1].claimed, false);
});

await check('re-attaching the same device does not duplicate or move it', () => {
  const slots = new PlayerSlots(2);
  slots.attach(pad(0, 'A'));
  slots.attach(pad(1, 'B'));
  // Gamepad polling re-attaches every pad on every animation frame.
  for (let i = 0; i < 10; i += 1) {
    assert.equal(slots.attach(pad(0, 'A')), 0);
    assert.equal(slots.attach(pad(1, 'B')), 1);
  }
  assert.equal(slots.snapshot()[0].devices.length, 1);
  assert.equal(slots.snapshot()[1].devices.length, 1);
});

await check('retain frees the slots of devices that vanished', () => {
  const slots = new PlayerSlots(2);
  slots.attach(pad(0, 'A'));
  slots.attach(pad(1, 'B'));
  const freed = slots.retain('gamepad', new Set(['0']));
  assert.deepEqual(freed, [1]);
  assert.equal(slots.snapshot()[1].claimed, false);
  // It must not touch other kinds — a phone is not gone because a pad is.
  slots.attach(phone('guest'));
  slots.retain('gamepad', new Set(['0']));
  assert.equal(slots.slotOf('remote', 'guest'), 1);
});

console.log('\nReconnection:');

await check('a controller that sleeps and returns lands back in its slot', () => {
  const slots = new PlayerSlots(2);
  slots.attach(pad(0, 'A'));
  slots.attach(pad(1, 'B'));
  // Both pads drop, so slot 0 is free and is what "lowest free slot" would
  // hand out. B then wakes up at a different browser index, which is what
  // Bluetooth pads do. Player two must not be promoted to player one for
  // having gone to sleep.
  slots.retain('gamepad', new Set());
  assert.equal(slots.attach(pad(7, 'B')), 1);
});

await check('two identical controllers do not fight over one slot', () => {
  const slots = new PlayerSlots(2);
  // Two DualSense pads report byte-identical id strings, so slot memory alone
  // would send both to the same place.
  assert.equal(slots.attach(pad(0, 'DualSense')), 0);
  assert.equal(slots.attach(pad(1, 'DualSense')), 1);
});

console.log('\nSwapping players:');

await check('swap exchanges every device, shared ones included', () => {
  const slots = new PlayerSlots(2);
  slots.attach(pad(0, 'A'));
  slots.attach(keys('p1'), 0);
  slots.attach(keys('p2'), 1);
  slots.swap(0, 1);
  assert.equal(slots.slotOf('gamepad', '0'), 1);
  assert.equal(slots.slotOf('keyboard', 'p1'), 1);
  // Moving only the pad would leave one person on half a control scheme.
  assert.equal(slots.slotOf('keyboard', 'p2'), 0);
});

await check('a lone controller can be player two', () => {
  const slots = new PlayerSlots(2);
  slots.attach(pad(0, 'A'));
  slots.swap(0, 1);
  assert.equal(slots.slotOf('gamepad', '0'), 1);
  assert.equal(slots.snapshot()[0].claimed, false);
  assert.equal(slots.snapshot()[1].claimed, true);
});

await check('a swap survives the controller reconnecting', () => {
  const slots = new PlayerSlots(2);
  slots.attach(pad(0, 'A'));
  slots.swap(0, 1);
  slots.retain('gamepad', new Set());
  // Without swap updating slot memory this returns 0 and silently undoes the
  // choice the player just made.
  assert.equal(slots.attach(pad(3, 'A')), 1);
});

console.log('\nSubscription:');

await check('snapshot is stable until something actually changes', () => {
  const slots = new PlayerSlots(2);
  const first = slots.snapshot();
  assert.equal(slots.snapshot(), first, 'same reference when nothing changed');
  slots.attach(pad(0, 'A'));
  assert.notEqual(slots.snapshot(), first, 'new reference after a change');
  const second = slots.snapshot();
  slots.attach(pad(0, 'A'));
  assert.equal(slots.snapshot(), second, 'a no-op re-attach is not a change');
});

await check('subscribers are told when slots change, and not otherwise', () => {
  const slots = new PlayerSlots(2);
  let calls = 0;
  const unsubscribe = slots.subscribe(() => {
    calls += 1;
  });
  slots.attach(pad(0, 'A'));
  assert.equal(calls, 1);
  slots.attach(pad(0, 'A'));
  assert.equal(calls, 1, 'idempotent re-attach must not notify');
  slots.swap(0, 1);
  assert.equal(calls, 2);
  unsubscribe();
  slots.attach(pad(1, 'B'));
  assert.equal(calls, 2, 'unsubscribed listeners stop hearing');
});

console.log('\nRouting:');

await check('players are independent', () => {
  const seen = [];
  const router = new InputRouter((player, button, pressed) =>
    seen.push(`${player}${pressed ? '+' : '-'}${button}`),
  );
  router.set(0, 'gamepad', 'left', true);
  router.set(1, 'keyboard', 'left', true);
  router.set(1, 'keyboard', 'left', false);
  // Player two letting go must not release player one's hold.
  assert.deepEqual(seen, ['0+left', '1+left', '1-left']);
});

await check('a button stays held while any of a player source holds it', () => {
  const seen = [];
  const router = new InputRouter((player, button, pressed) =>
    seen.push(`${pressed ? '+' : '-'}${button}`),
  );
  router.set(0, 'gamepad', 'a', true);
  router.set(0, 'touch', 'a', true);
  router.set(0, 'touch', 'a', false);
  assert.deepEqual(seen, ['+a'], 'no release while the pad still holds it');
  router.set(0, 'gamepad', 'a', false);
  assert.deepEqual(seen, ['+a', '-a']);
});

reporter.finish('input checks');
