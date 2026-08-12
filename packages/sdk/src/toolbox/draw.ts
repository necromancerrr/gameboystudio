/**
 * Drawing, at the resolution the platform's games actually use.
 *
 * All three games drew rectangles and centred text at a fixed 320x288, and all
 * three set `textAlign` and forgot to set it back at least once — Sequence has
 * an explicit `g.textAlign = 'left'` at the end of its render for exactly that
 * reason. Centring text and drawing a panel are the two things every one of
 * them wrote by hand.
 *
 * The palette comes from the site's own tokens, so a game reads as part of the
 * product rather than as a different website that happens to be embedded. It is
 * the same set the Originals share.
 */

/** Twice the Game Boy screen, which is what every Original uses. */
export const RESOLUTION = { width: 320, height: 288 } as const;

export const PALETTE = {
  bg: '#0b0c0b',
  panel: '#1d201d',
  edge: '#282b28',
  text: '#e9eae7',
  muted: '#9a9e98',
  faint: '#6c706b',
  lcd: '#9bbc0f',
  lcdDim: '#8bac0f',
  lcdDeep: '#306230',
  /** Second player, and anything hostile. Warm against the LCD green. */
  amber: '#e0a33e',
  amberDeep: '#7a5416',
  danger: '#d2603c',
} as const;

export type PaletteColor = keyof typeof PALETTE;

/** Resolves a palette name or passes a literal colour straight through. */
export function color(value: PaletteColor | string): string {
  return (PALETTE as Record<string, string>)[value] ?? value;
}

export function clear(g: CanvasRenderingContext2D, fill: PaletteColor | string = 'bg'): void {
  g.fillStyle = color(fill);
  g.fillRect(0, 0, RESOLUTION.width, RESOLUTION.height);
}

export function rect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: PaletteColor | string,
): void {
  g.fillStyle = color(fill);
  g.fillRect(x, y, width, height);
}

/** A filled panel with a hairline, which is how every Original draws a tile. */
export function panel(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: PaletteColor | string = 'panel',
  edge: PaletteColor | string = 'edge',
): void {
  rect(g, x, y, width, height, fill);
  g.strokeStyle = color(edge);
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
}

export function circle(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: PaletteColor | string,
): void {
  g.fillStyle = color(fill);
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.fill();
}

export interface TextOptions {
  size?: number;
  fill?: PaletteColor | string;
  align?: CanvasTextAlign;
}

/**
 * Draws text and puts `textAlign` back.
 *
 * Leaving it changed is the bug all three games hit: some later draw call
 * inherits the alignment and lands somewhere unrelated, usually only in one
 * phase, which makes it look intermittent.
 */
export function text(
  g: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  { size = 12, fill = 'text', align = 'left' }: TextOptions = {},
): void {
  const previous = g.textAlign;
  g.fillStyle = color(fill);
  g.font = `${size}px ui-monospace, monospace`;
  g.textAlign = align;
  g.fillText(value, x, y);
  g.textAlign = previous;
}

/** Centred horizontally on the screen, which is where HUD lines always go. */
export function centered(
  g: CanvasRenderingContext2D,
  value: string,
  y: number,
  options: TextOptions = {},
): void {
  text(g, value, RESOLUTION.width / 2, y, { ...options, align: 'center' });
}
