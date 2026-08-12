/**
 * A generated game, and its history.
 *
 * D-024 is the whole of this file. Generating once is stateless; the milestone's
 * actual claim is that a follow-up request modifies *that same game*, and that
 * is impossible unless the game is a durable thing with an ordered past.
 *
 * Two rules do the work, and both are about not losing a game that worked:
 *
 * 1. **Revisions are appended, never edited.** A failed attempt keeps its own
 *    source and its own verdict, so it is a record of what was tried rather
 *    than the loss of what worked.
 * 2. **`currentRevision` moves last.** While a follow-up is generating,
 *    checking or repairing, the previous version stays playable — and if the
 *    new one fails, it stays playable permanently. Someone who asks for a
 *    change and receives a broken game has lost their game; that must not be
 *    possible.
 *
 * Persistence is a directory. No accounts, no cloud, no database — deliberately
 * out of scope, and nothing here forecloses them.
 */

import fs from 'node:fs';
import path from 'node:path';

export type RevisionStatus = 'generating' | 'checking' | 'repairing' | 'ready' | 'failed';

/** The structured intent a request produced. Deliberately small and readable. */
export interface GameSpec {
  kind: string;
  title: string;
  players: { min: number; max: number };
  saves: boolean;
  genre: string[];
  /** Knobs the synthesizer understands; a revision usually changes one of these. */
  tuning: Record<string, number | string | boolean>;
}

export interface ConformanceRecord {
  ok: boolean;
  failed: string[];
  checks: { name: string; ok: boolean; detail?: string }[];
  /** Milliseconds, per phase, so a slow loop can be attributed rather than guessed at. */
  timings?: Record<string, number>;
}

export interface Revision {
  n: number;
  /** The revision this one was asked to change. Null for the first. */
  parent: number | null;
  /** What was asked for, in the person's own words. */
  request: string;
  spec: GameSpec;
  /** Path, relative to the project, of the source this revision was built from. */
  source: string;
  /** The immutable version its build landed under, e.g. "1.2.0". */
  artifactVersion: string;
  conformance: ConformanceRecord | null;
  status: RevisionStatus;
  createdAt: string;
  notes?: string;
}

export interface ProjectFile {
  id: string;
  slug: string;
  createdAt: string;
  /** The revision that is playable now. Never a failed one. */
  currentRevision: number | null;
  revisions: Revision[];
}

const FILE = 'project.json';

export class Project {
  private constructor(
    readonly dir: string,
    private data: ProjectFile,
  ) {}

  static create(root: string, id: string, slug: string): Project {
    const dir = path.join(root, id);
    if (fs.existsSync(dir)) throw new Error(`A project called ${id} already exists.`);
    fs.mkdirSync(path.join(dir, 'revisions'), { recursive: true });
    const project = new Project(dir, {
      id,
      slug,
      createdAt: new Date().toISOString(),
      currentRevision: null,
      revisions: [],
    });
    project.save();
    return project;
  }

  static open(root: string, id: string): Project {
    const dir = path.join(root, id);
    const file = path.join(dir, FILE);
    if (!fs.existsSync(file)) throw new Error(`No project called ${id} in ${root}.`);
    return new Project(dir, JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectFile);
  }

  static list(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((item) => item.isDirectory() && fs.existsSync(path.join(root, item.name, FILE)))
      .map((item) => item.name);
  }

  get id(): string {
    return this.data.id;
  }

  get slug(): string {
    return this.data.slug;
  }

  get revisions(): readonly Revision[] {
    return this.data.revisions;
  }

  /** The revision a player would get. Null until one has succeeded. */
  get current(): Revision | null {
    if (this.data.currentRevision === null) return null;
    return this.data.revisions.find((r) => r.n === this.data.currentRevision) ?? null;
  }

  get latest(): Revision | null {
    return this.data.revisions[this.data.revisions.length - 1] ?? null;
  }

  /**
   * Starts a revision. It is recorded immediately, in `generating`, so a run
   * interrupted half way leaves a state that can be read rather than guessed at.
   */
  begin(request: string, spec: GameSpec, source: string): Revision {
    const n = this.data.revisions.length + 1;
    const revision: Revision = {
      n,
      // The parent is what is *playable*, not what was tried last: a follow-up
      // after a failure modifies the game the person still has.
      parent: this.data.currentRevision,
      request,
      spec,
      source: path.join('revisions', String(n), 'game.ts'),
      artifactVersion: `1.${n - 1}.0`,
      conformance: null,
      status: 'generating',
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.join(this.dir, 'revisions', String(n)), { recursive: true });
    fs.writeFileSync(path.join(this.dir, revision.source), source);
    this.data.revisions.push(revision);
    this.save();
    return revision;
  }

  /** Rewrites a revision's source during repair. Only ever the newest one. */
  rewrite(n: number, source: string): void {
    const revision = this.revision(n);
    fs.writeFileSync(path.join(this.dir, revision.source), source);
  }

  setStatus(n: number, status: RevisionStatus, notes?: string): void {
    const revision = this.revision(n);
    revision.status = status;
    if (notes) revision.notes = notes;
    this.save();
  }

  setConformance(n: number, conformance: ConformanceRecord): void {
    this.revision(n).conformance = conformance;
    this.save();
  }

  /**
   * The only way `currentRevision` ever moves, and it refuses to move to
   * anything that is not ready. This is the rule that keeps a working game
   * working when a change goes wrong.
   */
  promote(n: number): void {
    const revision = this.revision(n);
    if (revision.status !== 'ready') {
      throw new Error(`Refusing to make revision ${n} current: it is ${revision.status}.`);
    }
    this.data.currentRevision = n;
    this.save();
  }

  revision(n: number): Revision {
    const revision = this.data.revisions.find((r) => r.n === n);
    if (!revision) throw new Error(`No revision ${n} in ${this.id}.`);
    return revision;
  }

  sourceOf(n: number): string {
    return fs.readFileSync(path.join(this.dir, this.revision(n).source), 'utf8');
  }

  /** Where a revision's built artifact lives. Each gets its own, immutably. */
  artifactDir(n: number): string {
    return path.join(this.dir, 'build');
  }

  private save(): void {
    fs.writeFileSync(path.join(this.dir, FILE), `${JSON.stringify(this.data, null, 2)}\n`);
  }
}

/** A stable, readable id. Not a UUID: these get typed by hand. */
export function projectId(slug: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(2, 12);
  return `${slug}-${stamp}`;
}
