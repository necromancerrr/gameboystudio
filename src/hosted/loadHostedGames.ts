/**
 * Fetches and validates the hosted games manifest.
 *
 * The rule this file exists to keep: **the compiled catalog never waits on the
 * network.** The Instant Contract is binding, so a hosted origin that is slow,
 * unreachable, or serving nonsense must cost the player nothing. Every failure
 * here resolves to "no hosted games" rather than an error anyone sees.
 *
 * Nothing is cached in memory beyond the current page: the manifest is served
 * `no-cache` so the browser revalidates and an unchanged document costs a 304
 * (D-019). Holding our own copy would reintroduce exactly the staleness that
 * policy exists to remove.
 */

import { GAMES } from '@/catalog/games';
import { HOSTED_CONFIG } from './hostedConfig';
import { validateManifest, type HostedGame } from './manifest';

/** Long enough for a cold edge, short enough that nothing waits on it. */
const TIMEOUT_MS = 4000;
/** A manifest larger than this is not a curated catalog. */
const MAX_BYTES = 512 * 1024;

export interface HostedLoad {
  games: HostedGame[];
  /** Present when something was wrong. For logs and tests, never for players. */
  problem: string | null;
}

const EMPTY: HostedLoad = { games: [], problem: null };

export async function loadHostedGames(signal?: AbortSignal): Promise<HostedLoad> {
  const { manifestUrl, origins, enabled, problem } = HOSTED_CONFIG;
  if (problem) return { games: [], problem };
  if (!enabled) return EMPTY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(manifestUrl, {
      signal: controller.signal,
      // Let the browser revalidate rather than second-guessing it here. The
      // origin sends no-cache, so this is a conditional request, not a refetch.
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) return { games: [], problem: `manifest returned ${response.status}` };

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) return { games: [], problem: 'manifest too large' };

    const text = await response.text();
    if (text.length > MAX_BYTES) return { games: [], problem: 'manifest too large' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { games: [], problem: 'manifest is not JSON' };
    }

    const result = validateManifest(parsed, {
      allowedOrigins: origins,
      takenSlugs: new Set(GAMES.map((game) => game.slug)),
    });

    return {
      games: result.games,
      problem:
        result.rejected.length > 0
          ? `dropped ${result.rejected.length}: ${result.rejected
              .map((entry) => `${entry.slug ?? '?'} (${entry.reason})`)
              .join(', ')}`
          : null,
    };
  } catch (error) {
    // Offline, DNS failure, CORS, timeout, a redirect we refused. None of these
    // are worth a player's attention; they simply mean no hosted games today.
    return {
      games: [],
      problem: error instanceof Error ? error.message : 'manifest could not be fetched',
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
