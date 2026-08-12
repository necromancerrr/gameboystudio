/**
 * The shape rules a manifest entry must satisfy.
 *
 * These live in the SDK so `gbs check` runs the same rules the platform does —
 * a game that passes locally and is refused on publish would make the check
 * worthless. The application's validator applies these and then adds the rules
 * only it can know: which origins are allowed, and which slugs are taken.
 *
 * Kept deliberately free of any judgement about the game. This says whether an
 * entry is well-formed, in the sense of D-022.
 */

export interface ManifestEntryShape {
  slug?: unknown;
  title?: unknown;
  developer?: unknown;
  description?: unknown;
  year?: unknown;
  players?: unknown;
  inputs?: unknown;
  saves?: unknown;
  genre?: unknown;
  screenshots?: unknown;
  license?: unknown;
  attribution?: unknown;
  sourceUrl?: unknown;
  frameUrl?: unknown;
}

export const INPUT_PROFILES = ['gamepad', 'keyboard', 'touch'] as const;

export const ENTRY_LIMITS = {
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

/** Lowercase, digits and dashes — the shape the catalog already uses. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

/** Returns the first problem, or null when the entry is well-formed. */
export function validateEntry(entry: ManifestEntryShape): string | null {
  const text = (value: unknown, max: number): string | null =>
    typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;

  const slug = text(entry.slug, ENTRY_LIMITS.slug);
  if (!slug || !SLUG_PATTERN.test(slug)) return 'bad slug';
  if (!text(entry.title, ENTRY_LIMITS.title)) return 'missing title';
  if (!text(entry.developer, ENTRY_LIMITS.developer)) return 'missing developer';
  if (!text(entry.license, ENTRY_LIMITS.license)) return 'missing license';

  if (entry.description !== undefined && entry.description !== null) {
    if (typeof entry.description !== 'string' || entry.description.length > ENTRY_LIMITS.description) {
      return 'bad description';
    }
  }

  if (entry.year !== undefined && entry.year !== null) {
    if (typeof entry.year !== 'number' || !Number.isInteger(entry.year)) return 'bad year';
    if (entry.year < 1970 || entry.year > 2200) return 'bad year';
  }

  const players = entry.players as { min?: unknown; max?: unknown } | undefined;
  if (!players || typeof players.min !== 'number' || typeof players.max !== 'number') {
    return 'missing players';
  }
  if (
    !Number.isInteger(players.min) ||
    !Number.isInteger(players.max) ||
    players.min < 1 ||
    players.max < players.min ||
    players.max > ENTRY_LIMITS.players
  ) {
    return 'bad player count';
  }

  const inputs = entry.inputs as { required?: unknown; supported?: unknown } | undefined;
  if (!inputs) return 'missing inputs';
  const profiles = (value: unknown): string[] | null => {
    if (!Array.isArray(value) || value.length > INPUT_PROFILES.length) return null;
    const out: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string' || !(INPUT_PROFILES as readonly string[]).includes(item)) return null;
      if (!out.includes(item)) out.push(item);
    }
    return out;
  };
  const required = profiles(inputs.required ?? []);
  const supported = profiles(inputs.supported);
  if (!required || !supported) return 'bad input profiles';
  if (supported.length === 0) return 'no supported input';
  // Declaring something required the game does not support is incoherent, and
  // discovery reads both fields as if they agree.
  if (required.some((profile) => !supported.includes(profile))) {
    return 'required input is not supported';
  }

  if (typeof entry.saves !== 'boolean') return 'bad saves flag';

  if (entry.genre !== undefined) {
    if (!Array.isArray(entry.genre) || entry.genre.length > ENTRY_LIMITS.genre) return 'bad genre list';
    for (const item of entry.genre) {
      if (!text(item, ENTRY_LIMITS.genreItem)) return 'bad genre';
    }
  }

  if (entry.screenshots !== undefined) {
    if (!Array.isArray(entry.screenshots) || entry.screenshots.length > ENTRY_LIMITS.screenshots) {
      return 'bad screenshot list';
    }
  }

  const frameUrl = entry.frameUrl;
  if (typeof frameUrl !== 'string' || frameUrl.length > ENTRY_LIMITS.url) return 'bad frame url';
  let parsed: URL;
  try {
    parsed = new URL(frameUrl);
  } catch {
    return 'frame url is not a url';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'frame url is not http(s)';
  // The version in the path is what makes an artifact immutable and rollback a
  // matter of repointing the manifest (D-019).
  if (!/\/\d+\.\d+\.\d+\//.test(parsed.pathname)) return 'frame url carries no version';

  return null;
}
