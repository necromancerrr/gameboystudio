/**
 * Fetches the GBA spike's test ROMs into public/spike-roms/.
 *
 * The ROMs are not committed: 34MB of binaries for a branch that is not meant
 * to merge. Everything here is downloaded from the gbadev community database,
 * the GBA counterpart to the Homebrew Hub source D-008 already uses.
 *
 * Licensing, which is the whole point of picking these three:
 * - MeteoRain      MIT      Dr. Ludos
 * - The Purple Night  MPL-2.0  Corwin & Gwilym Kuiper (agb)
 * - Skyland        MPL-2.0  evanbowman
 *
 * No GPL titles. Apotris and Attack on Voxelburg are the obvious other
 * candidates and are deliberately excluded until there is a licensing policy
 * for GPL-family ROMs — see ACQUISITION.md.
 *
 * These are spike fixtures, not catalog entries. Per CONTENT_RESEARCH.md, GBA
 * homebrew routinely pairs a permissive code license with CC-BY-NC audio, and
 * none of these three has had the per-asset audit that D-008 would require
 * before shipping. Run with: node scripts/fetch-spike-roms.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = `${REPO}/public/spike-roms`;
const BASE = 'https://raw.githubusercontent.com/gbadev-org/games/master/entries';

const ROMS = [
  { entry: 'meteorain-gba-jam-2021', file: 'MeteoRain.gba', license: 'MIT' },
  { entry: 'the-purple-night', file: 'the-purple-night.gba', license: 'MPL-2.0' },
  { entry: 'skyland', file: 'Skyland.gba', license: 'MPL-2.0' },
];

/** The GBA header carries the Nintendo logo at 0x04. A truncated or HTML
 *  response would sail past a size check but not past this. */
const LOGO_HEAD = '24ffae51699aa221';

fs.mkdirSync(OUT, { recursive: true });

for (const rom of ROMS) {
  const target = `${OUT}/${rom.file}`;
  if (fs.existsSync(target)) {
    console.log(`  have  ${rom.file}`);
    continue;
  }

  const response = await fetch(`${BASE}/${rom.entry}/${rom.file}`);
  if (!response.ok) {
    console.log(`  FAIL  ${rom.file} — HTTP ${response.status}`);
    process.exitCode = 1;
    continue;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const logo = Buffer.from(bytes.slice(4, 12)).toString('hex');
  if (logo !== LOGO_HEAD) {
    console.log(`  FAIL  ${rom.file} — not a GBA ROM (logo ${logo})`);
    process.exitCode = 1;
    continue;
  }

  fs.writeFileSync(target, bytes);
  console.log(
    `  ok    ${rom.file.padEnd(24)} ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB  ${rom.license}`,
  );
}
