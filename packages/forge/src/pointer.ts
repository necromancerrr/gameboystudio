/**
 * The share pointer: the smallest thing a link needs to resolve.
 *
 * A shared URL is opened by someone with no device state, so the pointer cannot
 * live in localStorage. It is five fields and nothing else — deliberately not a
 * project system, not a database, not publishing.
 *
 * The rule that gives the file its purpose: **it only ever names a READY
 * revision.** A build in flight or a failed one never touches it, so a link
 * shared an hour ago keeps playing the game it pointed at while its owner is
 * mid-change or has just broken something.
 */

export interface SharePointer {
  projectId: string;
  title: string;
  /** The artifact a player loads. Always from a revision that reached ready. */
  artifact: { version: string; frame: string };
  updatedAt: string;
  /** Reachable by link, absent from discovery. The only value for now. */
  visibility: 'unlisted';
}

export function pointerFor(
  projectId: string,
  title: string,
  version: string,
  frame: string,
): SharePointer {
  return {
    projectId,
    title,
    artifact: { version, frame },
    updatedAt: new Date().toISOString(),
    visibility: 'unlisted',
  };
}
