/**
 * Where the model goes.
 *
 * D-025 built this boundary and left the model unchosen. D-028 chose it, and
 * the promise held: swapping a real model in changed only what is behind this
 * interface. The loop, the project model, the conformance gate and the pointer
 * rule are all untouched.
 *
 * Two implementations remain, and both are real. The synthesizer composes games
 * from a spec of named knobs — it costs nothing, needs no network, and is what
 * the tests run against, so the suite never depends on a paid service. The
 * model writes the source itself, which is what lets someone ask for a game in
 * their own words rather than in the five shapes a spec can express.
 */

import type { GameSpec } from './project.js';
import { applyChange, specFromRequest } from './spec.js';
import { synthesize } from './synthesize.js';
import { ModelGenerator } from './model.js';

export { ModelGenerator } from './model.js';
export { MODEL } from './model.js';

export interface Proposal {
  spec: GameSpec;
  source: string;
  /** What the request was understood to mean, and what it was not. */
  applied: string[];
  ignored: string[];
  /**
   * What the call cost, when a generator makes calls. Absent for the
   * synthesizer, which makes none.
   */
  usage?: ModelUsage;
}

/** Per-call token counts, as reported by the provider. */
export interface ModelUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
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

export function generatorNamed(name: string): GameGenerator {
  if (name === 'synthesizer') return new Synthesizer();
  if (name === 'model') return new ModelGenerator();
  throw new Error(`Unknown generator "${name}". Known: synthesizer, model.`);
}

/**
 * What to use when the caller has not said.
 *
 * The model when credentials exist, the synthesizer otherwise. Falling back
 * rather than failing is deliberate: a machine with no key can still run the
 * whole loop end to end, which is what keeps the test suite honest and free.
 * `GBS_GENERATOR` overrides it either way, so a real key never forces a paid
 * call during a test run.
 */
export function defaultGenerator(): GameGenerator {
  const named = process.env.GBS_GENERATOR;
  if (named) return generatorNamed(named);
  const configured =
    Boolean(process.env.ANTHROPIC_API_KEY) || Boolean(process.env.ANTHROPIC_AUTH_TOKEN);
  return configured ? new ModelGenerator() : new Synthesizer();
}
