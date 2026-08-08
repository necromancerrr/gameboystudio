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

/**
 * Rendering is not playability. binjgb only reads the joypad buffer that
 * `set_joyp_*` writes to once `_emulator_set_default_joypad_callback` is
 * installed; without it every press is silently dropped and the games look
 * perfect but respond to nothing. This asserts input actually lands.
 *
 * Both runs advance identical emulated time — the only difference is whether
 * the button is held — so a difference can only come from the input.
 */
async function screenAfter({ holdStart, installCallback, romPath, warmupSec, holdSec }) {
  const mod = await sandbox.__Binjgb({ wasmBinary });
  const rom = fs.readFileSync(`${REPO}/public${romPath}`);
  const size = (rom.byteLength + 0x7fff) & ~0x7fff;
  const ptr = mod._malloc(size);
  new Uint8Array(mod.HEAP8.buffer, ptr, size).fill(0).set(rom);
  const e = mod._emulator_new_simple(ptr, size, 44100, 4096, 2);

  if (installCallback) {
    mod._emulator_set_default_joypad_callback(e, mod._joypad_new());
  }

  const advance = (sec) => {
    const t = mod._emulator_get_ticks_f64(e) + CPU_TICKS_PER_SECOND * sec;
    for (;;) { if (mod._emulator_run_until_f64(e, t) & EVENT_UNTIL_TICKS) break; }
  };

  advance(warmupSec);
  if (holdStart) mod._set_joyp_start(e, 1);
  advance(holdSec);

  const fb = new Uint8Array(mod.HEAP8.buffer, mod._get_frame_buffer_ptr(e), mod._get_frame_buffer_size(e));
  let h = 0;
  for (let i = 0; i < fb.length; i += 13) h = (h * 31 + fb[i]) | 0;
  return h;
}

const INPUT_CASES = [
  { slug: 'tobutobugirl', romPath: '/roms/tobutobugirl.gb', warmupSec: 12, holdSec: 4 },
  { slug: 'snake', romPath: '/roms/snake.gb', warmupSec: 6, holdSec: 4 },
];

console.log('\nInput reaching the core:');
let inputPass = 0;
for (const testCase of INPUT_CASES) {
  const idle = await screenAfter({ ...testCase, holdStart: false, installCallback: true });
  const held = await screenAfter({ ...testCase, holdStart: true, installCallback: true });
  if (idle !== held) {
    console.log(`  ok   ${testCase.slug.padEnd(24)} START changes the screen`);
    inputPass++;
  } else {
    console.log(`  FAIL ${testCase.slug.padEnd(24)} START does nothing — is the joypad callback installed?`);
    failures.push(`${testCase.slug} (input)`);
  }
}
console.log(`${inputPass}/${INPUT_CASES.length} respond to input`);

/**
 * Battery saves: a save must survive being written out and read back, and a
 * save sized for a different cartridge must be rejected rather than partially
 * applied. Mirrors BinjgbAdapter.readSave / loadSave.
 */
const BATTERY_TYPES = new Set([0x03, 0x06, 0x09, 0x0d, 0x0f, 0x10, 0x13, 0x1b, 0x1e, 0x22, 0xff]);

function withExtRam(mod, e, body) {
  const fd = mod._ext_ram_file_data_new(e);
  if (!fd) return null;
  try {
    const buf = new Uint8Array(mod.HEAP8.buffer, mod._get_file_data_ptr(fd), mod._get_file_data_size(fd));
    return body(fd, buf);
  } finally { mod._file_data_delete(fd); }
}

console.log('\nBattery saves:');
let saveChecked = 0;
let savePass = 0;
for (const game of games) {
  const rom = fs.readFileSync(`${REPO}/public${game.romPath}`);
  if (!BATTERY_TYPES.has(rom[0x147])) continue;

  const mod = await sandbox.__Binjgb({ wasmBinary });
  const size = (rom.byteLength + 0x7fff) & ~0x7fff;
  const ptr = mod._malloc(size);
  new Uint8Array(mod.HEAP8.buffer, ptr, size).fill(0).set(rom);
  const e = mod._emulator_new_simple(ptr, size, 44100, 4096, 2);

  const ramSize = withExtRam(mod, e, (_fd, buf) => buf.byteLength) ?? 0;
  if (ramSize === 0) continue;
  saveChecked += 1;

  const pattern = new Uint8Array(ramSize);
  for (let i = 0; i < ramSize; i += 1) pattern[i] = (i * 7 + 13) & 0xff;

  withExtRam(mod, e, (fd, buf) => { buf.set(pattern); mod._emulator_read_ext_ram(e, fd); });
  const readBack = withExtRam(mod, e, (fd, buf) => {
    mod._emulator_write_ext_ram(e, fd);
    return new Uint8Array(buf);
  });

  const intact = readBack && readBack.length === ramSize && readBack.every((v, i) => v === pattern[i]);
  const rejectsMismatch = withExtRam(mod, e, (_fd, buf) => buf.byteLength !== ramSize + 16);

  if (intact && rejectsMismatch) {
    console.log(`  ok   ${game.slug.padEnd(24)} ${(ramSize / 1024).toFixed(0)}K round-trips`);
    savePass += 1;
  } else {
    console.log(`  FAIL ${game.slug.padEnd(24)} save did not round-trip`);
    failures.push(`${game.slug} (save)`);
  }
}
console.log(`${savePass}/${saveChecked} battery saves round-trip`);

if (failures.length) { console.log('\nfailed:', failures.join(', ')); process.exit(1); }
