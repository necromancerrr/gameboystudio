/**
 * `gbs create` — start from a game that already runs.
 *
 * A creator's first minute should be spent playing something, not configuring
 * a build. The template is a complete, valid, boring game: it runs, it saves,
 * it passes `gbs check`, and every line of it is meant to be deleted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function runCreate(args: string[]): Promise<void> {
  const target = args.find((value) => !value.startsWith('--'));
  if (!target) throw new Error('Where should it go?  gbs create my-game');

  const dir = path.resolve(target);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    throw new Error(`${dir} already has something in it.`);
  }

  const template = path.resolve(HERE, '../../template');
  if (!fs.existsSync(template)) throw new Error('This SDK build has no template.');

  fs.cpSync(template, dir, { recursive: true });
  const slug = path.basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const manifest = path.join(dir, 'gbs.game.json');
  fs.writeFileSync(
    manifest,
    fs.readFileSync(manifest, 'utf8').replace(/__SLUG__/g, slug).replace(/__TITLE__/g, slug),
  );

  console.log(`
  Made ${dir}

    cd ${path.relative(process.cwd(), dir) || '.'}
    npm install
    npx gbs dev .

  Then edit game.ts and reload.
`);
}
