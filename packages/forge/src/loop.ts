/**
 * The loop: request in, playable game out, and again.
 *
 *   REQUEST → GENERATE → CHECK / REPAIR → PLAY → FOLLOW-UP → NEW VERSION → PLAY
 *
 * The rule that shapes everything here is D-024's: **the previous version stays
 * playable until a new one is ready.** A new revision is built beside the old
 * one and the pointer moves at the end — the same shape M5 uses for publishing,
 * applied to iteration. Someone who asks for a change and gets a broken game
 * has lost their game, and that must not be possible.
 *
 * Phases are timed separately because "it got slow" is useless and "check went
 * from 4s to 19s" is actionable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Project, projectId, type ConformanceRecord, type GameSpec } from './project.js';
import { generatorNamed, type GameGenerator } from './generator.js';
import { buildProject, readProject } from '@gameboystudio/sdk/cli';

export interface LoopOptions {
  root: string;
  /** Where the SDK tarball or package lives, for the generated project to install. */
  sdkPath: string;
  generator?: GameGenerator;
  /** Skip the browser conformance run. The fast path during iteration. */
  quick?: boolean;
  /**
   * Chosen by the caller rather than derived from the title, so a request can
   * return an id before the work is done and the browser has something to poll.
   */
  id?: string;
}

export interface LoopResult {
  projectId: string;
  revision: number;
  ok: boolean;
  timings: Record<string, number>;
  applied: string[];
  ignored: string[];
  conformance: ConformanceRecord | null;
  playPath: string;
}

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'game';

/** A project directory a creator could open: this is a real SDK project. */
function scaffold(project: Project, spec: GameSpec, sdkPath: string): void {
  const dir = project.dir;
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify(
      { name: `gbs-${project.slug}`, private: true, type: 'module', dependencies: {} },
      null,
      2,
    )}\n`,
  );
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });

  // Installed rather than aliased, exactly as an outside creator would (D-020).
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', sdkPath], {
    cwd: dir,
    stdio: 'pipe',
  });
}

function writeManifest(project: Project, spec: GameSpec, entry: string, version: string): void {
  fs.writeFileSync(
    path.join(project.dir, 'gbs.game.json'),
    `${JSON.stringify(
      {
        slug: project.slug,
        title: spec.title,
        developer: 'GameBoyStudio',
        description: `Generated: ${spec.kind}.`,
        entry,
        version,
        players: spec.players,
        inputs: { required: [], supported: ['gamepad', 'keyboard', 'touch'] },
        saves: spec.saves,
        genre: spec.genre,
        license: 'LicenseRef-GameBoyStudio-Original',
        attribution: 'GameBoyStudio',
      },
      null,
      2,
    )}\n`,
  );
}

function runCheck(project: Project, sdkPath: string, quick: boolean): ConformanceRecord {
  const gbs = path.join(project.dir, 'node_modules/.bin/gbs');
  // `--quick` skips the browser stage inside gbs check: iteration needs to know
  // it compiles and bundles, and the full conformance run happens before
  // anything is published.
  const args = quick ? ['check', '.', '--json', '--quick'] : ['check', '.', '--json'];
  try {
    const out = execFileSync(gbs, args, {
      cwd: project.dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    const verdict = JSON.parse(out.slice(out.indexOf('{'))) as ConformanceRecord & {
      checks: { name: string; ok: boolean; detail?: string }[];
    };
    return { ok: verdict.ok, failed: verdict.failed ?? [], checks: verdict.checks ?? [] };
  } catch (error) {
    const output = (error as { stdout?: string }).stdout ?? '';
    try {
      const verdict = JSON.parse(output.slice(output.indexOf('{')));
      return { ok: false, failed: verdict.failed ?? ['check failed'], checks: verdict.checks ?? [] };
    } catch {
      return {
        ok: false,
        failed: ['the conformance run did not produce a verdict'],
        checks: [{ name: 'gbs check ran', ok: false, detail: String(output).slice(0, 300) }],
      };
    }
  }
}

async function runRevision(
  project: Project,
  request: string,
  generator: GameGenerator,
  options: LoopOptions,
  previous?: { spec: GameSpec; source: string },
): Promise<LoopResult> {
  const timings: Record<string, number> = {};
  const clockAsync = async <T,>(name: string, body: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    const value = await body();
    timings[name] = Date.now() - started;
    return value;
  };
  const clock = <T,>(name: string, body: () => T): T => {
    const started = Date.now();
    const value = body();
    timings[name] = Date.now() - started;
    return value;
  };

  const startedGenerate = Date.now();
  const proposal = await generator.propose(request, previous);
  timings.generate = Date.now() - startedGenerate;

  const revision = project.begin(request, proposal.spec, proposal.source);

  clock('scaffold', () => {
    if (!fs.existsSync(path.join(project.dir, 'node_modules/@gameboystudio/sdk'))) {
      scaffold(project, proposal.spec, options.sdkPath);
    }
    // The entry always points at *this* revision's snapshot, so a build can
    // never accidentally pick up the previous one.
    writeManifest(project, proposal.spec, revision.source, revision.artifactVersion);
  });

  project.setStatus(revision.n, 'checking');
  let conformance = clock('check', () => runCheck(project, options.sdkPath, options.quick ?? false));

  if (!conformance.ok) {
    project.setStatus(revision.n, 'repairing');
    const repair = await generator.repair({
      spec: proposal.spec,
      source: proposal.source,
      failed: conformance.failed,
      details: conformance.checks.filter((c) => !c.ok),
    });
    if (repair) {
      project.rewrite(revision.n, repair.source);
      conformance = clock('recheck', () => runCheck(project, options.sdkPath, options.quick ?? false));
    }
  }

  conformance.timings = timings;
  project.setConformance(revision.n, conformance);
  // What the request was understood to mean travels with the revision, because
  // the player-facing view needs it and it is also the record of what the spec
  // could not express.
  project.setStatus(
    revision.n,
    conformance.ok ? 'ready' : 'failed',
    JSON.stringify({ applied: proposal.applied, ignored: proposal.ignored }),
  );

  // Build the artifact the player will actually load, before promoting: the
  // pointer must never name a version whose files are not on disk.
  if (conformance.ok) {
    await clockAsync('publish', async () => {
      // buildProject lays out <root>/<slug>/<version>/, so rooting it at the
      // project gives play/<slug>/<version>/frame.html — which is what the
      // pointer names.
      await buildProject(readProject(project.dir), path.join(project.dir, 'play'), {
        minify: true,
      });
    });
  }

  // The pointer moves last, and only on success. A failed change leaves the
  // person with the game they already had.
  if (conformance.ok) project.promote(revision.n);

  timings.total = Object.entries(timings)
    .filter(([name]) => name !== 'total')
    .reduce((sum, [, value]) => sum + value, 0);

  return {
    projectId: project.id,
    revision: revision.n,
    ok: conformance.ok,
    timings,
    applied: proposal.applied,
    ignored: proposal.ignored,
    conformance,
    playPath: project.dir,
  };
}

/** A request with no history behind it. */
export async function forgeNew(request: string, options: LoopOptions): Promise<LoopResult> {
  const generator = options.generator ?? generatorNamed('synthesizer');
  const preview = await generator.propose(request);
  const slug = slugify(preview.spec.title);
  const project = Project.create(options.root, options.id ?? projectId(slug), slug);
  return runRevision(project, request, generator, options);
}

/** A change to a game that already exists. */
export async function forgeRevise(
  id: string,
  request: string,
  options: LoopOptions,
): Promise<LoopResult> {
  const generator = options.generator ?? generatorNamed('synthesizer');
  const project = Project.open(options.root, id);
  const current = project.current;
  if (!current) {
    throw new Error(`${id} has no playable revision yet, so there is nothing to change.`);
  }
  return runRevision(project, request, generator, options, {
    spec: current.spec,
    source: project.sourceOf(current.n),
  });
}
