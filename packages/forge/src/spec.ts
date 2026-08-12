/**
 * Turning what someone asked for into structured intent.
 *
 * This is a small, honest natural-language parser: keywords to a `GameSpec`. It
 * is not pretending to be a model, and when a model arrives it replaces exactly
 * this step (D-025) — the rest of the loop does not change.
 *
 * The interesting part is **revision**. A follow-up request is applied to the
 * previous spec rather than parsed from scratch, because "make it faster" only
 * means anything relative to a game that already exists. That is also why the
 * spec is a small bag of named knobs: a change request usually moves one of
 * them, and a structure a change can be *applied to* is worth more here than a
 * rich one that can only be regenerated.
 *
 * Where this strains is itself the research. Every request it cannot express is
 * a gap in what a declarative format would need to cover (D-023).
 */

import type { GameSpec } from './project.js';

/** The shapes the synthesizer can build. Deliberately few, and not all physics. */
export const KINDS = ['collect', 'dodge', 'memory', 'reaction', 'target'] as const;
export type Kind = (typeof KINDS)[number];

const KIND_WORDS: Record<Kind, string[]> = {
  collect: ['collect', 'gather', 'pick up', 'coins', 'score points', 'grab'],
  dodge: ['dodge', 'avoid', 'survive', 'escape', 'evade', 'falling'],
  memory: ['memory', 'remember', 'sequence', 'pattern', 'simon', 'repeat'],
  reaction: ['reaction', 'reflex', 'timing', 'quick', 'fast as you can', 'press when'],
  target: ['target', 'aim', 'shoot', 'hit the', 'whack', 'tap the'],
};

const DEFAULT_TUNING: Record<Kind, Record<string, number | string | boolean>> = {
  collect: { speed: 110, targets: 3, seconds: 45, lives: 0 },
  dodge: { speed: 130, hazards: 4, seconds: 0, lives: 3 },
  memory: { startLength: 1, flashSeconds: 0.42, gapSeconds: 0.16, lives: 1 },
  reaction: { rounds: 5, minWait: 0.8, maxWait: 2.6, lives: 1 },
  target: { speed: 0, targets: 1, seconds: 30, lives: 0 },
};

function titleFrom(request: string, kind: Kind): string {
  const quoted = request.match(/["“']([^"”']{2,40})["”']/);
  if (quoted) return quoted[1];
  const called = request.match(/\bcalled\s+([A-Za-z0-9 ]{2,30})/i);
  if (called) return called[1].trim();
  return { collect: 'Gather', dodge: 'Dodge', memory: 'Recall', reaction: 'Reflex', target: 'Mark' }[kind];
}

export function detectKind(request: string): Kind {
  const text = request.toLowerCase();
  let best: { kind: Kind; hits: number } = { kind: 'collect', hits: 0 };
  for (const kind of KINDS) {
    const hits = KIND_WORDS[kind].filter((word) => text.includes(word)).length;
    if (hits > best.hits) best = { kind, hits };
  }
  return best.kind;
}

export function specFromRequest(request: string): GameSpec {
  const text = request.toLowerCase();
  const kind = detectKind(request);
  const twoPlayer = /\b(two|2)[- ]player|versus|against a friend|each other\b/.test(text);

  return {
    kind,
    title: titleFrom(request, kind),
    players: twoPlayer ? { min: 2, max: 2 } : { min: 1, max: 1 },
    saves: true,
    genre: [{ collect: 'Action', dodge: 'Action', memory: 'Puzzle', reaction: 'Toy', target: 'Toy' }[kind]],
    tuning: { ...DEFAULT_TUNING[kind] },
  };
}

/**
 * What "faster" means, per kind.
 *
 * There is no universal speed knob, and discovering that is the point: in a
 * chase game faster is a bigger number, in a memory game it is a *smaller*
 * one (shorter flashes), and in a reaction game it is a shorter wait. A
 * declarative format will have to carry this per-genre meaning too, or every
 * game will need its own vocabulary for the same english word.
 */
const SPEED_KNOBS: Record<Kind, { key: string; fasterIs: 'higher' | 'lower' }[]> = {
  collect: [{ key: 'speed', fasterIs: 'higher' }],
  dodge: [{ key: 'speed', fasterIs: 'higher' }],
  target: [{ key: 'seconds', fasterIs: 'lower' }],
  memory: [
    { key: 'flashSeconds', fasterIs: 'lower' },
    { key: 'gapSeconds', fasterIs: 'lower' },
  ],
  reaction: [
    { key: 'minWait', fasterIs: 'lower' },
    { key: 'maxWait', fasterIs: 'lower' },
  ],
};

export interface AppliedChange {
  spec: GameSpec;
  /** What the request was understood to mean, for the record and for the person. */
  applied: string[];
  /** Parts of the request nothing was done about. The interesting output. */
  ignored: string[];
}

const NUMBER = /(-?\d+(?:\.\d+)?)/;

/**
 * Applies a change request to an existing spec.
 *
 * Returns what it did *and what it could not do*. The second list is the point:
 * an unhandled request is not a failure to hide, it is the record of what the
 * spec cannot yet express, which is exactly the evidence a schema needs.
 */
export function applyChange(previous: GameSpec, request: string): AppliedChange {
  const spec: GameSpec = {
    ...previous,
    players: { ...previous.players },
    genre: [...previous.genre],
    tuning: { ...previous.tuning },
  };
  const applied: string[] = [];
  const text = request.toLowerCase();

  const scale = (key: string, factor: number, label: string) => {
    const value = spec.tuning[key];
    if (typeof value !== 'number') return false;
    spec.tuning[key] = Math.round(value * factor * 100) / 100;
    applied.push(`${label} (${key} ${value} -> ${spec.tuning[key]})`);
    return true;
  };

  const setNumber = (key: string, value: number, label: string) => {
    spec.tuning[key] = value;
    applied.push(`${label} (${key} = ${value})`);
  };

  let touched = false;

  const changeSpeed = (faster: boolean): boolean => {
    let moved = false;
    for (const knob of SPEED_KNOBS[spec.kind as Kind] ?? []) {
      const quicker = knob.fasterIs === 'higher' ? 1.35 : 0.72;
      const slower = knob.fasterIs === 'higher' ? 0.72 : 1.35;
      moved = scale(knob.key, faster ? quicker : slower, faster ? 'faster' : 'slower') || moved;
    }
    return moved;
  };

  if (/\b(faster|speed up|quicker|harder)\b/.test(text)) touched = changeSpeed(true) || touched;
  if (/\b(slower|slow down|easier)\b/.test(text)) touched = changeSpeed(false) || touched;

  const lives = text.match(new RegExp(`${NUMBER.source}\\s*(?:lives|life|hearts)`));
  if (lives) {
    setNumber('lives', Number(lives[1]), 'lives');
    touched = true;
  } else if (/\bmore lives\b/.test(text)) {
    touched = scale('lives', 2, 'more lives') || touched;
  }

  const seconds = text.match(new RegExp(`${NUMBER.source}\\s*(?:seconds|second|s)\\b`));
  if (seconds) {
    setNumber('seconds', Number(seconds[1]), 'time limit');
    touched = true;
  }

  const count = text.match(new RegExp(`${NUMBER.source}\\s*(?:targets|hazards|obstacles|enemies|coins)`));
  if (count) {
    const key = /hazard|obstacle|enemies/.test(text) ? 'hazards' : 'targets';
    setNumber(key, Number(count[1]), 'count');
    touched = true;
  } else if (/\bmore (targets|coins|hazards|obstacles|enemies)\b/.test(text)) {
    touched =
      scale(/hazard|obstacle|enem/.test(text) ? 'hazards' : 'targets', 2, 'more of them') || touched;
  }

  if (/\b(two|2)[- ]player|versus|against a friend|add a (second|2nd) player\b/.test(text)) {
    spec.players = { min: 2, max: 2 };
    applied.push('two players');
    touched = true;
  }
  if (/\b(one|1)[- ]player|solo|single player\b/.test(text)) {
    spec.players = { min: 1, max: 1 };
    applied.push('one player');
    touched = true;
  }

  const renamed = request.match(/\b(?:call it|rename it to|name it)\s+["“']?([A-Za-z0-9 ]{2,30})["”']?/i);
  if (renamed) {
    spec.title = renamed[1].trim();
    applied.push(`renamed to ${spec.title}`);
    touched = true;
  }

  if (/\bno save|stop saving|forget (my|the) (score|best)\b/.test(text)) {
    spec.saves = false;
    applied.push('saves off');
    touched = true;
  }

  return {
    spec,
    applied,
    ignored: touched ? [] : [request],
  };
}
