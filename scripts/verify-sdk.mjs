/**
 * Asserts the SDK is genuinely separable from this application.
 *
 * The whole claim of M6 (D-020) is that a game can be made without this
 * repository. That claim is only worth anything if it is tested the hard way:
 * the package is copied somewhere else, the application source is made
 * unreachable, and it still has to compile and pack.
 *
 * A check that built the SDK in place would pass forever, including on the day
 * someone reintroduces an `@/` import — which is exactly the mistake this
 * exists to catch.
 *
 * Run with: npm run verify:sdk
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeReporter } from './test-build.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDK = path.join(REPO, 'packages/sdk');

const reporter = makeReporter();
const { check } = reporter;

console.log('\nThe SDK stands alone:');

await check('no source file reaches into the application', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.name.endsWith('.ts')) {
        const source = fs.readFileSync(full, 'utf8');
        // `@/` is the application's alias. A package carrying it would resolve
        // only inside this repository, which is the thing M6 removes.
        if (/from '@\//.test(source) || /require\('@\//.test(source)) {
          offenders.push(path.relative(SDK, full));
        }
      }
    }
  };
  walk(path.join(SDK, 'src'));
  assert.deepEqual(offenders, [], `these import the app: ${offenders.join(', ')}`);
});

await check('it compiles with the application source absent', () => {
  // Copied out and built in isolation. Building in place would still pass on
  // the day an app import sneaks back in.
  const away = fs.mkdtempSync(path.join(os.tmpdir(), 'gbs-sdk-alone-'));
  try {
    fs.cpSync(path.join(SDK, 'src'), path.join(away, 'src'), { recursive: true });
    fs.cpSync(path.join(SDK, 'tsconfig.json'), path.join(away, 'tsconfig.json'));
    fs.cpSync(path.join(SDK, 'package.json'), path.join(away, 'package.json'));
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(away, 'node_modules'), 'dir');

    execFileSync(path.join(REPO, 'node_modules/.bin/tsc'), ['-p', path.join(away, 'tsconfig.json')], {
      cwd: away,
      stdio: 'pipe',
    });
    assert.ok(fs.existsSync(path.join(away, 'dist/index.js')), 'no output produced');
    assert.ok(fs.existsSync(path.join(away, 'dist/index.d.ts')), 'no declarations produced');
  } finally {
    fs.rmSync(away, { recursive: true, force: true });
  }
});

await check('it packs everything a creator needs, and nothing else', () => {
  const listing = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: SDK,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const files = JSON.parse(listing)[0].files.map((file) => file.path);

  for (const needed of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/protocol.js',
    'bin/gbs.mjs',
    'template/game.ts',
    'template/gbs.game.json',
  ]) {
    assert.ok(files.includes(needed), `missing from the tarball: ${needed}`);
  }
  // A tarball that shipped the app's source would make the isolation a lie.
  assert.ok(
    !files.some((file) => file.startsWith('src/') && file.includes('emulation')),
    'application source is in the tarball',
  );
});

console.log('\nThe protocol is a contract:');

await check('the supported versions include the current one', async () => {
  const { FRAME_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } = await import(
    path.join(SDK, 'dist/protocol.js')
  );
  // D-021: the host talks to the current version and the previous supported
  // one. A current version missing from that list would refuse every game.
  assert.ok(
    SUPPORTED_PROTOCOL_VERSIONS.includes(FRAME_PROTOCOL_VERSION),
    `current version ${FRAME_PROTOCOL_VERSION} is not in ${JSON.stringify(SUPPORTED_PROTOCOL_VERSIONS)}`,
  );
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.length <= 2, 'more than two versions supported at once');
});

await check('the button vocabulary matches the application', async () => {
  const { GBS_BUTTONS } = await import(path.join(SDK, 'dist/protocol.js'));
  const appTypes = fs.readFileSync(path.join(REPO, 'src/emulation/core/types.ts'), 'utf8');
  for (const button of GBS_BUTTONS) {
    assert.ok(appTypes.includes(`'${button}'`), `the app has no button "${button}"`);
  }
  // The compile-time assertion in frameProtocol.ts is the real guard; this
  // catches the case where someone deletes it.
  const bridge = fs.readFileSync(path.join(REPO, 'src/hosted/frameProtocol.ts'), 'utf8');
  assert.match(bridge, /GbsButton/, 'the app no longer checks its buttons against the SDK');
});

console.log('\nA fresh clone can build:');

await check('the application build compiles the SDK first', () => {
  // The SDK's dist is build output and deliberately not committed. That makes
  // it absent in a fresh clone — which is what a deploy is — so the app's build
  // has to produce it. Without this, every Vercel build failed with "Can't
  // resolve @gameboystudio/sdk" while every local build passed, because dist
  // happened to be lying around from earlier work.
  const scripts = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts;
  assert.ok(scripts.prebuild, 'there is no prebuild step');
  assert.match(
    scripts.prebuild,
    /sdk:build|packages\/sdk/,
    `prebuild does not build the SDK: ${scripts.prebuild}`,
  );
  assert.match(scripts['sdk:build'] ?? '', /packages\/sdk/, 'sdk:build does not build the SDK');
});

await check('the SDK dist is not committed', () => {
  // If it ever is, the check above stops meaning anything: the build would
  // succeed on stale committed output and nobody would notice the break.
  const tracked = execFileSync('git', ['ls-files', 'packages/sdk/dist'], {
    cwd: REPO,
    encoding: 'utf8',
  }).trim();
  assert.equal(tracked, '', `dist is committed:\n${tracked}`);
});

reporter.finish('SDK checks');
