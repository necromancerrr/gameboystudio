/**
 * What a player is allowed to see.
 *
 * The design rule is that nobody encounters forge, source files, manifests,
 * builds or version numbers. That is easy to promise in a UI and easy to break
 * one field at a time, so it is enforced here instead: this is the only shape
 * that crosses into the app, and it is built by naming fields rather than by
 * removing them from a project.
 *
 * A `Project` has revisions, statuses, specs, source paths and artifact
 * versions. A `GameView` has a title, whether it is ready, and the things you
 * asked for. Anything the player should not know simply has nowhere to travel.
 */

import type { Project, RevisionStatus } from './project.js';

/** What the player understands is happening. Not the internal status. */
export type GameStatus = 'building' | 'ready' | 'failed';

export interface ChangeView {
  /** Opaque to the UI, which shows the words instead. */
  id: string;
  /** What was asked for, in the person's own words. */
  request: string;
  /** True for the one being played now. */
  current: boolean;
  /** Understood, but the result did not work. */
  failed: boolean;
}

export interface GameView {
  id: string;
  title: string;
  status: GameStatus;
  /** Present once something has been ready. A failed change never clears it. */
  playUrl: string | null;
  /** Plain-language reading of the newest request, for the making state. */
  understood: string[];
  /** What the newest request asked for and did not get. */
  couldNotDo: string[];
  /** The person's own requests, newest first. */
  changes: ChangeView[];
  /** Whether there is an earlier ready version to fall back to. */
  canUndo: boolean;
  updatedAt: string | null;
}

/** Player-facing status. `checking` and `repairing` are both just "building". */
function statusOf(internal: RevisionStatus): GameStatus {
  if (internal === 'ready') return 'ready';
  if (internal === 'failed') return 'failed';
  return 'building';
}

export function viewOf(project: Project, playBase: string): GameView {
  const revisions = [...project.revisions];
  const latest = revisions[revisions.length - 1] ?? null;
  const current = project.current;
  const pointer = project.pointer;

  const readyCount = revisions.filter((revision) => revision.status === 'ready').length;

  return {
    id: project.id,
    // The title follows what is *playable*, so a failed rename does not rename
    // the game the person still has.
    title: current?.spec.title ?? latest?.spec.title ?? project.slug,
    status: latest ? statusOf(latest.status) : 'building',
    // Always the pointer, never the newest revision: a link and a page in a
    // browser must agree, and both must show the last thing that worked.
    playUrl: pointer ? `${playBase}/${pointer.artifact.frame}` : null,
    understood: latest?.notes ? JSON.parse(latest.notes).applied ?? [] : [],
    couldNotDo: latest?.notes ? JSON.parse(latest.notes).ignored ?? [] : [],
    changes: revisions
      .slice()
      .reverse()
      .map((revision) => ({
        id: String(revision.n),
        request: revision.request,
        current: revision.n === current?.n,
        failed: revision.status === 'failed',
      })),
    canUndo: readyCount > 1,
    updatedAt: pointer?.updatedAt ?? null,
  };
}

/** The shelf-sized summary. Enough to render a tile, and nothing more. */
export interface GameSummary {
  id: string;
  title: string;
  status: GameStatus;
  playUrl: string | null;
  updatedAt: string | null;
}

export function summaryOf(project: Project, playBase: string): GameSummary {
  const view = viewOf(project, playBase);
  return {
    id: view.id,
    title: view.title,
    status: view.status,
    playUrl: view.playUrl,
    updatedAt: view.updatedAt,
  };
}
