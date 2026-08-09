/**
 * Renders the library artwork for the Originals.
 *
 * These are authored key art, not captures. A native game has no ROM to run
 * headlessly the way scripts/generate-previews.mjs runs the retro catalog, and
 * a fake "screenshot" would be a worse answer than an honest illustration. The
 * compositions and colours are the games' own, so a card still tells you what
 * you are about to play.
 *
 * Run with: node scripts/generate-original-art.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = `${REPO}/public/originals`;
const W = 320;
const H = 288;

const C = {
  space: '#0b0c0b',
  grid: '#1d201d',
  hairline: '#282b28',
  text: '#e9eae7',
  faint: '#6c706b',
  lcd: '#9bbc0f',
  lcdDeep: '#306230',
  amber: '#e0a33e',
  amberDeep: '#7a5416',
  danger: '#d2603c',
};

function starfield(count, seed) {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return Array.from({ length: count }, () => {
    const size = random() < 0.15 ? 1.6 : 1;
    return `<rect x="${(random() * W).toFixed(1)}" y="${(random() * H).toFixed(1)}" width="${size}" height="${size}" fill="${C.text}" opacity="${(0.15 + random() * 0.4).toFixed(2)}"/>`;
  }).join('');
}

/** A flown arc, from the same orbital motion the game simulates. */
function orbitTrail(cx, cy, radius, from, to, steps = 40) {
  const segments = [];
  for (let i = 1; i <= steps; i += 1) {
    const t0 = from + ((to - from) * (i - 1)) / steps;
    const t1 = from + ((to - from) * i) / steps;
    const r0 = radius + Math.sin(t0 * 1.4) * 6;
    const r1 = radius + Math.sin(t1 * 1.4) * 6;
    segments.push(
      `<line x1="${(cx + Math.cos(t0) * r0).toFixed(1)}" y1="${(cy + Math.sin(t0) * r0).toFixed(1)}" x2="${(cx + Math.cos(t1) * r1).toFixed(1)}" y2="${(cy + Math.sin(t1) * r1).toFixed(1)}" stroke="${C.lcdDeep}" stroke-width="${((i / steps) * 2.5 + 0.4).toFixed(2)}" stroke-linecap="round" opacity="${((i / steps) * 0.55).toFixed(2)}"/>`,
    );
  }
  return segments.join('');
}

const DRIFT = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="starGlow">
      <stop offset="0%" stop-color="${C.amber}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${C.amber}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="coreGlow">
      <stop offset="0%" stop-color="${C.lcd}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${C.lcd}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.space}"/>
  ${starfield(70, 0x5eed)}
  <circle cx="160" cy="144" r="132" fill="none" stroke="${C.grid}" stroke-width="1"/>
  ${orbitTrail(160, 144, 104, -2.6, -0.9)}
  <circle cx="160" cy="144" r="66" fill="url(#starGlow)"/>
  <circle cx="160" cy="144" r="15" fill="${C.amber}"/>
  <circle cx="157" cy="141" r="6.5" fill="#f6d9a4"/>
  <circle cx="243" cy="196" r="22" fill="url(#coreGlow)"/>
  <circle cx="243" cy="196" r="13" fill="none" stroke="${C.lcdDeep}" stroke-width="1.5"/>
  <circle cx="243" cy="196" r="7" fill="${C.lcd}"/>
  <g transform="translate(224.6,62.5) rotate(38.4)">
    <path d="M -6 -3 L -17 0 L -6 3 Z" fill="${C.amber}"/>
    <path d="M 9 0 L -6 -5.5 L -3 0 L -6 5.5 Z" fill="${C.text}"/>
  </g>
</svg>`;

const RING_OUT = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.space}"/>
  <circle cx="160" cy="144" r="104" fill="${C.grid}"/>
  <circle cx="160" cy="144" r="104" fill="none" stroke="${C.danger}" stroke-width="2"/>
  <circle cx="160" cy="144" r="36" fill="none" stroke="${C.hairline}" stroke-width="1"/>

  <circle cx="118" cy="150" r="13" fill="${C.lcdDeep}" opacity="0.35" transform="translate(-11,0)"/>
  <circle cx="118" cy="150" r="13" fill="${C.lcd}"/>
  <circle cx="123" cy="150" r="4" fill="${C.space}"/>

  <circle cx="150" cy="146" r="13" fill="${C.amber}"/>
  <circle cx="145" cy="146" r="4" fill="${C.space}"/>

  <g fill="${C.text}">
    <rect x="133" y="140" width="2.5" height="2.5" opacity="0.9"/>
    <rect x="136" y="152" width="2.5" height="2.5" opacity="0.75"/>
    <rect x="129" y="156" width="2.5" height="2.5" opacity="0.6"/>
    <rect x="140" y="134" width="2.5" height="2.5" opacity="0.7"/>
    <rect x="127" y="133" width="2.5" height="2.5" opacity="0.5"/>
  </g>

  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" font-weight="600">
    <text x="14" y="22" fill="${C.lcd}">P1</text>
    <text x="306" y="22" fill="${C.amber}" text-anchor="end">P2</text>
  </g>
  <g>
    <circle cx="44" cy="18" r="4" fill="${C.lcd}"/>
    <circle cx="56" cy="18" r="4" fill="${C.lcd}"/>
    <circle cx="68" cy="18" r="4" fill="${C.hairline}"/>
    <circle cx="276" cy="18" r="4" fill="${C.amber}"/>
    <circle cx="264" cy="18" r="4" fill="${C.hairline}"/>
    <circle cx="252" cy="18" r="4" fill="${C.hairline}"/>
  </g>
</svg>`;

fs.mkdirSync(OUT, { recursive: true });

for (const [slug, svg] of [['drift', DRIFT], ['ring-out', RING_OUT]]) {
  const file = `${OUT}/${slug}.png`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
  const { size } = fs.statSync(file);
  console.log(`  ${slug.padEnd(10)} ${W}x${H}  ${(size / 1024).toFixed(1)}K`);
}
