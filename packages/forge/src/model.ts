/**
 * The model-backed generator: a request in free text becomes a real game.
 *
 * M7 built the loop around a synthesizer that composed games from a spec of
 * named knobs. That proved the loop and found its ceiling: the spec could only
 * express five kinds of game, and every request outside them was recorded as
 * "not understood". This replaces exactly that step (D-025) — the model writes
 * the game's source directly against the SDK, and everything downstream is
 * unchanged. Conformance still gates it, the pointer still moves only on
 * success, and a failed change still leaves the previous version playable.
 *
 * Two things shape the implementation:
 *
 * **The output is structured, not parsed.** Asking for a fenced code block and
 * extracting it means a malformed reply becomes a mysterious build failure. The
 * response is constrained to a schema instead, so the shape is guaranteed and
 * only the *content* can be wrong — which is what conformance is for.
 *
 * **The guide is the cached prefix.** The SDK contract is long and identical on
 * every request, so it sits in the system prompt behind a cache breakpoint with
 * nothing per-request above it (D-028). A revision or a repair adds its context
 * as messages, below the breakpoint, so the guide is written once and read
 * thereafter.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { GameSpec } from './project.js';
import type { GameGenerator, Proposal, RepairContext } from './generator.js';
import { SDK_GUIDE } from './sdkGuide.js';

/**
 * Chosen for capability on the one job that matters here — writing a complete,
 * correct TypeScript program in a single pass against an unfamiliar API. Cost
 * is deliberately not the criterion yet (D-028).
 */
export const MODEL = 'claude-opus-5';

/**
 * A whole game is a long single output. Generous enough that a substantial game
 * is never cut off mid-file, which would surface as a syntax error and send a
 * perfectly good attempt into the repair loop for no reason.
 */
const MAX_TOKENS = 32_000;

/** Coding work. The documented setting for it, and the loop can afford it. */
const EFFORT = 'xhigh';

/**
 * The shape of a reply. Constrained rather than requested, so the only thing
 * that can be wrong is the game itself.
 */
const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Two or three words. The name a player sees. No punctuation or quotes.',
    },
    genre: {
      type: 'string',
      description: 'One word, e.g. Action, Puzzle, Toy, Arcade.',
    },
    players: {
      type: 'integer',
      enum: [1, 2],
      description: 'Seats needed at once. 2 only when the request asks for two people playing.',
    },
    saves: {
      type: 'boolean',
      description: 'True only if the source implements serialize and restore.',
    },
    applied: {
      type: 'array',
      items: { type: 'string' },
      description:
        "What you built, in the player's language, one short phrase each. No jargon, no file names.",
    },
    ignored: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Anything asked for that you could NOT do, and why, in one short phrase each. ' +
        'Empty when you did everything. Never claim something you did not build.',
    },
    source: {
      type: 'string',
      description: 'The complete TypeScript module. No markdown fences, no commentary.',
    },
  },
  required: ['title', 'genre', 'players', 'saves', 'applied', 'ignored', 'source'],
  additionalProperties: false,
} as const;

interface ModelProposal {
  title: string;
  genre: string;
  players: 1 | 2;
  saves: boolean;
  applied: string[];
  ignored: string[];
  source: string;
}

/**
 * Said once, at the top, and never varied — see the caching note in the file
 * header. Everything specific to a request goes in the messages.
 */
const SYSTEM = `${SDK_GUIDE}

# How to answer

Return the complete module in \`source\`. It must be the whole file: imports,
the game definition, and the \`runHostedGame\` call. Nothing else — no markdown
fences, no explanation, no "// ... rest of file".

Be honest in \`applied\` and \`ignored\`. \`ignored\` is how the person finds out
what they did not get, and an empty \`ignored\` on a game that dropped half the
request is worse than no answer at all.`;

/** What a failed conformance run looks like when handed back for repair. */
function repairBrief(context: RepairContext): string {
  const details = context.details
    .map((check) => `- ${check.name}${check.detail ? `: ${check.detail}` : ''}`)
    .join('\n');

  return `This game was rejected. Fix it.

${details || context.failed.map((failure) => `- ${failure}`).join('\n')}

Read the errors literally — they come from the TypeScript compiler, the bundler
and the platform's conformance checks, not from a person. Change what they
point at, and change nothing else: this is a repair, not a redesign.

Here is the source that failed:

\`\`\`ts
${context.source}
\`\`\``;
}

/** Something a person can act on, from an error that was written for a machine. */
function explain(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'The game service is not configured — no valid API credentials.';
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'The game service rejected these credentials.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Too many games are being made right now. Try again in a moment.';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the game service. Check the connection and try again.';
  }
  // The base class for every non-2xx response, checked last so the specific
  // cases above win.
  if (error instanceof Anthropic.APIError) {
    return `The game service had a problem (${error.status ?? 'no status'}). Try again in a moment.`;
  }
  return error instanceof Error ? error.message : String(error);
}

export class ModelGenerator implements GameGenerator {
  readonly name = 'model';
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    // The zero-argument constructor resolves credentials the way every other
    // Anthropic client does — env var, auth token, or a configured profile —
    // so there is nothing here to keep in sync with how the machine is set up.
    this.client = client ?? new Anthropic();
  }

  async propose(
    request: string,
    previous?: { spec: GameSpec; source: string },
  ): Promise<Proposal> {
    const messages: Anthropic.MessageParam[] = previous
      ? [
          {
            role: 'user',
            content: `Here is a game that exists and works. Someone is playing it right now.

\`\`\`ts
${previous.source}
\`\`\`

They have asked for this change:

"${request}"

Return the complete modified module. Change what they asked for and keep
everything else exactly as it is — they like the game they have, they want one
thing different about it. If part of the request cannot be done, do the rest and
say what you could not do in \`ignored\`.`,
          },
        ]
      : [
          {
            role: 'user',
            content: `Someone asked for this game:

"${request}"

Build it. Make the specific thing they asked for, not a generic game in the same
neighbourhood — the details in their words are the point.`,
          },
        ];

    const proposal = await this.ask(messages);

    return {
      spec: {
        // The generator no longer picks from a fixed set of kinds. The kind is
        // kept as a label for the record; nothing downstream branches on it,
        // because there is no longer a synthesizer to switch over.
        kind: previous?.spec.kind ?? 'model',
        title: proposal.title,
        players: { min: proposal.players, max: proposal.players },
        saves: proposal.saves,
        genre: [proposal.genre],
        tuning: {},
      },
      source: proposal.source,
      applied: proposal.applied,
      ignored: proposal.ignored,
    };
  }

  async repair(context: RepairContext): Promise<Proposal | null> {
    const proposal = await this.ask([{ role: 'user', content: repairBrief(context) }]);
    return {
      // The spec is the one that was already agreed. A repair fixes the code;
      // it must not quietly rename the game or change what it declares, because
      // the manifest was written from the spec before the check ran.
      spec: context.spec,
      source: proposal.source,
      applied: proposal.applied,
      ignored: proposal.ignored,
    };
  }

  private async ask(messages: Anthropic.MessageParam[]): Promise<ModelProposal> {
    let message: Anthropic.Message;
    try {
      // Streamed because a whole game is a large output and a non-streaming
      // request of this size risks an HTTP timeout. Nothing consumes the
      // tokens as they arrive — the result is only useful complete.
      const stream = this.client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive' },
        output_config: {
          effort: EFFORT,
          format: { type: 'json_schema', schema: PROPOSAL_SCHEMA },
        },
        messages,
      });
      message = await stream.finalMessage();
    } catch (error) {
      throw new Error(explain(error));
    }

    if (message.stop_reason === 'refusal') {
      throw new Error('The game service declined to build that. Try describing it differently.');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new Error('That game came out too large to finish. Try asking for something smaller.');
    }

    const text = message.content.find((block) => block.type === 'text');
    if (!text) throw new Error('The game service returned nothing to build.');

    // Structured outputs guarantee the shape, so a parse failure here is a
    // real fault rather than a formatting slip — say so plainly.
    try {
      return JSON.parse(text.text) as ModelProposal;
    } catch {
      throw new Error('The game service returned something unreadable.');
    }
  }
}
