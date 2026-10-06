/** Production HTTP checks. No signups are transmitted or games generated. */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.GBS_HTTP_TEST_PORT ?? '3291';
const origin = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [
  'node_modules/next/dist/bin/next', 'start', '--port', PORT, '--hostname', '127.0.0.1',
], {
  cwd: REPO,
  env: { ...process.env, GBS_GENERATOR: 'synthesizer', GBS_WAITLIST_ENDPOINT: '', GBS_WAITLIST_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) { ready = true; break; }
    } catch { /* Wait for the local production server. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, output);

  for (const route of ['/', '/early-access', '/library', '/games/drift', '/games/tobutobugirldeluxe', '/join']) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert(html.includes('GameDex'), route);
    assert(/<title>[^<]*GameDex/.test(html), 'every public route retains the brand in its title');
    assert(!html.includes('/boot/checkpoint.webm'), route);
    assert(!html.includes('>GameBoyStudio<'), route);
    if (route === '/' || route === '/early-access') {
      assert(html.includes('data-testid="beta-landing"'), 'root and early access must share the beta landing');
      assert(html.includes('data-testid="signup-unavailable"'), 'unconfigured signup must be explicit');
      assert(!html.includes('id="waitlist-email"'), 'do not offer a form that cannot save');
      assert(html.includes('href="/library"'), 'landing must lead to the playable beta');
      assert(!html.includes('data-testid="ask-input"'), 'landing must not expose broken creation');
    }
    if (route === '/library') {
      assert(html.includes('data-testid="library-search"'), 'library search remains available');
      assert(!html.includes('data-testid="ask-input"'), 'public beta must not promote broken generation');
      assert(html.includes('href="/games/drift"'), 'existing games remain directly accessible');
    }
    if (route.startsWith('/games/')) assert(html.includes('href="/library"'), 'game back links must reach the library');
    console.log('PASS brand and route', route);
  }

  for (const [body, status] of [[{ email: 'bad' }, 400], [{ email: 'test@example.com' }, 503], [null, 400]]) {
    const response = await fetch(`${origin}/api/waitlist`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, status);
    const result = await response.json();
    assert(!result.message.includes('REGISTERED'));
    console.log('PASS waitlist', status);
  }

  const invalid = await fetch(`${origin}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(invalid.status, 400);
  console.log('PASS invalid creation rejected, no model call');
  console.log('PASS HTTP smoke tests');
} finally {
  server.kill('SIGTERM');
}
