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

const FORGE_CLI = path.join(REPO, 'packages/forge/bin/forge.mjs');

function runForge(id: string, args: string[]): void {
  const child = spawn(process.execPath, [FORGE_CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, GBS_FORGE_ROOT: FORGE_ROOT, GBS_SDK_PATH: SDK_PATH },
    stdio: 'ignore',
    detached: false,
  });
  running.set(id, child);
  // However it ends, the slot frees. A failed build is recorded on the project
  // as a failed revision, so there is nothing to report from here.
  child.on('exit', () => running.delete(id));
  child.on('error', () => running.delete(id));
}

const playBase = (id: string) => `/api/games/${id}`;

export function listGames(): GameSummary[] {
  return Project.list(FORGE_ROOT)
    .map((id) => summaryOf(Project.open(FORGE_ROOT, id), playBase(id)))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export function getGame(id: string): GameView | null {
  try {
    return viewOf(Project.open(FORGE_ROOT, id), playBase(id));
  } catch {
    return null;
  }
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
