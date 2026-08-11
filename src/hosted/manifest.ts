/**
 * The hosted games manifest, and the validator that decides what is allowed in.
 *
 * This document arrives over the network at runtime, which is the whole point of
 * M5 (D-018) and also the reason this file is paranoid. Everything here is
 * treated as hostile input even though we are currently the only publisher: a
 * manifest is fetched, not compiled, so nothing about it is guaranteed by the
 * type system at the point it is read.
 *
 * The rules, in order of how much damage they prevent:
 *
 * 1. `frameUrl` and every image URL must be on an allowlisted origin. Without
 *    this, a manifest could point the player's browser at an arbitrary frame,
 *    which is the one field that leads to code execution.
 * 2. `sourceUrl` must be http(s). A `javascript:` URL in a link href is a
 *    scripting hole that React will happily render.
 * 3. A hosted slug may not collide with a compiled game. Otherwise a hosted
 *    entry could quietly shadow a curated one.
 * 4. Everything is bounded — string lengths, array lengths, player counts — so a
 *    hostile or broken document cannot exhaust memory or the layout engine.
 *
 * A single bad entry is dropped and the rest are kept. A document that is not
 * usable at all yields nothing, and the site behaves exactly as it did before
 * M5. Failure here is never allowed to take the catalog with it.
 */

import type { Game, InputProfile } from '@/catalog/types';

export const MANIFEST_VERSION = 1;

/** Generous for a curated catalog, small enough to bound the work. */
const LIMITS = {
  games: 200,
  slug: 64,
  title: 120,
  developer: 120,
  description: 2000,
  genre: 8,
  genreItem: 40,
  screenshots: 6,
  url: 2048,
  license: 120,
  attribution: 200,
  players: 8,
} as const;

const INPUT_PROFILES: readonly InputProfile[] = ['gamepad', 'keyboard', 'touch'];

/** Lowercase, digits and dashes — the shape the existing catalog already uses. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export interface HostedGame extends Game {
  runtime: 'hosted';
  /**
   * The document the sandboxed frame loads. Carries the artifact version in its
   * path, so a new version cannot be served from a stale document (D-019).
   */
  frameUrl: string;
}

export interface ManifestResult {
  games: HostedGame[];
  /** Why entries were dropped. Surfaced to logs and tests, never to players. */
  rejected: { slug: string | null; reason: string }[];
}

export interface ValidateOptions {
  /** Origins a frame or image may be served from. Empty rejects everything. */
  allowedOrigins: readonly string[];
  /** Slugs already taken by the compiled catalog. */
  takenSlugs: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/** Optional strings are allowed to be absent or empty, never malformed. */
function optionalStr(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return undefined;
  if (value.length > max) return undefined;
  return value.trim();
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function onAllowedOrigin(url: unknown, allowed: readonly string[]): string | null {
  if (typeof url !== 'string' || url.length > LIMITS.url) return null;
  const origin = originOf(url);
  if (!origin) return null;
  return allowed.includes(origin) ? url : null;
}

/**
 * A link the player can click. Not origin-restricted — it points at the game's
 * own homepage — but the scheme is, because `javascript:` in an href executes.
 */
function safeLink(url: unknown): string | null {
  if (url === undefined || url === null || url === '') return '';
  if (typeof url !== 'string' || url.length > LIMITS.url) return null;
  return originOf(url) ? url : null;
}

function profiles(value: unknown): readonly InputProfile[] | null {
  if (!Array.isArray(value) || value.length > INPUT_PROFILES.length) return null;
  const out: InputProfile[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const profile = INPUT_PROFILES.find((known) => known === item);
    if (!profile) return null;
    if (!out.includes(profile)) out.push(profile);
  }
  return out;
}

function validateGame(
  raw: unknown,
  options: ValidateOptions,
  seen: Set<string>,
): { game: HostedGame } | { reason: string; slug: string | null } {
  if (!isRecord(raw)) return { reason: 'not an object', slug: null };

  const slug = str(raw.slug, LIMITS.slug);
  if (!slug || !SLUG.test(slug)) return { reason: 'bad slug', slug: null };
  // A hosted entry must never be able to shadow a curated compiled one.
  if (options.takenSlugs.has(slug)) return { reason: 'slug already in the catalog', slug };
  if (seen.has(slug)) return { reason: 'duplicate slug in the manifest', slug };

  const title = str(raw.title, LIMITS.title);
  if (!title) return { reason: 'missing title', slug };

  const developer = str(raw.developer, LIMITS.developer);
  if (!developer) return { reason: 'missing developer', slug };

  const description = optionalStr(raw.description, LIMITS.description);
  if (description === undefined) return { reason: 'bad description', slug };

  let year: number | null = null;
  if (raw.year !== undefined && raw.year !== null) {
    if (typeof raw.year !== 'number' || !Number.isInteger(raw.year)) {
      return { reason: 'bad year', slug };
    }
    if (raw.year < 1970 || raw.year > 2200) return { reason: 'bad year', slug };
    year = raw.year;
  }

  if (!isRecord(raw.players)) return { reason: 'missing players', slug };
  const { min, max } = raw.players;
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 1 ||
    max < min ||
    max > LIMITS.players
  ) {
    return { reason: 'bad player count', slug };
  }

  if (!isRecord(raw.inputs)) return { reason: 'missing inputs', slug };
  const required = profiles(raw.inputs.required);
  const supported = profiles(raw.inputs.supported);
  if (!required || !supported) return { reason: 'bad input profiles', slug };
  if (supported.length === 0) return { reason: 'no supported input', slug };
  // Declaring something required that the game does not support is incoherent,
  // and discovery reads both fields as if they agree.
  if (required.some((profile) => !supported.includes(profile))) {
    return { reason: 'required input is not supported', slug };
  }

  if (typeof raw.saves !== 'boolean') return { reason: 'bad saves flag', slug };

  const genre: string[] = [];
  if (raw.genre !== undefined) {
    if (!Array.isArray(raw.genre) || raw.genre.length > LIMITS.genre) {
      return { reason: 'bad genre list', slug };
    }
    for (const item of raw.genre) {
      const value = str(item, LIMITS.genreItem);
      if (!value) return { reason: 'bad genre', slug };
      genre.push(value);
    }
  }

  const screenshots: string[] = [];
  if (raw.screenshots !== undefined) {
    if (!Array.isArray(raw.screenshots) || raw.screenshots.length > LIMITS.screenshots) {
      return { reason: 'bad screenshot list', slug };
    }
    for (const item of raw.screenshots) {
      const value = onAllowedOrigin(item, options.allowedOrigins);
      if (!value) return { reason: 'screenshot is off-origin', slug };
      screenshots.push(value);
    }
  }

  const license = str(raw.license, LIMITS.license);
  if (!license) return { reason: 'missing license', slug };
  const attribution = optionalStr(raw.attribution, LIMITS.attribution);
  if (attribution === undefined) return { reason: 'bad attribution', slug };

  const sourceUrl = safeLink(raw.sourceUrl);
  if (sourceUrl === null) return { reason: 'bad source url', slug };
  const homepageUrl = safeLink(raw.homepageUrl);
  if (homepageUrl === null) return { reason: 'bad homepage url', slug };

  // The field that leads to code execution, so it is the strictest.
  const frameUrl = onAllowedOrigin(raw.frameUrl, options.allowedOrigins);
  if (!frameUrl) return { reason: 'frame is off-origin', slug };

  seen.add(slug);
  return {
    game: {
      slug,
      title,
      developer,
      description: description ?? '',
      year,
      runtime: 'hosted',
      // The player resolves a hosted game through frameUrl; `entry` keeps the
      // shared shape honest for anything that reads Game generically.
      entry: frameUrl,
      players: { min, max },
      inputs: { required, supported },
      saves: raw.saves,
      console: null,
      genre,
      screenshots,
      license,
      attribution: attribution ?? '',
      sourceUrl: sourceUrl ?? '',
      homepageUrl: homepageUrl ?? '',
      // Hosted games sort after the curated list rather than interleaving with
      // a rank they could otherwise choose for themselves.
      rank: Number.MAX_SAFE_INTEGER,
      series: null,
      frameUrl,
    },
  };
}

/**
 * Turns an unknown document into games we are willing to run.
 *
 * Never throws. An unusable document yields no games, which leaves the site as
 * it was — the Instant Contract is binding, and a bad manifest is not a reason
 * for the library to break.
 */
export function validateManifest(raw: unknown, options: ValidateOptions): ManifestResult {
  const rejected: ManifestResult['rejected'] = [];

  if (!isRecord(raw)) return { games: [], rejected: [{ slug: null, reason: 'not an object' }] };
  if (raw.version !== MANIFEST_VERSION) {
    return { games: [], rejected: [{ slug: null, reason: `unsupported version ${String(raw.version)}` }] };
  }
  if (!Array.isArray(raw.games)) {
    return { games: [], rejected: [{ slug: null, reason: 'games is not a list' }] };
  }
  if (raw.games.length > LIMITS.games) {
    return { games: [], rejected: [{ slug: null, reason: 'too many games' }] };
  }

  const games: HostedGame[] = [];
  const seen = new Set<string>();
  for (const entry of raw.games) {
    const result = validateGame(entry, options, seen);
    if ('game' in result) games.push(result.game);
    else rejected.push({ slug: result.slug, reason: result.reason });
  }

  return { games, rejected };
}
