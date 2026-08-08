// Boots every ROM in the catalog through binjgb and asserts it renders.
// Catches a bad ingest, or a core incompatibility, before it reaches the
// library UI. Run with: npm run verify:catalog
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CPU_TICKS_PER_SECOND = 4194304;
const EVENT_UNTIL_TICKS = 4;

const glue = fs.readFileSync(`${REPO}/public/emulator/binjgb/binjgb.js`, 'utf8');
const sandbox = { globalThis: null, console: { log() {}, error() {} }, fetch, URL, TextDecoder, performance };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(glue + '\n;globalThis.__Binjgb = Binjgb;', sandbox);
const wasmBinary = fs.readFileSync(`${REPO}/public/emulator/binjgb/binjgb.wasm`);

const games = fs.readFileSync(`${REPO}/src/catalog/games.ts`, 'utf8')
  .split('\n')
  .reduce((acc, line) => {
    const slug = line.match(/^\s+slug: "(.+)",$/);
    const rom = line.match(/^\s+romPath: "(.+)",$/);
    if (slug) acc.push({ slug: slug[1] });
    if (rom) acc[acc.length - 1].romPath = rom[1];
    return acc;
  }, []);

let pass = 0;
const failures = [];

for (const game of games) {
  const mod = await sandbox.__Binjgb({ wasmBinary });
  try {
    const rom = fs.readFileSync(`${REPO}/public${game.romPath}`);
    const size = (rom.byteLength + 0x7fff) & ~0x7fff;
    const ptr = mod._malloc(size);
    new Uint8Array(mod.HEAP8.buffer, ptr, size).fill(0).set(rom);
    const e = mod._emulator_new_simple(ptr, size, 44100, 4096, 2);
    if (e === 0) throw new Error('core rejected ROM');

    const fb = new Uint8Array(mod.HEAP8.buffer, mod._get_frame_buffer_ptr(e), mod._get_frame_buffer_size(e));
    const target = mod._emulator_get_ticks_f64(e) + CPU_TICKS_PER_SECOND * 4;
    for (;;) { if (mod._emulator_run_until_f64(e, target) & EVENT_UNTIL_TICKS) break; }

    const colors = new Set();
    for (let i = 0; i < fb.length; i += 4) colors.add((fb[i] << 16) | (fb[i + 1] << 8) | fb[i + 2]);
    if (colors.size < 2) throw new Error(`blank screen after 4s (${colors.size} colour)`);

    console.log(`  ok   ${game.slug.padEnd(24)} ${String(colors.size).padStart(3)} colours  ${(rom.byteLength / 1024).toFixed(0)}K`);
    pass++;
    mod._emulator_delete(e);
    mod._free(ptr);
  } catch (error) {
    console.log(`  FAIL ${game.slug.padEnd(24)} ${error.message}`);
    failures.push(game.slug);
  }
}

console.log(`\n${pass}/${games.length} ROMs boot and render`);
if (failures.length) { console.log('failed:', failures.join(', ')); process.exit(1); }
