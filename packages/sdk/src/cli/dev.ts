/**
 * `gbs dev` — CHANGE → PLAY → FEEL → CHANGE.
 *
 * FUTURE_CREATOR_SYSTEM says the important interaction may not be
 * first-generation quality but iteration speed. So this rebuilds on change and
 * serves a preview host that speaks the real frame protocol into the real
 * sandbox.
 *
 * It is a preview, not the product. There is no library, no rooms, no
 * InputRouter — and it says so on the page, because a preview that pretended
 * otherwise would send people to publish games that behave differently in
 * GameBoyStudio than they did here.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { context as esbuildContext } from 'esbuild';
import { frameHtml } from './build.js';
import { readProject } from './project.js';
import { previewHtml } from './preview.js';

export async function runDev(args: string[]): Promise<void> {
  const dir = args.find((value) => !value.startsWith('--')) ?? '.';
  const portFlag = args.indexOf('--port');
  const port = portFlag >= 0 ? Number(args[portFlag + 1]) : 8790;

  const project = readProject(dir);
  const outDir = path.join(project.dir, '.gbs', project.slug, project.version);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'frame.html'), frameHtml(project));

  const ctx = await esbuildContext({
    entryPoints: [path.join(project.dir, project.entry)],
    outfile: path.join(outDir, 'bundle.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    sourcemap: 'inline',
    logLevel: 'warning',
  });
  await ctx.watch();

  const framePath = `/games/${project.slug}/${project.version}/frame.html`;
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
  };

  http
    .createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(previewHtml(project, framePath));
        return;
      }
      const file = path.join(project.dir, '.gbs', url.pathname.replace('/games/', ''));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404).end('Not found');
        return;
      }
      // No caching in dev: the whole point is seeing the change.
      response.writeHead(200, {
        'content-type': types[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      fs.createReadStream(file).pipe(response);
    })
    .listen(port, '127.0.0.1');

  console.log(`\n  ${project.title}  →  http://127.0.0.1:${port}`);
  console.log('  Edits rebuild automatically. Reload to see them.');
  console.log('  This is a preview host, not GameBoyStudio: no library, no rooms.\n');
}
