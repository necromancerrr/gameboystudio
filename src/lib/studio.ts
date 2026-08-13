/**
 * The app's one door into forge.
 *
 * Everything generative goes through here so the boundary the design depends on
 * — the player never meets projects, revisions, builds or source — has exactly
 * one place it can be broken.
 *
 * Generation is a background job. A request starts one and returns; the browser
 * asks how it is going. That is what lets someone keep playing while their game
 * is made, which is how the Instant Contract survives a 30-second build.
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  Project,
  projectId,
  summaryOf,
  viewOf,
  type GameSummary,
  type GameView,
} from '@gameboystudio/forge/read';

const REPO = process.cwd();
export const FORGE_ROOT = process.env.GBS_FORGE_ROOT ?? path.join(REPO, '.forge');
const SDK_PATH = process.env.GBS_SDK_PATH ?? path.join(REPO, 'packages/sdk');

/**
 * The browser stage costs ~7s and needs Chrome. The prototype defaults to the
 * build-and-bundle gate so a request never depends on a browser starting, and
 * opts into the full run explicitly. Both genuinely check; one checks more.
 */
const QUICK = process.env.GBS_FORGE_FULL_CHECK !== '1';

/**
 * Builds in flight, so a second request for a game cannot race the first.
 *
 * Generation runs as a child process rather than in the request: it needs
 * esbuild, npm and possibly a browser, and none of that belongs inside a web
 * server's module graph. It also means a build that dies cannot take the app
 * with it.
 */
const running = new Map<string, ReturnType<typeof spawn>>();

/**
 * Why a build died before it became a project.
 *
 * A conformance failure is recorded on the project as a failed revision, and
 * the view speaks for it. A generation failure — no credentials, the service
 * unreachable, a request it declined — happens *before* the project exists, so
 * there is nothing on disk to ask. Without this the browser polls an id that
 * returns 404 forever, which reads as a game that vanished.
 *
 * In memory on purpose: it describes an attempt, not a game, and a restart
 * legitimately ends it.
 */
const failures = new Map<string, string>();

const FORGE_CLI = path.join(REPO, 'packages/forge/bin/forge.mjs');

/** The last non-empty line the CLI printed — where it puts the reason. */
function lastLine(output: string): string {
  const lines = output.trim().split('\n').filter((line) => line.trim().length > 0);
  return lines[lines.length - 1]?.trim() ?? '';
}

function runForge(id: string, args: string[]): void {
  const child = spawn(process.execPath, [FORGE_CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, GBS_FORGE_ROOT: FORGE_ROOT, GBS_SDK_PATH: SDK_PATH },
    // stderr is kept because it carries the one thing the filesystem cannot:
    // why a run ended before it wrote anything.
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: false,
  });
  running.set(id, child);
  failures.delete(id);

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    // Bounded: a runaway process must not be able to grow this without limit.
    if (stderr.length < 8_000) stderr += chunk.toString();
  });

  child.on('exit', (code) => {
    running.delete(id);
    if (code !== 0) {
      failures.set(id, lastLine(stderr) || 'That did not work. Try again in a moment.');
    }
  });
  child.on('error', () => {
    running.delete(id);
    failures.set(id, 'The game builder could not be started.');
  });
}

const playBase = (id: string) => `/api/games/${id}`;

export function listGames(): GameSummary[] {
  return Project.list(FORGE_ROOT)
    .map((id) => summaryOf(Project.open(FORGE_ROOT, id), playBase(id)))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export function getGame(id: string): GameView | null {
  try {
    const view = viewOf(Project.open(FORGE_ROOT, id), playBase(id));
    // A generation failure on an existing game outranks the recorded status:
    // the project's newest revision is whatever last succeeded, which would
    // otherwise report the game as fine while the change they just asked for
    // is nowhere.
    const failure = failures.get(id);
    return failure && view.status !== 'building' ? { ...view, problem: failure } : view;
  } catch {
    return failedBeforeItStarted(id);
  }
}

/** There is no project, so everything the view would read is missing. */
function failedBeforeItStarted(id: string): GameView | null {
  const problem = failures.get(id);
  if (!problem) return null;
  return {
    id,
    title: 'That game',
    status: 'failed',
    playUrl: null,
    understood: [],
    couldNotDo: [],
    changes: [],
    problem,
    canUndo: false,
    updatedAt: null,
  };
}

export function isBuilding(id: string): boolean {
  return running.has(id);
}

/**
 * Starts a build and returns immediately.
 *
 * The id exists before the work finishes, or the browser has nothing to poll
 * and the making shelf has nothing to show.
 */
export function startNewGame(request: string): { id: string } {
  const id = projectId('game');
  runForge(id, ['new', '--id', id, ...(QUICK ? ['--quick'] : []), request]);
  return { id };
}

export function startChange(id: string, request: string): { ok: boolean; reason?: string } {
  if (running.has(id)) return { ok: false, reason: 'already-building' };
  runForge(id, ['revise', id, ...(QUICK ? ['--quick'] : []), request]);
  return { ok: true };
}

/** Falls back to the previous version that worked. Never to a failed one. */
export function undoLastChange(id: string): { ok: boolean; reason?: string } {
  const project = Project.open(FORGE_ROOT, id);
  const ready = project.revisions.filter((revision) => revision.status === 'ready');
  if (ready.length < 2) return { ok: false, reason: 'nothing-to-undo' };
  project.promote(ready[ready.length - 2].n);
  return { ok: true };
}

export function goBackTo(id: string, changeId: string): { ok: boolean; reason?: string } {
  const project = Project.open(FORGE_ROOT, id);
  const revision = project.revisions.find((candidate) => String(candidate.n) === changeId);
  if (!revision || revision.status !== 'ready') return { ok: false, reason: 'not-playable' };
  project.promote(revision.n);
  return { ok: true };
}

export function artifactPath(id: string, parts: string[]): string {
  // The path is built from a request, so the bundler cannot see where it points
  // and traces the entire project into the server output as a precaution. The
  // caller resolves and confines the result to the project directory before
  // touching the filesystem, and generated games live outside the build
  // entirely — nothing here is a file the deployment needs to carry.
  return path.join(/*turbopackIgnore: true*/ FORGE_ROOT, id, ...parts);
}
