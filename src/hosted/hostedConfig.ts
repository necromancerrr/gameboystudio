/**
 * Where hosted games come from.
 *
 * Unset means the feature is simply off: no manifest is fetched, no request is
 * made, and the site behaves exactly as it did before M5. That is the honest
 * default for a build with no hosted origin behind it — the same rule the relay
 * follows (D-017) — and it is what makes this safe to ship dark.
 *
 * The resolution is a pure function taking the raw strings, so its failure modes
 * can be tested. They are worth testing: "hosted games are silently off" and
 * "hosted games are on with a useless allowlist" are both quiet, and the second
 * one is the dangerous kind of quiet.
 */

export interface HostedConfig {
  manifestUrl: string;
  /**
   * Origins a frame or image may be served from.
   *
   * An allowlist rather than "wherever the manifest says", because `frameUrl`
   * is the one field that ends in code execution. A manifest free to name any
   * origin would be a way to run someone else's page inside ours.
   */
  origins: readonly string[];
  enabled: boolean;
  /** Why it is off despite being configured. Null when off on purpose. */
  problem: string | null;
}

export function resolveHostedConfig(rawManifestUrl: string, rawOrigins: string): HostedConfig {
  const manifestUrl = rawManifestUrl.trim();
  const origins = rawOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const off = { manifestUrl, origins, enabled: false };

  // Deliberately off, which is not a problem worth reporting.
  if (!manifestUrl) return { ...off, problem: null };

  if (origins.length === 0) {
    return {
      ...off,
      problem:
        'NEXT_PUBLIC_HOSTED_MANIFEST_URL is set but NEXT_PUBLIC_HOSTED_ORIGINS is empty, ' +
        'so nothing the manifest names could be trusted.',
    };
  }

  let manifestOrigin: string;
  try {
    const parsed = new URL(manifestUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ...off, problem: `The hosted manifest URL must be http(s): ${manifestUrl}` };
    }
    manifestOrigin = parsed.origin;
  } catch {
    return { ...off, problem: `The hosted manifest URL is not a URL: ${manifestUrl}` };
  }

  // Checked rather than assumed: a manifest served from an unlisted origin
  // should not be able to introduce itself.
  if (!origins.includes(manifestOrigin)) {
    return {
      ...off,
      problem: `The hosted manifest is on ${manifestOrigin}, which is not in the allowlist (${origins.join(', ')}).`,
    };
  }

  return { manifestUrl, origins, enabled: true, problem: null };
}

export const HOSTED_CONFIG = resolveHostedConfig(
  process.env.NEXT_PUBLIC_HOSTED_MANIFEST_URL ?? '',
  process.env.NEXT_PUBLIC_HOSTED_ORIGINS ?? '',
);
