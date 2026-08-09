/**
 * Shared colours for GameBoyStudio Originals.
 *
 * Pulled from the site's own tokens (globals.css) so a native game reads as
 * part of the product rather than as a different website that happens to be
 * embedded. The LCD greens stay an accent here too — the games are mostly
 * neutral, with one colour doing the talking.
 */

export const PALETTE = {
  space: '#0b0c0b',
  grid: '#1d201d',
  hairline: '#282b28',
  text: '#e9eae7',
  muted: '#9a9e98',
  faint: '#6c706b',
  lcd: '#9bbc0f',
  lcdDim: '#8bac0f',
  lcdDeep: '#306230',
  lcdShadow: '#0f380f',
  /** Second player, and anything hostile. Warm against the LCD green. */
  amber: '#e0a33e',
  amberDeep: '#7a5416',
  danger: '#d2603c',
} as const;

/** 2x the Game Boy screen, so Originals share the library's tile proportions. */
export const ORIGINAL_RESOLUTION = { width: 320, height: 288 } as const;
