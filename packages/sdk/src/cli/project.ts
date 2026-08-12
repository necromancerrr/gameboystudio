/**
 * Reading a game project from disk.
 *
 * A project is a directory with a `gbs.game.json` describing the game and an
 * entry point. The description is the same shape the hosted manifest carries,
 * because a creator declaring their game twice — once for themselves and once
 * for the platform — is two chances to disagree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { FRAME_PROTOCOL_VERSION, GBS_BUTTONS } from '../protocol.js';

export interface GameProject {
  dir: string;
  slug: string;
  title: string;
  developer: string;
  description: string;
  entry: string;
  players: { min: number; max: number };
  inputs: { required: string[]; supported: string[] };
  saves: boolean;
  genre: string[];
  license: string;
  attribution: string;
  sourceUrl: string;
  version: string;
  /** The protocol this game was built against, recorded for D-021. */
  protocol: number;
}

const PROFILES = ['gamepad', 'keyboard', 'touch'];

function fail(message: string): never {
  throw new Error(message);
}

export function readProject(dir: string): GameProject {
  const root = path.resolve(dir);
  const file = path.join(root, 'gbs.game.json');
  if (!fs.existsSync(file)) {
    fail(`No gbs.game.json in ${root}. Run \`gbs create\` to start one.`);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    fail(`gbs.game.json is not valid JSON: ${(error as Error).message}`);
  }

  const str = (key: string, required = true): string => {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (required) fail(`gbs.game.json needs a "${key}".`);
    return '';
  };

  const players = raw.players as { min?: unknown; max?: unknown } | undefined;
  if (!players || typeof players.min !== 'number' || typeof players.max !== 'number') {
    fail('gbs.game.json needs "players": { "min": n, "max": n }.');
  }
  if (players.min < 1 || players.max < players.min) {
    fail(`"players" is not a range: min ${players.min}, max ${players.max}.`);
  }

  const inputs = raw.inputs as { required?: unknown; supported?: unknown } | undefined;
  const profiles = (value: unknown, key: string): string[] => {
    if (!Array.isArray(value)) fail(`gbs.game.json needs "inputs.${key}" as a list.`);
    for (const item of value) {
      if (typeof item !== 'string' || !PROFILES.includes(item)) {
        fail(`"inputs.${key}" has an unknown profile: ${String(item)}. Known: ${PROFILES.join(', ')}.`);
      }
    }
    return value as string[];
  };
  const required = profiles(inputs?.required ?? [], 'required');
  const supported = profiles(inputs?.supported, 'supported');
  if (supported.length === 0) fail('"inputs.supported" cannot be empty.');
  for (const profile of required) {
    if (!supported.includes(profile)) {
      fail(`"inputs.required" lists ${profile}, which "inputs.supported" does not.`);
    }
  }

  if (typeof raw.saves !== 'boolean') fail('gbs.game.json needs "saves": true or false.');

  const entry = str('entry');
  if (!fs.existsSync(path.join(root, entry))) {
    fail(`"entry" points at ${entry}, which does not exist.`);
  }

  const version = str('version');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    // The version is a path segment on the hosted origin, and immutability
    // depends on it changing when the game does (D-019).
    fail(`"version" must look like 1.0.0, not ${version}.`);
  }

  return {
    dir: root,
    slug: str('slug'),
    title: str('title'),
    developer: str('developer'),
    description: str('description', false),
    entry,
    players: { min: players.min, max: players.max },
    inputs: { required, supported },
    saves: raw.saves,
    genre: Array.isArray(raw.genre) ? (raw.genre as string[]) : [],
    license: str('license'),
    attribution: str('attribution', false),
    sourceUrl: str('sourceUrl', false),
    version,
    protocol: typeof raw.protocol === 'number' ? raw.protocol : FRAME_PROTOCOL_VERSION,
  };
}

/** The manifest entry a published game would get, for validation and publishing. */
export function manifestEntry(project: GameProject, origin: string) {
  return {
    slug: project.slug,
    title: project.title,
    developer: project.developer,
    description: project.description,
    year: new Date().getFullYear(),
    players: project.players,
    inputs: project.inputs,
    saves: project.saves,
    genre: project.genre,
    screenshots: [],
    license: project.license,
    attribution: project.attribution,
    sourceUrl: project.sourceUrl,
    frameUrl: `${origin.replace(/\/$/, '')}/games/${project.slug}/${project.version}/frame.html`,
  };
}

export { GBS_BUTTONS };
