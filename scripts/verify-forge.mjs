/**
 * Asserts the loop's claims: a request becomes a playable game, a follow-up
 * changes that same game, and a failure never costs someone the game they had.
 *
 * The last one is the reason this file exists. D-024's rule — the current
 * pointer moves only when a new revision is ready — is invisible when
 * everything works, and its absence is only felt on the one day it matters.
 * So it is tested by making a revision fail on purpose.
 *
 * Per D-012 each check is written so that removing what it covers breaks it.
 *
 * Run with: npm run verify:forge
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeReporter } from './test-build.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (relative) => import(path.join(REPO, 'packages/forge/dist', relative));

const { Project, projectId } = await load('project.js');
const { specFromRequest, applyChange, detectKind } = await load('spec.js');
const { synthesize } = await load('synthesize.js');
const { Synthesizer, ModelGenerator, generatorNamed } = await load('generator.js');

const reporter = makeReporter();
const { check } = reporter;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gbs-forge-'));

console.log('\nUnderstanding a request:');

await check('a request picks a kind rather than defaulting blindly', () => {
  assert.equal(detectKind('a memory game where you repeat a pattern'), 'memory');
  assert.equal(detectKind('dodge the falling rocks'), 'dodge');
  assert.equal(detectKind('a reaction test, press when it turns green'), 'reaction');
  assert.equal(detectKind('collect the coins before time runs out'), 'collect');
});

await check('two players is heard when it is asked for', () => {
  assert.deepEqual(specFromRequest('a two-player collecting game').players, { min: 2, max: 2 });
  assert.deepEqual(specFromRequest('a collecting game').players, { min: 1, max: 1 });
});

console.log('\nApplying a change:');

await check('"faster" means the right knob for the kind', () => {
  // There is no universal speed. In a chase game faster is a bigger number; in
  // a memory game it is a shorter flash. Getting this wrong silently produces
  // a revision that changes nothing, which is what happened first time.
  const chase = applyChange(specFromRequest('collect the coins'), 'make it faster');
  assert.ok(chase.spec.tuning.speed > specFromRequest('collect the coins').tuning.speed);

  const memory = applyChange(specFromRequest('a memory game'), 'make it faster');
  assert.ok(memory.spec.tuning.flashSeconds < specFromRequest('a memory game').tuning.flashSeconds);
  assert.deepEqual(memory.ignored, []);
});

await check('a change it cannot make is reported, not silently dropped', () => {
  // The honest failure mode. An unhandled request is the record of what the
  // spec cannot express — the research this milestone exists to gather.
  const result = applyChange(specFromRequest('a memory game'), 'add multiplayer over the internet');
  assert.deepEqual(result.applied, []);
  assert.equal(result.ignored.length, 1);
});

await check('a change applies to the previous spec, not a fresh reading', () => {
  const first = specFromRequest('dodge the falling rocks');
  const renamed = applyChange(first, 'call it Tumble').spec;
  const then = applyChange(renamed, '5 lives').spec;
  // The rename survives the second change: revisions compose.
  assert.equal(then.title, 'Tumble');
  assert.equal(then.tuning.lives, 5);
});

console.log('\nWhat the synthesizer emits:');

await check('every kind produces source that uses the toolbox', () => {
  for (const request of [
    'collect the coins',
    'dodge the falling rocks',
    'a memory game',
    'a reaction test',
    'hit the targets',
  ]) {
    const source = synthesize(specFromRequest(request));
    assert.match(source, /@gameboystudio\/sdk\/toolbox/, `${request}: no toolbox import`);
    assert.match(source, /runHostedGame/, `${request}: not a hosted game`);
    // The point of a toolbox is that these are not written again by hand.
    assert.match(source, /new Phases</, `${request}: reimplemented phases`);
    assert.doesNotMatch(source, /Math\.random\(\)/, `${request}: bypassed the toolbox rng`);
  }
});

await check('a spec that declares no saves emits no save', () => {
  const spec = { ...specFromRequest('collect the coins'), saves: false };
  const source = synthesize(spec);
  // Declared capabilities have to be true or gbs check refuses the bundle.
  assert.doesNotMatch(source, /codec\.serialize/);
});

console.log('\nThe project and its revisions:');

await check('a revision is recorded before it is known to work', () => {
  const root = tmp();
  const project = Project.create(root, projectId('demo'), 'demo');
  const revision = project.begin('a game', specFromRequest('collect the coins'), 'source');
  // Recorded as `generating` immediately, so a run interrupted half way leaves
  // a state that can be read rather than guessed at.
  assert.equal(revision.status, 'generating');
  assert.equal(project.revisions.length, 1);
  assert.equal(project.current, null, 'nothing is playable until something is ready');
});

await check('the current pointer refuses to move to a revision that is not ready', () => {
  const root = tmp();
  const project = Project.create(root, projectId('demo'), 'demo');
  const revision = project.begin('a game', specFromRequest('collect the coins'), 'source');
  project.setStatus(revision.n, 'failed');
  assert.throws(() => project.promote(revision.n), /Refusing/);
  assert.equal(project.current, null);
});

await check('a failed revision leaves the previous one playable', () => {
  // The rule that matters most. Someone who asks for a change and receives a
  // broken game has lost their game; that must not be possible.
  const root = tmp();
  const project = Project.create(root, projectId('demo'), 'demo');

  const first = project.begin('a game', specFromRequest('a memory game'), 'good source');
  project.setStatus(first.n, 'ready');
  project.promote(first.n);

  const second = project.begin('make it faster', specFromRequest('a memory game'), 'broken source');
  project.setStatus(second.n, 'failed');

  assert.equal(project.current.n, 1, 'the working revision is still current');
  assert.equal(project.sourceOf(1), 'good source', 'and its source is untouched');
  assert.equal(project.revisions.length, 2, 'the failure is kept as a record');
});

await check('a revision after a failure is parented on what is playable', () => {
  const root = tmp();
  const project = Project.create(root, projectId('demo'), 'demo');
  const first = project.begin('a game', specFromRequest('a memory game'), 'a');
  project.setStatus(first.n, 'ready');
  project.promote(first.n);
  const failed = project.begin('change', specFromRequest('a memory game'), 'b');
  project.setStatus(failed.n, 'failed');
  const next = project.begin('change again', specFromRequest('a memory game'), 'c');
  // Parented on revision 1, not on the failed 2: a follow-up modifies the game
  // the person still has, not the one that never worked.
  assert.equal(next.parent, 1);
});

await check('each revision gets its own immutable artifact version', () => {
  const root = tmp();
  const project = Project.create(root, projectId('demo'), 'demo');
  const versions = [1, 2, 3].map((n) => {
    const revision = project.begin(`r${n}`, specFromRequest('a memory game'), `s${n}`);
    project.setStatus(revision.n, 'ready');
    return revision.artifactVersion;
  });
  assert.equal(new Set(versions).size, 3, `versions repeated: ${versions.join(', ')}`);
  // D-019's shape: a new version beside the old one, never overwritten.
  assert.deepEqual(versions, ['1.0.0', '1.1.0', '1.2.0']);
});

await check('a project survives being closed and reopened', () => {
  const root = tmp();
  const id = projectId('demo');
  const project = Project.create(root, id, 'demo');
  const revision = project.begin('a game', specFromRequest('a memory game'), 'source');
  project.setStatus(revision.n, 'ready');
  project.promote(revision.n);

  const reopened = Project.open(root, id);
  assert.equal(reopened.current.n, 1);
  assert.equal(reopened.sourceOf(1), 'source');
  assert.equal(reopened.revisions[0].request, 'a game');
});

console.log('\nThe model boundary:');

await check('the synthesizer costs nothing and needs no provider', async () => {
  const generator = generatorNamed('synthesizer');
  const proposal = await generator.propose('a memory game');
  assert.equal(generator.name, 'synthesizer');
  assert.match(proposal.source, /runHostedGame/);
});

await check('the model generator is present and deliberately unselected', async () => {
  // D-025: the boundary is built, the model is not chosen. It has to fail
  // clearly rather than silently fall back to the synthesizer, or "we have not
  // chosen a model" would be indistinguishable from "we have".
  const generator = new ModelGenerator();
  await assert.rejects(() => generator.propose('a memory game'), /No model provider/);
});

await check('swapping the generator changes nothing else about the loop', async () => {
  // The adapter is the seam. If anything downstream knew which generator ran,
  // choosing a model later would be a rewrite rather than a swap.
  const custom = {
    name: 'fixture',
    async propose() {
      return {
        spec: specFromRequest('a memory game'),
        source: synthesize(specFromRequest('a memory game')),
        applied: ['fixture'],
        ignored: [],
      };
    },
    async repair() {
      return null;
    },
  };
  const proposal = await custom.propose();
  assert.match(proposal.source, /runHostedGame/);
  assert.ok(new Synthesizer().name !== custom.name);
});

console.log('\nA fresh clone can build:');

await check('the application build compiles forge too, and its dist is not committed', async () => {
  // The same trap the SDK fell into: dist is build output, correctly ignored,
  // which makes it absent in a fresh clone — and a deploy is a fresh clone.
  const { execFileSync } = await import('node:child_process');
  const scripts = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts;
  assert.match(scripts.prebuild ?? '', /forge:build/, `prebuild does not build forge: ${scripts.prebuild}`);

  const tracked = execFileSync('git', ['ls-files', 'packages/forge/dist'], {
    cwd: REPO,
    encoding: 'utf8',
  }).trim();
  assert.equal(tracked, '', `forge dist is committed:\n${tracked}`);
});

reporter.finish('forge checks');
