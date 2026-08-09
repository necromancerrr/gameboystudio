/**
 * Generates library preview assets by running each ROM headlessly.
 *
 * Two modes:
 *   node scripts/generate-previews.mjs probe <slug...>
 *     Captures a timeline with no input and writes a contact sheet, so a human
 *     can see when the intro ends, where the title screen is, and what a recipe
 *     needs to do.
 *
 *   node scripts/generate-previews.mjs build [slug...]
 *     Applies the recipes below, writes a contact sheet for review, and emits
 *     the shipped assets.
 *
 * A frame-difference metric CANNOT tell gameplay from a blinking "PRESS START",
 * an animated title screen, or a menu loop. Every motion preview in this file
 * was approved by looking at its contact sheet. `motion: false` means no
 * convincing loop was reachable and the card uses a still instead — that is a
 * legitimate outcome, not a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 160;
const H = 144;
const TICKS = 4194304;

const OUT_DIR = `${REPO}/public/previews`;
const SHEET_DIR = process.env.GBS_SHEETS ?? `${REPO}/.preview-sheets`;

const SETTERS = {
  up: '_set_joyp_up', down: '_set_joyp_down', left: '_set_joyp_left', right: '_set_joyp_right',
  a: '_set_joyp_A', b: '_set_joyp_B', start: '_set_joyp_start', select: '_set_joyp_select',
};

/**
 * Per-game recipes, in curated order so the most visible cards are best.
 *
 *   warmup  seconds to run before anything else (skips logos and intros)
 *   press   [{ button, atSec, holdSec }] to reach actual play
 *   settle  seconds after the last press before capture starts
 *   during  [{ button, atFrame, holdSec }] pressed while capturing — needed by
 *           turn-based and puzzle games, whose screens only change on input
 *   frames  how many frames to capture
 *   fps     capture rate; also the playback rate
 *   motion  set only after reviewing the contact sheet
 *   still   frame index to use for the static image; omit to auto-pick
 *   skip    keep the existing curated screenshot; no asset is emitted
 */

const glue = fs.readFileSync(`${REPO}/public/emulator/binjgb/binjgb.js`, 'utf8');
const wasmBinary = fs.readFileSync(`${REPO}/public/emulator/binjgb/binjgb.wasm`);

function newModule() {
  const sandbox = {
    globalThis: null,
    console: { log() {}, error() {} },
    fetch, URL, TextDecoder, performance,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(glue + '\n;globalThis.__Binjgb = Binjgb;', sandbox);
  return sandbox.__Binjgb({ wasmBinary: wasmBinary.slice(0) });
}

async function openRom(romPath) {
  const mod = await newModule();
  const rom = fs.readFileSync(`${REPO}/public${romPath}`);
  const size = (rom.byteLength + 0x7fff) & ~0x7fff;
  const ptr = mod._malloc(size);
  new Uint8Array(mod.HEAP8.buffer, ptr, size).fill(0).set(rom);
  const e = mod._emulator_new_simple(ptr, size, 44100, 4096, 2);
  if (!e) throw new Error('core rejected ROM');
  mod._emulator_set_default_joypad_callback(e, mod._joypad_new());

  let clock = 0;
  const advance = (sec) => {
    if (sec <= 0) return;
    const target = mod._emulator_get_ticks_f64(e) + TICKS * sec;
    for (;;) if (mod._emulator_run_until_f64(e, target) & 4) break;
    clock += sec;
  };
  const frame = () =>
    Buffer.from(new Uint8Array(mod.HEAP8.buffer, mod._get_frame_buffer_ptr(e), W * H * 4));
  const tap = (button, holdSec = 0.15) => {
    mod[SETTERS[button]](e, 1);
    advance(holdSec);
    mod[SETTERS[button]](e, 0);
    advance(0.05);
  };

  return { advance, frame, tap, at: () => clock };
}

/** Distinct colours in a frame — a rough proxy for "something is happening". */
function complexity(buf) {
  const seen = new Set();
  for (let i = 0; i < buf.length; i += 4) {
    seen.add((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]);
  }
  return seen.size;
}

function signature(buf) {
  let h = 0;
  for (let i = 0; i < buf.length; i += 53) h = (h * 31 + buf[i]) | 0;
  return h;
}

/** Contact sheet: every frame, numbered, at 2x, for human review. */
async function contactSheet(frames, labels, outFile, cols = 6) {
  const scale = 2;
  const cellW = W * scale;
  const cellH = H * scale + 18;
  const rows = Math.ceil(frames.length / cols);

  const tiles = await Promise.all(
    frames.map((buf) =>
      sharp(buf, { raw: { width: W, height: H, channels: 4 } })
        .resize({ width: cellW, height: H * scale, kernel: 'nearest' })
        .png()
        .toBuffer(),
    ),
  );

  const labelSvgs = labels.map((text, i) =>
    Buffer.from(
      `<svg width="${cellW}" height="18"><rect width="100%" height="100%" fill="#111"/>` +
      `<text x="6" y="13" font-family="monospace" font-size="12" fill="#9bbc0f">${text}</text></svg>`,
    ),
  );

  await sharp({
    create: {
      width: cellW * cols,
      height: cellH * rows,
      channels: 4,
      background: { r: 10, g: 12, b: 10, alpha: 1 },
    },
  })
    .composite([
      ...tiles.map((input, i) => ({
        input,
        left: (i % cols) * cellW,
        top: Math.floor(i / cols) * cellH,
      })),
      ...labelSvgs.map((input, i) => ({
        input,
        left: (i % cols) * cellW,
        top: Math.floor(i / cols) * cellH + H * scale,
      })),
    ])
    .png()
    .toFile(outFile);
}

/** Horizontal sprite strip, played back with a CSS steps() animation. */
async function writeStrip(frames, outFile) {
  const composites = frames.map((input, i) => ({
    input,
    raw: { width: W, height: H, channels: 4 },
    left: i * W,
    top: 0,
  }));
  const buf = await sharp({
    create: { width: W * frames.length, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite(composites)
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  fs.writeFileSync(outFile, buf);
  return buf.length;
}

async function writeStill(buf, outFile) {
  const out = await sharp(buf, { raw: { width: W, height: H, channels: 4 } })
    .webp({ quality: 92 })
    .toBuffer();
  fs.writeFileSync(outFile, out);
  return out.length;
}

async function probe(slug, romPath, seconds = 24) {
  const rom = await openRom(romPath);
  const frames = [];
  const labels = [];
  for (let s = 1; s <= seconds; s += 1) {
    rom.advance(1);
    frames.push(rom.frame());
    labels.push(`${s}s`);
  }
  fs.mkdirSync(SHEET_DIR, { recursive: true });
  const file = `${SHEET_DIR}/probe-${slug}.png`;
  await contactSheet(frames, labels, file);
  console.log(`  probe ${slug} -> ${path.relative(REPO, file)}`);
}

async function build(slug, romPath, recipe) {
  const rom = await openRom(romPath);
  rom.advance(recipe.warmup ?? 0);
  for (const press of recipe.press ?? []) {
    rom.advance(Math.max(0, (press.atSec ?? rom.at()) - rom.at()));
    rom.tap(press.button, press.holdSec);
  }
  rom.advance(recipe.settle ?? 0);

  const count = recipe.frames ?? 24;
  const fps = recipe.fps ?? 10;
  const during = recipe.during ?? [];
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    // Puzzle and turn-based games only redraw on input, so presses have to be
    // interleaved with capture rather than done up front.
    for (const press of during.filter((p) => p.atFrame === i)) {
      rom.tap(press.button, press.holdSec);
    }
    rom.advance(1 / fps);
    frames.push(rom.frame());
  }

  const distinct = new Set(frames.map(signature)).size;
  const stillIndex =
    recipe.still ??
    frames.reduce((best, buf, i) => (complexity(buf) > complexity(frames[best]) ? i : best), 0);

  fs.mkdirSync(SHEET_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await contactSheet(
    frames,
    frames.map((_, i) => (i === stillIndex ? `${i} *still` : String(i))),
    `${SHEET_DIR}/build-${slug}.png`,
  );

  const stillBytes = await writeStill(frames[stillIndex], `${OUT_DIR}/${slug}.webp`);
  let stripBytes = 0;
  if (recipe.motion) {
    stripBytes = await writeStrip(frames, `${OUT_DIR}/${slug}-loop.webp`);
  } else {
    fs.rmSync(`${OUT_DIR}/${slug}-loop.webp`, { force: true });
  }

  return { slug, distinct, count, motion: !!recipe.motion, stillBytes, stripBytes, fps };
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const source = fs.readFileSync(`${REPO}/src/catalog/games.ts`, 'utf8');
  const games = eval(source.slice(source.indexOf('['), source.lastIndexOf(']') + 1));

  if (mode === 'probe') {
    const targets = args.length ? games.filter((g) => args.includes(g.slug)) : games;
    console.log(`probing ${targets.length} game(s)`);
    for (const g of targets) await probe(g.slug, g.romPath);
    return;
  }

  const recipeFile = `${REPO}/scripts/preview-recipes.json`;
  const recipes = JSON.parse(fs.readFileSync(recipeFile, 'utf8'));
  const targets = args.length ? games.filter((g) => args.includes(g.slug)) : games;

  const results = [];
  for (const g of targets) {
    const recipe = recipes[g.slug];
    if (!recipe || recipe.skip) {
      // No usable capture — the card keeps its curated screenshot, which is a
      // legitimate outcome rather than a failure.
      fs.rmSync(`${OUT_DIR}/${g.slug}.webp`, { force: true });
      fs.rmSync(`${OUT_DIR}/${g.slug}-loop.webp`, { force: true });
      console.log(`  keep screenshot  ${g.slug}${recipe?.note ? ` — ${recipe.note}` : ''}`);
      continue;
    }
    results.push(await build(g.slug, g.romPath, recipe));
  }

  console.log('\nslug                     mode     frames  distinct   still    loop');
  for (const r of results) {
    console.log(
      `${r.slug.padEnd(24)} ${(r.motion ? 'motion' : 'still').padEnd(8)} ` +
      `${String(r.count).padStart(6)} ${String(r.distinct).padStart(9)}   ` +
      `${(r.stillBytes / 1024).toFixed(1).padStart(5)}K  ` +
      `${r.stripBytes ? (r.stripBytes / 1024).toFixed(1).padStart(5) + 'K' : '    —'}`,
    );
  }
  // Manifest the catalog imports, so the UI knows which games have a loop
  // without probing the filesystem at runtime.
  const manifest = {};
  for (const r of results.filter((x) => x.motion)) {
    manifest[r.slug] = {
      loop: `/previews/${r.slug}-loop.webp`,
      still: `/previews/${r.slug}.webp`,
      frames: r.count,
      fps: r.fps,
    };
  }
  fs.writeFileSync(
    `${REPO}/src/catalog/previews.json`,
    JSON.stringify(manifest, null, 2) + '\n',
  );

  const motion = results.filter((r) => r.motion).length;
  const bytes = results.reduce((n, r) => n + r.stillBytes + r.stripBytes, 0);
  console.log(`\n${motion}/${results.length} motion · ${(bytes / 1024).toFixed(0)}KB total`);
  console.log(`contact sheets: ${path.relative(REPO, SHEET_DIR)}`);
}

main();
