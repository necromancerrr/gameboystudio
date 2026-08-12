/**
 * Building a game project into a hosted artifact.
 *
 * The output is exactly what the hosted origin serves: a frame document and one
 * bundle, under a versioned path. esbuild is the bundler and nothing more — a
 * creator can replace it, so long as what lands here has the same shape.
 */

import fs from 'node:fs';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import type { GameProject } from './project.js';

/**
 * The document the sandboxed frame loads.
 *
 * Tiny and self-contained on purpose: no external stylesheet, no font, no
 * analytics. A hosted game's page is the game.
 */
export function frameHtml(project: GameProject): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${project.title.replace(/[<>&]/g, '')}</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
</style>
</head>
<body>
<script src="./bundle.js"></script>
</body>
</html>
`;
}

export interface BuildResult {
  outDir: string;
  bytes: number;
}

export async function buildProject(
  project: GameProject,
  outRoot: string,
  { minify = true }: { minify?: boolean } = {},
): Promise<BuildResult> {
  const outDir = path.join(outRoot, project.slug, project.version);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild({
    entryPoints: [path.join(project.dir, project.entry)],
    outfile: path.join(outDir, 'bundle.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify,
    sourcemap: false,
    logLevel: 'warning',
    // Deliberately no alias configuration. A game resolves the SDK the way it
    // resolves anything else — from its own node_modules (D-020).
  });

  fs.writeFileSync(path.join(outDir, 'frame.html'), frameHtml(project));
  return { outDir, bytes: fs.statSync(path.join(outDir, 'bundle.js')).size };
}
