/** Deterministic, library-only matching. Run: node scripts/verify-request-search.mjs */
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { makeReporter } from './test-build.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = buildSync({
  stdin: {
    contents: "export { matchRequest } from './src/catalog/matchRequest'; export { GAMES } from './src/catalog/games';",
    resolveDir: REPO,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  metafile: true,
});

// Running in isolation catches a future accidental network, storage, timer,
// or generation dependency rather than merely asserting today's return value.
const forbidden = (name) => () => { throw new Error(`Search attempted ${name}`); };
const sandbox = {
  module: { exports: {} },
  fetch: forbidden('network access'),
  require: forbidden('a runtime dependency'),
  setTimeout: forbidden('a timer'),
  setInterval: forbidden('a timer'),
};
for (const name of ['localStorage', 'sessionStorage', 'window', 'document']) {
  Object.defineProperty(sandbox, name, { get: forbidden(name) });
}
vm.runInNewContext(build.outputFiles[0].text, sandbox);
const { matchRequest, GAMES } = sandbox.module.exports;
const reporter = makeReporter();
const { check } = reporter;
const slugs = (games) => Array.from(games, (game) => game.slug);
const match = (request) => slugs(matchRequest(GAMES, request));

function fixture(slug, overrides = {}) {
  return {
    slug, title: slug, developer: 'Example Studio', description: '', year: 2026,
    runtime: 'native', entry: slug, players: { min: 1, max: 1 },
    inputs: { required: [], supported: ['keyboard'] }, saves: false,
    console: null, genre: [], screenshots: [], license: 'MIT', attribution: '',
    sourceUrl: '', homepageUrl: '', rank: 0, series: null, ...overrides,
  };
}

console.log('\nLibrary request matching:');

await check('empty and generic-only requests do not manufacture matches', () => {
  for (const request of ['', '  ', '!!!', 'a game', 'please make me a really fun new game', 'I want something to play']) {
    assert.deepEqual(match(request), [], request);
  }
});

await check('an unsupported request stays an honest no-match', () => {
  assert.deepEqual(match('a quantum dragon restaurant simulator'), []);
  assert.deepEqual(match('a puzzle about quantum dragons'), []);
  assert.deepEqual(match('a multiplayer farming game'), []);
  assert.deepEqual(slugs(matchRequest([], 'Drift')), []);
});

await check('natural descriptions search gameplay, not just titles', () => {
  assert.equal(match('a game with a spaceship and gravity')[0], 'drift');
  assert.equal(match('I want to bounce off enemies and rescue a cat in the sky')[0], 'tobutobugirldeluxe');
  assert.equal(match('a puzzle where I connect matching nodes')[0], 'crossconnect');
  assert.equal(match('program a delivery robot')[0], 'postbot');
});

await check('title, punctuation, case, genre, and series are searchable', () => {
  assert.equal(match('  RING-OUT!! ')[0], 'ring-out');
  assert.equal(match('I want to play Shock Lobster')[0], 'shock-lobster');
  assert.equal(match('JP')[0], 'jp');
  assert.ok(match('platformer').includes('the-purple-night'));
  assert.ok(match('a role-playing game').includes('aevilia'));
  const games = [fixture('sequel', { title: 'Second Chapter', series: 'Moon Quest' })];
  assert.deepEqual(slugs(matchRequest(games, 'Moon Quest')), ['sequel']);
});

await check('diacritics normalize in requests and metadata', () => {
  assert.ok(match('Gniazdo Swiatow').includes('europa-rescue'));
  const games = [fixture('cafe', { title: 'Café Łódź', description: 'Répare une fusée' })];
  assert.deepEqual(slugs(matchRequest(games, 'cafe lodz')), ['cafe']);
  assert.deepEqual(slugs(matchRequest(games, 'repare fusee')), ['cafe']);
});

await check('multiplayer wording uses actual player metadata', () => {
  for (const request of ['multiplayer', 'a two-player game', 'for 2 people', 'something for two of us', 'play with my friend', 'play together']) {
    assert.deepEqual(match(request), ['ring-out'], request);
  }
  assert.deepEqual(match('two players push each other off a platform'), ['ring-out']);
  assert.deepEqual(match('a four-player game'), []);
  assert.ok(!match('a single player game').includes('ring-out'));
  assert.ok(!match('no multiplayer').includes('ring-out'));
  // Multiplayer is not evidence of co-op, an online mode, or any other feature.
  assert.deepEqual(match('online multiplayer'), []);
  assert.deepEqual(match('co-op multiplayer'), []);
});

await check('player counts respect both minimum and maximum', () => {
  const games = [
    fixture('solo'),
    fixture('flexible', { players: { min: 1, max: 4 } }),
    fixture('group', { players: { min: 3, max: 8 } }),
  ];
  assert.deepEqual(slugs(matchRequest(games, 'two players')), ['flexible']);
  assert.deepEqual(slugs(matchRequest(games, 'three players')), ['flexible', 'group']);
  assert.deepEqual(slugs(matchRequest(games, 'solo')), ['solo', 'flexible']);
  assert.deepEqual(slugs(matchRequest(games, 'two player solo')), ['flexible']);
});

await check('exact title outranks descriptions and longer titles', () => {
  const games = [
    fixture('mentioned', { description: 'Drift through a field of stars.', rank: 0 }),
    fixture('sequel', { title: 'Drift Again', rank: 1 }),
    fixture('drift', { title: 'Drift', rank: 20 }),
  ];
  assert.equal(slugs(matchRequest(games, 'Drift'))[0], 'drift');
  assert.equal(slugs(matchRequest(games, 'please play Drift'))[0], 'drift');
});

await check('matching uses complete words rather than accidental substrings', () => {
  const games = [fixture('cat', { description: 'A cat climbs a tower.' })];
  assert.deepEqual(slugs(matchRequest(games, 'at')), []);
  assert.deepEqual(slugs(matchRequest(games, 'cat')), ['cat']);
  assert.deepEqual(slugs(matchRequest(games, 'catalogue')), []);
});

await check('results are deterministic, preserve objects, and never mutate the catalog', () => {
  const games = Object.freeze([
    Object.freeze(fixture('later', { genre: Object.freeze(['Puzzle']), rank: 4 })),
    Object.freeze(fixture('earlier', { genre: Object.freeze(['Puzzle']), rank: 2 })),
  ]);
  const before = JSON.stringify(games);
  const result = matchRequest(games, 'puzzle');
  assert.deepEqual(slugs(result), ['earlier', 'later']);
  assert.deepEqual(slugs(matchRequest(games, 'puzzle')), slugs(result));
  assert.equal(result[0], games[1]);
  assert.equal(JSON.stringify(games), before);
  assert.notEqual(result, games);
});

await check('search has no generation imports or external side effects', () => {
  const sourceInputs = Object.keys(build.metafile.inputs).filter((input) => input !== '<stdin>');
  assert.deepEqual(sourceInputs.sort(), ['src/catalog/games.ts', 'src/catalog/matchRequest.ts']);
  for (const request of ['Drift', 'make a new dragon game', 'two players', '']) match(request);
});

reporter.finish('request-search checks');
