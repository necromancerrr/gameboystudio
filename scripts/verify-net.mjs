/**
 * Drives a whole room in one process: relay, host and guest, over a real
 * asynchronous transport.
 *
 * The relay here is the same `RoomServer` the Worker deploys, and the transport
 * is a real one with a real await boundary rather than a mock — so a bug that
 * depends on a reply not arriving synchronously shows up here instead of on a
 * phone. Only the socket plumbing is substituted.
 *
 * Per D-012 every check is written so that removing what it covers breaks it.
 * The one that matters most is the last group: a guest whose phone dies mid
 * press must not leave a button held down on the host.
 *
 * Run with: npm run verify:net
 */
import assert from 'node:assert/strict';
import { loadTestBuild, makeReporter } from './test-build.mjs';

const load = loadTestBuild();
const { RoomServer } = load('net/RoomServer.js');
const { LoopbackTransport } = load('net/RemoteTransport.js');
const { HostRoom } = load('net/HostRoom.js');
const { GuestLink } = load('net/GuestLink.js');
const { PlayerSlots } = load('input/PlayerSlots.js');
const { InputRouter } = load('input/InputRouter.js');
const { PROTOCOL_VERSION, encodeMessage } = load('net/protocol.js');

const reporter = makeReporter();
const { check } = reporter;

/** Lets every queued microtask and timer settle before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let nextPeer = 0;

/** Connects a client transport to a RoomServer through a loopback pair. */
function connect(server) {
  const [clientSide, serverSide] = LoopbackTransport.pair();
  const socket = {
    id: `peer-${(nextPeer += 1)}`,
    send: (frame) => serverSide.send(frame),
    close: () => serverSide.close(),
  };
  serverSide.onFrame((frame) => server.onMessage(socket, frame));
  serverSide.onStateChange((state) => {
    if (state === 'closed') server.onClose(socket);
  });
  return { transport: clientSide, socket };
}

/** A room with a host, a two-seat slot table and a recording router. */
function makeRoom({ maxGuests = 3, slots = new PlayerSlots(2) } = {}) {
  const server = new RoomServer({ maxGuests, makeCode: () => 'AC2DE3' });
  const events = [];
  const router = new InputRouter((player, button, pressed) =>
    events.push(`${player}${pressed ? '+' : '-'}${button}`),
  );

  const { transport } = connect(server);
  let code = null;
  const host = new HostRoom({
    transport,
    slots,
    title: 'Ring Out',
    onInput: (player, button, pressed) => router.set(player, 'remote', button, pressed),
    onReleasePlayer: (player) => router.releaseSource(player, 'remote'),
    onCode: (value) => {
      code = value;
    },
  });

  return { server, host, slots, events, getCode: () => code };
}

/** A guest that has joined and been given a seat, unless told otherwise. */
async function joinGuest(server, code) {
  const { transport, socket } = connect(server);
  const record = { seat: null, rejected: null, status: null };
  const guest = new GuestLink({
    transport,
    code,
    onSeat: (seat) => {
      record.seat = seat;
    },
    onRejected: (reason) => {
      record.rejected = reason;
    },
    onStatus: (status) => {
      record.status = status;
    },
  });
  await settle();
  return { guest, record, transport, socket };
}

console.log('\nJoining a room:');

await check('the host is given a room code', async () => {
  const room = makeRoom();
  await settle();
  assert.equal(room.getCode(), 'AC2DE3');
});

await check('a guest lands in a seat and is told which one', async () => {
  const room = makeRoom();
  await settle();
  const { record, socket } = await joinGuest(room.server, room.getCode());
  assert.deepEqual(record.seat, { slot: 0, title: 'Ring Out' });
  // The host's slot table must agree with what the guest was told, or the
  // phone shows "Player 1" while driving somebody else.
  assert.equal(room.slots.slotOf('remote', socket.id), 0);
});

await check('a second guest takes the other seat, not the same one', async () => {
  const room = makeRoom();
  await settle();
  const first = await joinGuest(room.server, room.getCode());
  const second = await joinGuest(room.server, room.getCode());
  assert.equal(first.record.seat.slot, 0);
  assert.equal(second.record.seat.slot, 1);
});

await check('a guest arriving at a full game is told so', async () => {
  const room = makeRoom();
  await settle();
  await joinGuest(room.server, room.getCode());
  await joinGuest(room.server, room.getCode());
  const third = await joinGuest(room.server, room.getCode());
  // A phone that looks connected and does nothing is the worst outcome here.
  assert.equal(third.record.rejected, 'full');
  assert.equal(third.record.seat, null);
});

await check('a wrong code does not open someone else a room', async () => {
  const room = makeRoom();
  await settle();
  const { record } = await joinGuest(room.server, 'ZZZZZZ');
  assert.equal(record.rejected, 'no-room');
  assert.equal(record.seat, null);
});

await check('a mismatched protocol version is refused', async () => {
  const server = new RoomServer({ makeCode: () => 'AC2DE3' });
  const { transport, socket } = connect(server);
  const seen = [];
  transport.onFrame((frame) => seen.push(JSON.parse(frame)));
  transport.send(encodeMessage({ t: 'host', v: PROTOCOL_VERSION + 1 }));
  await settle();
  assert.equal(seen[0]?.t, 'err');
  assert.equal(seen[0]?.code, 'bad-version');
  assert.ok(socket);
});

console.log('\nInput over the wire:');

await check('a button pressed on a phone reaches the host as that player', async () => {
  const room = makeRoom();
  await settle();
  const first = await joinGuest(room.server, room.getCode());
  const second = await joinGuest(room.server, room.getCode());

  first.guest.setButton('right', true);
  second.guest.setButton('up', true);
  await settle();
  assert.deepEqual(room.events, ['0+right', '1+up']);
});

await check('only edges are sent, so a held button is one message', async () => {
  const room = makeRoom();
  await settle();
  const { guest } = await joinGuest(room.server, room.getCode());
  guest.setButton('a', true);
  guest.setButton('a', true);
  guest.setButton('a', true);
  await settle();
  guest.setButton('a', false);
  await settle();
  assert.deepEqual(room.events, ['0+a', '0-a']);
});

await check('a guest with no seat cannot press anything', async () => {
  const room = makeRoom();
  await settle();
  await joinGuest(room.server, room.getCode());
  await joinGuest(room.server, room.getCode());
  const third = await joinGuest(room.server, room.getCode());
  room.events.length = 0;
  third.guest.setButton('start', true);
  await settle();
  assert.deepEqual(room.events, []);
});

console.log('\nLeaving, gracefully or otherwise:');

await check('a phone that dies mid-press does not leave a button held', async () => {
  const room = makeRoom();
  await settle();
  const { guest, transport } = await joinGuest(room.server, room.getCode());
  guest.setButton('left', true);
  await settle();
  assert.deepEqual(room.events, ['0+left']);

  // Not a clean goodbye: the socket simply goes away, which is what a locked
  // phone or a dropped Wi-Fi connection actually looks like. D-010 learned
  // this from a yanked USB cable; over a network it is routine.
  transport.close();
  await settle();
  assert.deepEqual(room.events, ['0+left', '0-left']);
  assert.equal(room.slots.snapshot()[0].claimed, false);
});

await check('the freed seat is given to the next guest', async () => {
  const room = makeRoom();
  await settle();
  const first = await joinGuest(room.server, room.getCode());
  first.transport.close();
  await settle();
  const second = await joinGuest(room.server, room.getCode());
  assert.equal(second.record.seat.slot, 0);
});

await check('when the host leaves, guests are told rather than left hanging', async () => {
  const room = makeRoom();
  await settle();
  const { record } = await joinGuest(room.server, room.getCode());
  assert.equal(record.seat.slot, 0);
  room.host.close();
  await settle();
  assert.equal(record.rejected, 'closed');
  assert.equal(record.seat, null);
});

await check('closing the host room releases every remote button', async () => {
  const room = makeRoom();
  await settle();
  const { guest } = await joinGuest(room.server, room.getCode());
  guest.setButton('down', true);
  await settle();
  room.host.close();
  await settle();
  assert.deepEqual(room.events, ['0+down', '0-down']);
});

console.log('\nThe relay refuses what it should:');

await check('reserved channels are refused, not quietly dropped', async () => {
  const room = makeRoom();
  await settle();
  const { transport } = connect(room.server);
  const seen = [];
  transport.onFrame((frame) => seen.push(JSON.parse(frame)));
  transport.send(encodeMessage({ t: 'join', v: PROTOCOL_VERSION, code: room.getCode() }));
  await settle();
  // frames and state are named in the protocol and implemented by nothing.
  // A client that starts using one has to find out immediately. See D-016.
  transport.send(encodeMessage({ t: 'msg', ch: 'frames', d: { anything: true } }));
  await settle();
  const error = seen.find((message) => message.t === 'err');
  assert.equal(error?.code, 'bad-message');
  assert.equal(error?.detail, 'unsupported channel');
});

await check('an oversized frame is refused', async () => {
  const room = makeRoom();
  await settle();
  const { transport } = connect(room.server);
  const seen = [];
  transport.onFrame((frame) => seen.push(JSON.parse(frame)));
  transport.send(encodeMessage({ t: 'join', v: PROTOCOL_VERSION, code: room.getCode() }));
  await settle();
  transport.send(JSON.stringify({ t: 'msg', ch: 'input', d: { junk: 'x'.repeat(4000) } }));
  await settle();
  assert.equal(seen.find((message) => message.t === 'err')?.code, 'bad-message');
});

await check('a flood is cut off', async () => {
  const room = makeRoom();
  await settle();
  const { guest, record, transport } = await joinGuest(room.server, room.getCode());
  assert.ok(record.seat, 'joined before flooding');
  const seen = [];
  transport.onFrame((frame) => seen.push(JSON.parse(frame)));
  // Far past any human's button rate, and far below what would make this relay
  // useful to someone wanting a free message bus.
  for (let i = 0; i < 400; i += 1) {
    guest.setButton('a', i % 2 === 0);
  }
  await settle();
  assert.equal(seen.find((message) => message.t === 'err')?.code, 'too-fast');
});

await check('a guest cannot message another guest through the relay', async () => {
  const room = makeRoom();
  await settle();
  const first = await joinGuest(room.server, room.getCode());
  const second = await joinGuest(room.server, room.getCode());
  const seen = [];
  second.transport.onFrame((frame) => seen.push(JSON.parse(frame)));
  // A room code is a capability to play, not to reach the other players.
  first.transport.send(
    encodeMessage({ t: 'msg', ch: 'control', to: second.socket.id, d: { c: 'full' } }),
  );
  await settle();
  assert.deepEqual(seen, []);
  assert.ok(first.record.seat, 'the sender is still in the room');
});

await check('a second host cannot take over an existing room', async () => {
  const room = makeRoom();
  await settle();
  const { transport } = connect(room.server);
  const seen = [];
  transport.onFrame((frame) => seen.push(JSON.parse(frame)));
  transport.send(encodeMessage({ t: 'host', v: PROTOCOL_VERSION }));
  await settle();
  // Otherwise a stranger could seize the code someone already handed a friend.
  assert.equal(seen.find((message) => message.t === 'err')?.code, 'bad-message');
  assert.equal(room.getCode(), 'AC2DE3');
});

console.log('\nStatus:');

await check('guests are told when their buttons are doing nothing', async () => {
  const room = makeRoom();
  await settle();
  const { record } = await joinGuest(room.server, room.getCode());
  room.host.broadcastStatus(true, false);
  await settle();
  assert.deepEqual(record.status, { paused: true, waiting: false });
});

console.log('\nRuntime independence:');

/**
 * The architectural claim of D-016, tested rather than asserted: remote input
 * lives in the input layer, below both runtimes, so it drives an emulated Game
 * Boy exactly as it drives a native game. No product code is involved on the
 * retro side — `GameBoyPlayer` is deliberately untouched and retro multiplayer
 * is not a feature — this checks that the layering is real.
 *
 * The press travels the whole way: guest -> loopback -> RoomServer -> HostRoom
 * -> InputRouter -> binjgb's joypad buffer. Following the D-012 pattern from
 * verify:catalog, both runs advance identical emulated time and differ only in
 * whether the phone was holding Start, so a difference can only be the input.
 */
await check('a phone can drive a Game Boy game, with no retro code involved', async () => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const CPU_TICKS_PER_SECOND = 4194304;
  const EVENT_UNTIL_TICKS = 4;

  const glue = fs.readFileSync(`${REPO}/public/emulator/binjgb/binjgb.js`, 'utf8');
  const sandbox = {
    globalThis: null,
    console: { log() {}, error() {} },
    fetch,
    URL,
    TextDecoder,
    performance,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${glue}\n;globalThis.__Binjgb = Binjgb;`, sandbox);
  const wasmBinary = fs.readFileSync(`${REPO}/public/emulator/binjgb/binjgb.wasm`);

  const screenAfter = async (phonePressesStart) => {
    const mod = await sandbox.__Binjgb({ wasmBinary });
    const rom = fs.readFileSync(`${REPO}/public/roms/tobutobugirl.gb`);
    const size = (rom.byteLength + 0x7fff) & ~0x7fff;
    const ptr = mod._malloc(size);
    new Uint8Array(mod.HEAP8.buffer, ptr, size).fill(0).set(rom);
    const core = mod._emulator_new_simple(ptr, size, 44100, 4096, 2);
    // Without this every press is silently dropped. See D-006 and D-012.
    mod._emulator_set_default_joypad_callback(core, mod._joypad_new());

    // The router writes to the core the way the retro player does: one joypad,
    // every player collapsed onto it, which is what a one-player console is.
    const server = new RoomServer({ makeCode: () => 'AC2DE3' });
    const slots = new PlayerSlots(1);
    const router = new InputRouter((_player, button, pressed) => {
      if (button === 'start') mod._set_joyp_start(core, pressed ? 1 : 0);
    });

    const { transport } = connect(server);
    let code = null;
    const host = new HostRoom({
      transport,
      slots,
      title: 'Tobu Tobu Girl',
      onInput: (player, button, pressed) => router.set(player, 'remote', button, pressed),
      onReleasePlayer: (player) => router.releaseSource(player, 'remote'),
      onCode: (value) => {
        code = value;
      },
    });
    await settle();

    const { guest, record } = await joinGuest(server, code);
    assert.ok(record.seat, 'the phone got a seat on a Game Boy game');

    const advance = (seconds) => {
      const target = mod._emulator_get_ticks_f64(core) + CPU_TICKS_PER_SECOND * seconds;
      for (;;) {
        if (mod._emulator_run_until_f64(core, target) & EVENT_UNTIL_TICKS) break;
      }
    };

    advance(12);
    if (phonePressesStart) {
      guest.setButton('start', true);
      await settle();
    }
    advance(4);

    const frame = new Uint8Array(
      mod.HEAP8.buffer,
      mod._get_frame_buffer_ptr(core),
      mod._get_frame_buffer_size(core),
    );
    let hash = 0;
    for (let i = 0; i < frame.length; i += 13) hash = (hash * 31 + frame[i]) | 0;

    host.close();
    mod._emulator_delete(core);
    mod._free(ptr);
    return hash;
  };

  const idle = await screenAfter(false);
  const pressed = await screenAfter(true);
  assert.notEqual(pressed, idle, 'holding Start from the phone changed nothing on the Game Boy');
});

reporter.finish('network checks');
