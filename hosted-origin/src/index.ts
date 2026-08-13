/**
 * The hosted games origin.
 *
 * A static file server and nothing else — D-019. It exists because the
 * application is deployed by Vercel, where `public/` is part of the build, so
 * anything served from there needs a rebuild. That is precisely the constraint
 * M5 removes, which makes a separate origin the requirement rather than a
 * preference.
 *
 * It is deliberately not the relay. D-017 accepted that Worker on the promise
 * it stays payload-blind and stores nothing, and serving game files from it
 * would contradict that.
 *
 * The only logic here is cache policy, and it is the part that makes the
 * milestone's proof unambiguous:
 *
 * - **Artifacts are immutable.** They live under a version in their path and are
 *   never overwritten, so they can be cached for a year.
 * - **The manifest is the only mutable document**, and always revalidates. An
 *   unchanged one costs a 304.
 *
 * Publishing is therefore "add an artifact, repoint the manifest", and rollback
 * is "repoint the manifest back" — the same action, not a special case.
 */

export interface Env {
  ASSETS: Fetcher;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Revalidate every time. Not `no-store` — an unchanged manifest is a 304. */
const REVALIDATE = 'no-cache';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Read only.', { status: 405 });
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);

    if (url.pathname === '/manifest.json') {
      headers.set('cache-control', REVALIDATE);
      headers.set('content-type', 'application/json; charset=utf-8');
    } else if (url.pathname.startsWith('/games/') && response.ok) {
      // Only a file that exists may be cached for a year. Marking a 404
      // immutable would pin "this game is missing" into every browser that
      // asked early, and publishing the artifact afterwards would not fix
      // them — the one caching mistake here that cannot be undone by
      // repointing the manifest.
      headers.set('cache-control', IMMUTABLE);
    } else {
      headers.set('cache-control', REVALIDATE);
    }

    // The manifest is fetched cross-origin by the application. The files are
    // public and read-only, so this is not a grant of anything.
    headers.set('access-control-allow-origin', '*');
    // A hosted game is framed by us on purpose, so framing is not denied here —
    // isolation comes from the sandbox attribute, not from headers. Everything
    // else is locked down.
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer');
    /**
     * The application became cross-origin isolated when Game Boy Advance
     * arrived (D-026), and an isolated document will not load a cross-origin
     * resource that has not opted in. These two headers are that opt-in: CORP
     * lets our pages fetch the manifest and the game files, and COEP lets the
     * game frame itself be embedded.
     *
     * This origin serves only public, read-only, already-CORS-open files, so
     * neither header gives anything away. **Deploying the app without
     * deploying this Worker breaks every hosted game**, which is the one
     * ordering constraint worth remembering here.
     */
    headers.set('cross-origin-resource-policy', 'cross-origin');
    headers.set('cross-origin-embedder-policy', 'require-corp');

    return new Response(response.body, { status: response.status, headers });
  },
};
