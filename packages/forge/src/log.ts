/**
 * What people asked for, and what came back.
 *
 * This is the milestone's research output, not an operational log. The question
 * it exists to answer is *what do people actually ask a game platform for, and
 * where does it break* — which is unanswerable from the projects on disk, since
 * those record the requests that worked and quietly lose the shape of the ones
 * that did not.
 *
 * So every attempt is written, successes included, and failures carry the
 * checks that rejected them. One JSON object per line, appended, never rewritten
 * — a format that survives a crash mid-write and can be read with `grep` on a
 * machine with nothing installed.
 *
 * It holds the request text, which is the person's own words. That is the point
 * of it and also its whole privacy surface: it is local to the machine that
 * generated the games, there is nothing else identifying in it, and it must not
 * grow a user id.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface RequestRecord {
  at: string;
  projectId: string;
  revision: number;
  /** A first request, or a change to a game that already exists. */
  kind: 'new' | 'change';
  /** What the person typed, verbatim. */
  request: string;
  generator: string;
  ok: boolean;
  /** What the generator says it built, and what it could not. */
  applied: string[];
  ignored: string[];
  /** The conformance checks that rejected it. Empty on success. */
  failed: string[];
  /** Whether a repair attempt was made, and whether it rescued the revision. */
  repaired?: boolean;
  timings: Record<string, number>;
  /** Model calls made, and what they cost in tokens. Absent for the synthesizer. */
  calls?: { input: number; output: number; cacheRead: number; cacheWrite: number }[];
  /** Set when the attempt did not get as far as a verdict. */
  error?: string;
}

const FILE = 'requests.jsonl';

export function logRequest(root: string, record: RequestRecord): void {
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(path.join(root, FILE), `${JSON.stringify(record)}\n`);
  } catch {
    // Losing a research record must never cost someone their game. This is the
    // one place in the loop where failing silently is the right behaviour.
  }
}

/** Reads the log back. Tolerates a truncated final line from an interrupted write. */
export function readRequests(root: string): RequestRecord[] {
  const file = path.join(root, FILE);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as RequestRecord];
      } catch {
        return [];
      }
    });
}
