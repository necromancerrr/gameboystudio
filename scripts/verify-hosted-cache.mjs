/**
 * Checks the cache policy of a running hosted origin.
 *
 * This is the part of D-019 that makes M5's proof unambiguous. If the manifest
 * were cached, an update would become visible "eventually" and the milestone's
 * central claim — change the game, reload, see it, without rebuilding the app —
 * would depend on browser timing rather than on the boundary working.
 *
 * It has to run against a served response rather than the config file, because
 * the failure mode is real and was hit while building this: Cloudflare's asset
 * server answers before the Worker unless told otherwise, so the headers were
 * its defaults and not ours.
 *
 * Usage:
 *   npm run hosted:dev                       # in another terminal
 *   node scripts/verify-hosted-cache.mjs
 *   node scripts/verify-hosted-cache.mjs https://hosted.example
 */
import { makeReporter } from './test-build.mjs';

const TARGET = (process.argv[2] ?? 'http://127.0.0.1:8788').replace(/\/$/, '');

const reachable = await fetch(`${TARGET}/manifest.json`, { method: 'HEAD' })
  .then((response) => response.ok)
  .catch(() => false);

if (!reachable) {
  console.log(`\nNo hosted origin answering on ${TARGET} — SKIPPED, which is not a pass.`);
  console.log('Start one with: npm run hosted:dev');
  process.exit(0);
}

const reporter = makeReporter();
const { check } = reporter;

console.log(`\nCache policy on ${TARGET}:`);

await check('the manifest is always revalidated', async () => {
  const response = await fetch(`${TARGET}/manifest.json`);
  const cache = response.headers.get('cache-control') ?? '';
  // `no-cache` means revalidate, not "do not store"; `max-age=0, must-revalidate`
  // is the same instruction spelled differently and is equally acceptable.
  const revalidates = /no-cache/.test(cache) || /max-age=0/.test(cache);
  if (!revalidates) throw new Error(`manifest cache-control was "${cache}"`);
  if (/immutable/.test(cache)) throw new Error('the manifest must never be immutable');
});

await check('the manifest is JSON and readable cross-origin', async () => {
  const response = await fetch(`${TARGET}/manifest.json`);
  const type = response.headers.get('content-type') ?? '';
  if (!/application\/json/.test(type)) throw new Error(`content-type was "${type}"`);
  // The application fetches this from a different origin.
  if (!response.headers.get('access-control-allow-origin')) {
    throw new Error('no access-control-allow-origin, so the app cannot read it');
  }
  const body = await response.json();
  if (body.version !== 1 || !Array.isArray(body.games)) {
    throw new Error(`manifest shape was ${JSON.stringify(body).slice(0, 80)}`);
  }
});

await check('a versioned artifact is immutable', async () => {
  const response = await fetch(`${TARGET}/games/demo/1.0.0/frame.html`);
  if (!response.ok) throw new Error(`artifact returned ${response.status}`);
  const cache = response.headers.get('cache-control') ?? '';
  if (!/immutable/.test(cache)) throw new Error(`artifact cache-control was "${cache}"`);
  if (!/max-age=\d{6,}/.test(cache)) throw new Error(`artifact max-age too short: "${cache}"`);
});

await check('an exact path is served, not redirected', async () => {
  // The default asset behaviour rewrites `/x/frame.html` to `/x/frame` with a
  // 307. The manifest points at exact versioned URLs, so that would break them.
  const response = await fetch(`${TARGET}/games/demo/1.0.0/frame.html`, { redirect: 'manual' });
  if (response.status !== 200) {
    throw new Error(`expected 200, got ${response.status}`);
  }
});

await check('the origin is read only', async () => {
  const response = await fetch(`${TARGET}/manifest.json`, { method: 'POST' });
  if (response.status !== 405) throw new Error(`POST returned ${response.status}`);
});

await check('a missing file is a 404, not a surprise', async () => {
  const response = await fetch(`${TARGET}/games/nothing-here/1.0.0/frame.html`);
  if (response.status !== 404) throw new Error(`missing file returned ${response.status}`);
});

reporter.finish('hosted origin checks');
