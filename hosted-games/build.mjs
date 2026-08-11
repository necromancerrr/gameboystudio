/**
 * Builds the hosted artifacts.
 *
 * This is a **separate build from the application**, and that separation is the
 * milestone rather than an implementation detail (D-018). Concretely:
 *
 * - It has its own entry points and its own output directory.
 * - It writes into the hosted origin's public folder, never into `.next`.
 * - `next build` does not produce these files, and deleting `.next` does not
 *   affect them.
 *
 * esbuild is used narrowly, as a build tool for these artifacts only. It is not
 * a runtime dependency and it is not a game engine abstraction: it turns a few
 * TypeScript files into one script, and that is all it is allowed to be.
 *
 * Artifacts are written under a version in their path and never overwritten in
 * place, because the manifest points at a specific version and the whole update
 * and rollback mechanism is repointing it (D-019).
 *
 * Usage:
 *   node hosted-games/build.mjs                # build at the current version
 *   node hosted-games/build.mjs --version 1.1.0
 *   node hosted-games/build.mjs --label "…"    # changes visible text, for the swap proof
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = `${REPO}/hosted-origin/public/games`;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const VERSION = flag('version', '1.0.0');
/**
 * Injected into the page so a build can be told apart from the previous one by
 * looking at it. The swap proof needs a visible difference that does not
 * require understanding the game.
 */
const LABEL = flag('label', '');
const ORIGIN = flag('origin', 'http://127.0.0.1:8788');
/** Comma-separated slugs to build and publish. Defaults to all of them. */
const ONLY = flag('only', '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const GAMES = [
  {
    slug: 'ring-out-hosted',
    entry: 'ring-out.ts',
    title: 'Ring Out (hosted)',
    developer: 'GameBoyStudio',
    description:
      'The same two-player sumo, running as a hosted game rather than one compiled into the site.',
    players: { min: 2, max: 2 },
    inputs: { required: [], supported: ['gamepad', 'keyboard'] },
    saves: false,
    genre: ['Party', 'Versus'],
  },
  {
    slug: 'drift-hosted',
    entry: 'drift.ts',
    title: 'Drift (hosted)',
    developer: 'GameBoyStudio',
    description:
      'One star, one ship, one button that matters — hosted rather than compiled, and it still remembers your best.',
    players: { min: 1, max: 1 },
    inputs: { required: [], supported: ['gamepad', 'keyboard', 'touch'] },
    saves: true,
    genre: ['Action', 'Score Attack'],
  },
];

/**
 * The document the sandboxed frame loads.
 *
 * Deliberately tiny and self-contained: no external stylesheet, no font, no
 * analytics. A hosted game's page is the game.
 */
const frameHtml = (slug, label) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${slug}</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
  .build-label {
    position: fixed; left: 6px; bottom: 4px; z-index: 2;
    font: 11px/1 ui-monospace, monospace; color: #9bbc0f; opacity: 0.85;
    pointer-events: none;
  }
</style>
</head>
<body>
${label ? `<div class="build-label" data-testid="build-label">${label}</div>` : ''}
<script src="./bundle.js"></script>
</body>
</html>
`;

fs.mkdirSync(OUT_ROOT, { recursive: true });

const manifestGames = [];

const selected = ONLY.length > 0 ? GAMES.filter((game) => ONLY.includes(game.slug)) : GAMES;
if (selected.length === 0) throw new Error(`--only matched nothing: ${ONLY.join(', ')}`);

for (const game of selected) {
  const outDir = `${OUT_ROOT}/${game.slug}/${VERSION}`;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [`${REPO}/hosted-games/src/${game.entry}`],
    outfile: `${outDir}/bundle.js`,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    sourcemap: false,
    // The project's `@/…` alias, resolved here rather than by Next — these
    // files are never seen by the application build.
    alias: { '@': `${REPO}/src` },
    logLevel: 'warning',
  });

  fs.writeFileSync(`${outDir}/frame.html`, frameHtml(game.slug, LABEL));

  manifestGames.push({
    slug: game.slug,
    title: game.title,
    developer: game.developer,
    description: game.description,
    year: 2026,
    players: game.players,
    inputs: game.inputs,
    saves: game.saves,
    genre: game.genre,
    screenshots: [],
    license: 'LicenseRef-GameBoyStudio-Original',
    attribution: 'GameBoyStudio',
    sourceUrl: '',
    // The version lives in the URL, so a new version cannot be served from a
    // stale document and rollback is just pointing back here.
    frameUrl: `${ORIGIN}/games/${game.slug}/${VERSION}/frame.html`,
  });

  const bytes = fs.statSync(`${outDir}/bundle.js`).size;
  console.log(`  ${game.slug.padEnd(18)} ${VERSION}  ${(bytes / 1024).toFixed(1)}KB`);
}

fs.writeFileSync(
  `${REPO}/hosted-origin/public/manifest.json`,
  `${JSON.stringify({ version: 1, games: manifestGames }, null, 2)}\n`,
);

console.log(`\nmanifest -> ${manifestGames.length} hosted games at ${ORIGIN}`);
if (LABEL) console.log(`label    -> "${LABEL}"`);
