/**
 * Asserts that Originals stay out of Game Boy pages.
 *
 * "It is a dynamic import" is a claim about source code, not about what a
 * browser downloads. This checks the built output instead: it takes the
 * chunks a prerendered retro page actually references and looks for strings
 * that only exist in native code.
 *
 * Markers are user-visible strings rather than identifiers, because a minifier
 * renames identifiers and would quietly make this pass forever.
 *
 * Run after `npm run build`, with: npm run verify:bundles
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHUNK_DIR = `${REPO}/.next/static/chunks`;
const APP_DIR = `${REPO}/.next/server/app`;

const MARKERS = {
  drift: 'LOST IN SPACE',
  'ring-out': 'PRESS A TO REMATCH',
  runtime: 'This browser could not open a 2D canvas.',
  'native player': 'cannot hold two people at once',
};

/** A retro page and a native page, to compare what each one pulls in. */
const RETRO_PAGE = 'games/tobutobugirl.html';
const NATIVE_PAGE = 'games/drift.html';

if (!fs.existsSync(CHUNK_DIR)) {
  console.log('No build found. Run `npm run build` first.');
  process.exit(1);
}

function walk(dir) {
  const files = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) files.push(...walk(`${dir}/${item.name}`));
    else if (item.name.endsWith('.js')) files.push(`${dir}/${item.name}`);
  }
  return files;
}

const chunks = new Map(walk(CHUNK_DIR).map((file) => [file, fs.readFileSync(file, 'utf8')]));

const failures = [];
let passed = 0;

function check(name, body) {
  try {
    body();
    console.log(`  ok   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}\n       ${error.message}`);
    failures.push(name);
  }
}

/** Chunk files containing a marker. */
function chunksWith(marker) {
  const found = [];
  for (const [file, source] of chunks) {
    if (source.includes(marker)) found.push(path.basename(file));
  }
  return found;
}

function referencedChunks(page) {
  const html = fs.readFileSync(`${APP_DIR}/${page}`, 'utf8');
  const matches = html.matchAll(/\/_next\/static\/chunks\/([^"']+?\.js)/g);
  return [...new Set([...matches].map((match) => match[1]))];
}

const located = {};

console.log('Native code is in the build at all:');
for (const [name, marker] of Object.entries(MARKERS)) {
  check(`${name} shipped`, () => {
    located[name] = chunksWith(marker);
    if (located[name].length === 0) {
      throw new Error(`marker "${marker}" is in no chunk — did the string change?`);
    }
  });
}

console.log('\nAnd it is split apart:');

check('each Original is its own chunk', () => {
  const drift = new Set(located.drift ?? []);
  const ring = new Set(located['ring-out'] ?? []);
  const shared = [...drift].filter((file) => ring.has(file));
  if (shared.length > 0) {
    throw new Error(`Drift and Ring Out share ${shared.join(', ')}`);
  }
});

check('a Game Boy page loads none of it', () => {
  const loaded = new Set(referencedChunks(RETRO_PAGE));
  const offenders = [];
  for (const [name, files] of Object.entries(located)) {
    for (const file of files) {
      if (loaded.has(file)) offenders.push(`${name} (${file})`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(`retro page pulls in ${offenders.join(', ')}`);
  }
});

check('the check would notice if a retro page did load something', () => {
  // Guard against the assertion above passing because the HTML was unreadable
  // or the chunk names never line up.
  const loaded = referencedChunks(RETRO_PAGE);
  if (loaded.length < 3) throw new Error(`only ${loaded.length} chunks parsed from the page`);
  const known = new Set(chunks.keys());
  const resolvable = loaded.filter((file) => known.has(`${CHUNK_DIR}/${file}`));
  if (resolvable.length === 0) throw new Error('no referenced chunk matched a built file');
});

check('an Original page loads the same shared chunks, not a separate app', () => {
  const retro = new Set(referencedChunks(RETRO_PAGE));
  const native = referencedChunks(NATIVE_PAGE);
  const shared = native.filter((file) => retro.has(file));
  if (shared.length === 0) {
    throw new Error('the two pages have no chunks in common, which cannot be right');
  }
});

console.log(`\n${passed} bundle checks pass`);
if (failures.length) {
  console.log('failed:', failures.join(', '));
  process.exit(1);
}
