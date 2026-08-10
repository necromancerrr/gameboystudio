/**
 * Checks that a relay only lets the intended site open rooms.
 *
 * A room code is a capability and the relay is on the public internet, so the
 * origin allowlist is the one piece of D-017's security model that has to be
 * verified against the thing actually running rather than against the config
 * file. Point it at the deployed Worker after every deploy.
 *
 * The handshake is written over a raw socket because `fetch` refuses to send
 * `Upgrade`, `Connection` and `Origin` — they are forbidden header names — so a
 * fetch-based version of this check silently tests nothing.
 *
 * Usage:
 *   node scripts/verify-relay-origins.mjs                      # local, prod vars
 *   node scripts/verify-relay-origins.mjs https://rooms.example.workers.dev
 */
import net from 'node:net';
import tls from 'node:tls';

const TARGET = process.argv[2] ?? 'http://127.0.0.1:8787';
const ALLOWED = process.argv[3] ?? 'https://gameboy-jet.vercel.app';

const url = new URL(TARGET);
const secure = url.protocol === 'https:' || url.protocol === 'wss:';
const port = Number(url.port) || (secure ? 443 : 80);

function handshake(origin) {
  return new Promise((resolve) => {
    const options = { host: url.hostname, port, servername: url.hostname };
    const socket = secure ? tls.connect(options) : net.connect(options);
    let buffer = '';

    socket.on(secure ? 'secureConnect' : 'connect', () => {
      const lines = [
        'GET /host HTTP/1.1',
        `Host: ${url.hostname}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
      ];
      if (origin) lines.push(`Origin: ${origin}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (!buffer.includes('\r\n')) return;
      socket.destroy();
      resolve(Number(buffer.split('\r\n')[0].split(' ')[1]));
    });
    socket.on('error', (error) => resolve(`error: ${error.message}`));
    setTimeout(() => {
      socket.destroy();
      resolve('timed out');
    }, 8000);
  });
}

const cases = [
  [ALLOWED, 'the production site', 101],
  ['https://gameboy-abc123-preview.vercel.app', 'a Vercel preview deployment', 403],
  ['https://evil.example.com', 'someone else entirely', 403],
  [null, 'no Origin header (a non-browser client)', 403],
];

console.log(`\nOrigin gate on ${TARGET}:`);
let failures = 0;
for (const [origin, label, expected] of cases) {
  const status = await handshake(origin);
  const ok = status === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(42)} ${status} (wanted ${expected})`);
}

if (failures) {
  console.log(
    '\nAn open relay is one any page on the internet can point at. If this is a' +
      '\nlocal `npm run relay:dev`, the allowlist is deliberately empty there —' +
      '\nrun this against the deployed Worker instead.',
  );
  process.exit(1);
}
console.log('\nOnly the intended site can open a room.');
