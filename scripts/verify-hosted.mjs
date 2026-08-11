/**
 * Asserts what the hosted manifest validator refuses.
 *
 * This is the layer everything else trusts. The manifest arrives over the
 * network at runtime (D-018), so nothing about it is guaranteed by the type
 * system at the point it is read, and a validator that quietly accepted a bad
 * field would hand a hostile document straight to an iframe.
 *
 * Per D-012 every check is written so that removing the rule it covers makes it
 * fail. The ones that matter most are the origin checks: `frameUrl` is the field
 * that ends in code execution.
 *
 * Run with: npm run verify:hosted
 */
import assert from 'node:assert/strict';
import { loadTestBuild, makeReporter } from './test-build.mjs';

const load = loadTestBuild();
const { validateManifest, MANIFEST_VERSION } = load('hosted/manifest.js');
const { resolveHostedConfig } = load('hosted/hostedConfig.js');

const reporter = makeReporter();
const { check } = reporter;

const ORIGIN = 'https://hosted.example';
const OPTIONS = {
  allowedOrigins: [ORIGIN],
  takenSlugs: new Set(['drift', 'ring-out', 'tobutobugirl']),
};

/** A minimal entry that must always pass, so every other case differs by one field. */
const good = (overrides = {}) => ({
  slug: 'test-game',
  title: 'Test Game',
  developer: 'GameBoyStudio',
  description: 'A game used by the checks.',
  year: 2026,
  players: { min: 1, max: 2 },
  inputs: { required: [], supported: ['gamepad', 'keyboard'] },
  saves: true,
  genre: ['Action'],
  screenshots: [`${ORIGIN}/games/test-game/1.0.0/shot.png`],
  license: 'MIT',
  attribution: 'GameBoyStudio',
  sourceUrl: 'https://example.com/source',
  frameUrl: `${ORIGIN}/games/test-game/1.0.0/frame.html`,
  ...overrides,
});

const doc = (games) => ({ version: MANIFEST_VERSION, games });
const accepted = (entry) => validateManifest(doc([entry]), OPTIONS).games;
const refused = (entry) => {
  const result = validateManifest(doc([entry]), OPTIONS);
  assert.equal(result.games.length, 0, 'entry was accepted when it should not have been');
  return result.rejected[0]?.reason ?? '';
};

console.log('\nA usable entry:');

await check('a well-formed entry is accepted whole', () => {
  const [game] = accepted(good());
  assert.equal(game.slug, 'test-game');
  assert.equal(game.runtime, 'hosted');
  assert.equal(game.console, null);
  assert.equal(game.frameUrl, `${ORIGIN}/games/test-game/1.0.0/frame.html`);
  assert.deepEqual(game.players, { min: 1, max: 2 });
  assert.equal(game.saves, true);
});

await check('optional fields may be absent', () => {
  const entry = good();
  delete entry.description;
  delete entry.genre;
  delete entry.screenshots;
  delete entry.attribution;
  delete entry.sourceUrl;
  delete entry.year;
  const [game] = accepted(entry);
  assert.equal(game.description, '');
  assert.deepEqual(game.genre, []);
  assert.equal(game.year, null);
});

console.log('\nThe origin rules, which are the ones that matter:');

await check('a frame on another origin is refused', () => {
  // The single most dangerous field: this is what gets loaded and executed.
  assert.match(refused(good({ frameUrl: 'https://evil.example/frame.html' })), /off-origin/);
});

await check('a frame on no origin at all is refused', () => {
  assert.match(refused(good({ frameUrl: 'frame.html' })), /off-origin/);
  assert.match(refused(good({ frameUrl: 'javascript:alert(1)' })), /off-origin/);
  assert.match(refused(good({ frameUrl: 'data:text/html,<script>' })), /off-origin/);
});

await check('a screenshot on another origin is refused', () => {
  assert.match(
    refused(good({ screenshots: ['https://evil.example/x.png'] })),
    /screenshot is off-origin/,
  );
});

await check('an empty allowlist accepts nothing', () => {
  const result = validateManifest(doc([good()]), {
    allowedOrigins: [],
    takenSlugs: new Set(),
  });
  assert.equal(result.games.length, 0);
});

await check('a javascript: link is refused', () => {
  // React renders hrefs as given; a javascript: URL there executes on click.
  assert.match(refused(good({ sourceUrl: 'javascript:alert(1)' })), /bad source url/);
});

console.log('\nCollisions and duplicates:');

await check('a hosted game cannot shadow a compiled one', () => {
  // Otherwise a hosted entry could quietly replace a curated, licence-verified
  // game with something else entirely.
  assert.match(refused(good({ slug: 'ring-out' })), /already in the catalog/);
});

await check('a duplicate slug inside the manifest is dropped', () => {
  const result = validateManifest(doc([good(), good()]), OPTIONS);
  assert.equal(result.games.length, 1);
  assert.match(result.rejected[0].reason, /duplicate/);
});

console.log('\nShape:');

await check('a bad slug is refused', () => {
  for (const slug of ['', 'Has Capitals', 'has spaces', '-leading', 'trailing-', 'a'.repeat(70)]) {
    assert.equal(validateManifest(doc([good({ slug })]), OPTIONS).games.length, 0, slug);
  }
});

await check('missing required fields are refused', () => {
  for (const field of ['title', 'developer', 'license', 'players', 'inputs', 'saves']) {
    const entry = good();
    delete entry[field];
    assert.equal(validateManifest(doc([entry]), OPTIONS).games.length, 0, field);
  }
});

await check('a nonsense player count is refused', () => {
  assert.match(refused(good({ players: { min: 0, max: 2 } })), /player count/);
  assert.match(refused(good({ players: { min: 3, max: 2 } })), /player count/);
  assert.match(refused(good({ players: { min: 1, max: 99 } })), /player count/);
  assert.match(refused(good({ players: { min: 1.5, max: 2 } })), /player count/);
});

await check('an unknown input profile is refused', () => {
  assert.match(refused(good({ inputs: { required: [], supported: ['telepathy'] } })), /input/);
});

await check('requiring an input the game does not support is refused', () => {
  // Discovery reads both fields as if they agree, so an incoherent pair would
  // make "what can I play with this controller" answer wrongly.
  assert.match(
    refused(good({ inputs: { required: ['gamepad'], supported: ['keyboard'] } })),
    /required input is not supported/,
  );
});

await check('oversized strings and lists are refused', () => {
  assert.equal(validateManifest(doc([good({ title: 'x'.repeat(500) })]), OPTIONS).games.length, 0);
  assert.equal(
    validateManifest(doc([good({ genre: Array(50).fill('Action') })]), OPTIONS).games.length,
    0,
  );
});

console.log('\nThe document itself:');

await check('a document of the wrong version yields nothing', () => {
  const result = validateManifest({ version: 99, games: [good()] }, OPTIONS);
  assert.equal(result.games.length, 0);
  assert.match(result.rejected[0].reason, /version/);
});

await check('rubbish yields nothing rather than throwing', () => {
  for (const value of [null, undefined, 42, 'hello', [], { version: 1 }, { version: 1, games: {} }]) {
    const result = validateManifest(value, OPTIONS);
    assert.equal(result.games.length, 0);
  }
});

await check('one bad entry does not poison the rest', () => {
  // A curated catalog should not vanish because a single row was mistyped.
  const result = validateManifest(
    doc([good({ slug: 'first' }), good({ slug: 'bad', frameUrl: 'https://evil.example/f.html' }), good({ slug: 'third' })]),
    OPTIONS,
  );
  assert.deepEqual(
    result.games.map((game) => game.slug),
    ['first', 'third'],
  );
  assert.equal(result.rejected.length, 1);
});

await check('an absurd number of games is refused outright', () => {
  const result = validateManifest(doc(Array(500).fill(good())), OPTIONS);
  assert.equal(result.games.length, 0);
  assert.match(result.rejected[0].reason, /too many/);
});

console.log('\nConfiguration:');

await check('unset means off, silently and on purpose', () => {
  const config = resolveHostedConfig('', '');
  assert.equal(config.enabled, false);
  // Not a problem: a build with no hosted origin behind it should say nothing.
  assert.equal(config.problem, null);
});

await check('a manifest URL with no allowlist is off, and says why', () => {
  // The dangerous quiet: hosted games appearing to work while nothing about
  // them could be trusted.
  const config = resolveHostedConfig('https://hosted.example/manifest.json', '');
  assert.equal(config.enabled, false);
  assert.match(config.problem, /ORIGINS is empty/);
});

await check('a manifest served from an unlisted origin cannot introduce itself', () => {
  const config = resolveHostedConfig(
    'https://elsewhere.example/manifest.json',
    'https://hosted.example',
  );
  assert.equal(config.enabled, false);
  assert.match(config.problem, /not in the allowlist/);
});

await check('a non-http manifest URL is refused', () => {
  for (const url of ['javascript:alert(1)', 'data:application/json,{}', 'not a url']) {
    const config = resolveHostedConfig(url, 'https://hosted.example');
    assert.equal(config.enabled, false, url);
    assert.ok(config.problem, url);
  }
});

await check('a well-formed configuration is enabled', () => {
  const config = resolveHostedConfig(
    'https://hosted.example/manifest.json',
    'https://hosted.example, https://other.example',
  );
  assert.equal(config.enabled, true);
  assert.equal(config.problem, null);
  assert.deepEqual(config.origins, ['https://hosted.example', 'https://other.example']);
});

reporter.finish('hosted manifest checks');
