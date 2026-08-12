/**
 * Serving a generated game's files.
 *
 * These are not catalog content and never enter the manifest — unlisted, not
 * published. The player loads them into the same sandboxed frame every hosted
 * game uses, so `sandbox="allow-scripts"` still gives an opaque origin and the
 * isolation from M5 holds whether the files come from the hosted origin or from
 * here.
 *
 * Path traversal is the obvious risk when a URL segment becomes a file path, so
 * the resolved path is checked to be inside the project rather than trusted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { artifactPath, FORGE_ROOT } from '@/lib/studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: parts } = await params;

  const file = artifactPath(id, ['play', ...parts]);
  const root = path.resolve(FORGE_ROOT, id);
  if (!path.resolve(file).startsWith(root)) {
    return new Response('Not found', { status: 404 });
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(fs.readFileSync(file), {
    headers: {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      // Artifacts live under a version, so they never change in place — the same
      // immutability D-019 relies on, applied to generated games.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
