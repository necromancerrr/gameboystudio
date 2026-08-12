/**
 * Where a model would go.
 *
 * D-025: the boundary is built, the model is not chosen. Two implementations —
 * a synthesizer that costs nothing, and a model-backed one that is deliberately
 * absent. Swapping in a model must change only this file's implementations, and
 * that is a verification item rather than an intention.
 */

import type { GameSpec } from './project.js';
import { applyChange, specFromRequest } from './spec.js';
import { synthesize } from './synthesize.js';

export interface Proposal {
  spec: GameSpec;
  source: string;
  /** What the request was understood to mean, and what it was not. */
  applied: string[];
  ignored: string[];
}

export interface RepairContext {
  spec: GameSpec;
  source: string;
  /** The checks that failed, verbatim from `gbs check --json`. */
  failed: string[];
  details: { name: string; detail?: string }[];
}

export interface GameGenerator {
  readonly name: string;
  /** A first request, or a change to an existing game. */
  propose(request: string, previous?: { spec: GameSpec; source: string }): Promise<Proposal>;
  /** A second attempt after conformance refused the first. */
  repair(context: RepairContext): Promise<Proposal | null>;
}

/**
 * The no-model generator.
 *
 * Not a stub: it composes source from the spec, so the pipeline is genuinely
 * exercised. A stub returning canned files would have made the whole proof
 * hollow, because the pipeline would never have run.
 */
export class Synthesizer implements GameGenerator {
  readonly name = 'synthesizer';

  async propose(
    request: string,
    previous?: { spec: GameSpec; source: string },
  ): Promise<Proposal> {
    if (!previous) {
      const spec = specFromRequest(request);
      return { spec, source: synthesize(spec), applied: [`new ${spec.kind} game`], ignored: [] };
    }
    // A change is applied to the previous spec rather than parsed fresh:
    // "make it faster" only means anything relative to a game that exists.
    const { spec, applied, ignored } = applyChange(previous.spec, request);
    return { spec, source: synthesize(spec), applied, ignored };
  }

  /**
   * The synthesizer only emits shapes it knows are conformant, so a failure
   * here means something outside its control — a broken toolbox, a bad
   * environment. Repairing by guessing would hide that, so it declines.
   */
  async repair(): Promise<Proposal | null> {
    return null;
  }
}

/**
 * The model-backed generator.
 *
 * Deliberately not implemented in M7. Provider, cost ceiling and where
 * inference runs are decisions to be made on their own merits, not as a side
 * effect of building the loop.
 */
export class ModelGenerator implements GameGenerator {
  readonly name = 'model';

  async propose(): Promise<Proposal> {
    throw new Error(
      'No model provider has been chosen yet (D-025). Use the synthesizer, or pick one first.',
    );
  }

  async repair(): Promise<Proposal | null> {
    throw new Error('No model provider has been chosen yet (D-025).');
  }
}

export function generatorNamed(name: string): GameGenerator {
  if (name === 'synthesizer') return new Synthesizer();
  if (name === 'model') return new ModelGenerator();
  throw new Error(`Unknown generator "${name}". Known: synthesizer, model.`);
}
