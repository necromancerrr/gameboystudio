/**
 * Compiles the input and networking layers to CommonJS and hands back a
 * `require` that understands the project's `@/…` aliases.
 *
 * Shared by verify-input and verify-net so the two cannot drift onto different
 * builds of the same code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = `${REPO}/.test-build`;

let built = false;

export function loadTestBuild() {
  if (!built) {
    fs.rmSync(OUT, { recursive: true, force: true });
    execFileSync(`${REPO}/node_modules/.bin/tsc`, ['-p', `${REPO}/scripts/tsconfig.tests.json`], {
      cwd: REPO,
      stdio: 'inherit',
    });
    built = true;
  }

  const require = createRequire(import.meta.url);

  // tsc emits `@/…` specifiers verbatim, and these modules import values — not
  // only types — across that alias, so it has to resolve at runtime.
  const Module = require('node:module');
  if (!Module.__gbsAliasPatched) {
    const resolveFilename = Module._resolveFilename;
    Module._resolveFilename = function patched(request, ...rest) {
      const mapped = request.startsWith('@/') ? `${OUT}/${request.slice(2)}` : request;
      return resolveFilename.call(this, mapped, ...rest);
    };
    Module.__gbsAliasPatched = true;
  }

  return (relative) => require(`${OUT}/${relative}`);
}

/** Tiny shared reporter, so both scripts print the same shape. */
export function makeReporter() {
  const state = { passed: 0, failures: [] };
  return {
    state,
    async check(name, body) {
      try {
        await body();
        console.log(`  ok   ${name}`);
        state.passed += 1;
      } catch (error) {
        console.log(`  FAIL ${name}\n       ${String(error.message).split('\n')[0]}`);
        state.failures.push(name);
      }
    },
    finish(label) {
      console.log(`\n${state.passed} ${label} pass`);
      if (state.failures.length) {
        console.log('failed:', state.failures.join(', '));
        process.exit(1);
      }
    },
  };
}
