/**
 * Measures what a room actually costs a button press.
 *
 * M4_PLAN puts this before any UI is built on the relay, because the decision it
 * informs — whether WebSockets are good enough or WebRTC is needed — should be
 * made on numbers rather than on the assumption that peer-to-peer must be
 * better. D-017 defers WebRTC on exactly this basis.
 *
 * What it reports is the round trip guest -> relay -> host -> relay -> guest.
 * A real press only travels half of that, so the one-way figure is the honest
 * one to compare against a local pad (roughly 8-16ms, one poll frame).
 *
 * Against a local `wrangler dev` this measures the protocol and the runtime, not
 * the internet. Point it at a deployed Worker for a number that means something
 * about a living room.
 *
 * Usage: node scripts/measure-room-latency.mjs [ws://127.0.0.1:8787]
 */
import { loadTestBuild } from './test-build.mjs';

const { PROTOCOL_VERSION } = loadTestBuild()('net/protocol.js');

const BASE = process.argv[2] ?? 'ws://127.0.0.1:8787';
const SAMPLES = 200;

const open = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)));
  });

const next = (socket, predicate) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), 10_000);
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      resolve(message);
    };
    socket.addEventListener('message', onMessage);
  });

const host = await open(`${BASE}/host`);
host.send(JSON.stringify({ t: 'host', v: PROTOCOL_VERSION }));
const room = await next(host, (message) => message.t === 'room');
console.log(`room ${room.code}`);

const guest = await open(`${BASE}/join?code=${room.code}`);
// Both waits are armed before the join is sent. Awaiting them in sequence
// drops whichever message arrives first, which is how this script spent its
// first run blaming the relay for a race of its own.
const seated = Promise.all([
  next(guest, (message) => message.t === 'welcome'),
  next(host, (message) => message.t === 'peer'),
]);
guest.send(JSON.stringify({ t: 'join', v: PROTOCOL_VERSION, code: room.code }));
await seated;
console.log('guest seated\n');

// The host answers every input with a control message, so the guest can time a
// full round trip without the two clocks having to agree on anything.
host.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.t === 'msg' && message.ch === 'input') {
    host.send(
      JSON.stringify({ t: 'msg', ch: 'control', to: message.from, d: { c: 'full' } }),
    );
  }
});

const samples = [];
for (let i = 0; i < SAMPLES; i += 1) {
  const started = performance.now();
  guest.send(JSON.stringify({ t: 'msg', ch: 'input', d: { b: 'a', p: i % 2 === 0 } }));
  await next(guest, (message) => message.t === 'msg' && message.ch === 'control');
  samples.push(performance.now() - started);
  // Below the relay's rate limit, and roughly a fast player's button rate.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

samples.sort((a, b) => a - b);
const at = (q) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;

console.log(`${samples.length} round trips through ${BASE}`);
console.log(`  round trip   mean ${mean.toFixed(1)}ms   p50 ${at(0.5).toFixed(1)}ms   p95 ${at(0.95).toFixed(1)}ms   max ${samples[samples.length - 1].toFixed(1)}ms`);
console.log(`  one way      mean ${(mean / 2).toFixed(1)}ms   p50 ${(at(0.5) / 2).toFixed(1)}ms   p95 ${(at(0.95) / 2).toFixed(1)}ms`);
console.log('\nA local pad costs roughly 8-16ms (one poll frame) for comparison.');

guest.close();
host.close();
