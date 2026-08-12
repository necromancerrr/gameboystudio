#!/usr/bin/env node
/**
 * forge — ask for a game, play it, ask again.
 *
 *   forge new "<a game request>"        make one
 *   forge revise <id> "<a change>"      change it
 *   forge play <id>                     open the current version
 *   forge list                          what exists
 *   forge show <id>                     its history
 *
 * Internal (D-025): generation is not a creator feature yet.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { forgeNew, forgeRevise } from '../dist/loop.js';
import { Project } from '../dist/project.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOT = process.env.GBS_FORGE_ROOT ?? path.join(REPO, '.forge');
const SDK = process.env.GBS_SDK_PATH ?? path.join(REPO, 'packages/sdk');

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const value = (name) => {
  const at = rest.indexOf(`--${name}`);
  return at >= 0 ? rest[at + 1] : undefined;
};
// Only these take a value. Treating every flag as taking one would let
// `--quick "a memory game"` swallow the request.
const TAKES_VALUE = new Set(['--id']);
const consumed = new Set();
rest.forEach((item, index) => {
  if (TAKES_VALUE.has(item)) consumed.add(index + 1);
});
const words = rest.filter((item, index) => !item.startsWith('--') && !consumed.has(index));

const report = (result) => {
  const t = result.timings;
  console.log(`\n  ${result.ok ? 'ready' : 'FAILED'}  ${result.projectId}  revision ${result.revision}`);
  if (result.applied.length) console.log(`  understood: ${result.applied.join('; ')}`);
  if (result.ignored.length) console.log(`  not understood: ${result.ignored.join('; ')}`);
  console.log(
    `  generate ${t.generate ?? 0}ms · scaffold ${t.scaffold ?? 0}ms · check ${t.check ?? 0}ms` +
      (t.recheck ? ` · recheck ${t.recheck}ms` : '') +
      `  =  ${((t.total ?? 0) / 1000).toFixed(1)}s`,
  );
  if (!result.ok) {
    for (const failure of result.conformance?.failed ?? []) console.log(`  · ${failure}`);
    console.log('  The previous version is untouched and still playable.');
  } else {
    console.log(`\n  play it:  npx forge play ${result.projectId}\n`);
  }
};

const play = (id) => {
  const project = Project.open(ROOT, id);
  if (!project.current) throw new Error(`${id} has no playable revision yet.`);
  console.log(`\n  ${project.slug} — revision ${project.current.n}\n`);
  spawn(path.join(project.dir, 'node_modules/.bin/gbs'), ['dev', '.'], {
    cwd: project.dir,
    stdio: 'inherit',
  });
};

try {
  switch (command) {
    case 'new':
      if (!words[0]) throw new Error('What kind of game?  forge new "a memory game"');
      report(
        await forgeNew(words.join(' '), {
          root: ROOT,
          sdkPath: SDK,
          quick: flag('quick'),
          id: value('id'),
        }),
      );
      break;
    case 'revise':
      if (words.length < 2) throw new Error('forge revise <id> "make it faster"');
      report(
        await forgeRevise(words[0], words.slice(1).join(' '), {
          root: ROOT,
          sdkPath: SDK,
          quick: flag('quick'),
        }),
      );
      break;
    case 'play':
      play(words[0]);
      break;
    case 'list':
      for (const id of Project.list(ROOT)) {
        const project = Project.open(ROOT, id);
        console.log(`  ${id.padEnd(28)} r${project.current?.n ?? '-'} of ${project.revisions.length}`);
      }
      break;
    case 'show': {
      const project = Project.open(ROOT, words[0]);
      console.log(`\n  ${project.id}  (current: revision ${project.current?.n ?? 'none'})\n`);
      for (const revision of project.revisions) {
        const mark = revision.n === project.current?.n ? '*' : ' ';
        console.log(`  ${mark} r${revision.n} ${revision.status.padEnd(10)} ${revision.artifactVersion.padEnd(8)} ${revision.request}`);
        if (revision.notes) console.log(`      ${revision.notes}`);
      }
      console.log();
      break;
    }
    default:
      console.log('\n  forge new "<request>" | revise <id> "<change>" | play <id> | list | show <id>\n');
      process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
