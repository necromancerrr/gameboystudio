import type { ConsoleId } from '@/emulation/core/types';

export interface Game {
  slug: string;
  title: string;
  developer: string;
  /** May be empty — Homebrew Hub metadata is sparse. UI must tolerate this. */
  description: string;
  year: number | null;
  console: ConsoleId;
  genre: string[];
  romPath: string;
  romBytes: number;
  screenshots: string[];
  /** SPDX identifier, verified against the upstream repository. See D-008. */
  license: string;
  attribution: string;
  /** Upstream repository or author page. */
  sourceUrl: string;
  homepageUrl: string;

  /** Curated position in the library. Lower sorts first. */
  rank: number;
  /** Shared name for related titles, so the grid can group rather than repeat. */
  series: string | null;
  /** Cartridge has battery-backed RAM, so progress persists. From the header. */
  hasSave: boolean;
}

export const CONSOLE_LABELS: Record<ConsoleId, string> = {
  GB: 'Game Boy',
  GBC: 'Game Boy Color',
};
