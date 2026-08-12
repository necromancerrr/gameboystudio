# M7_FINDING.md — what generating games taught us about the format

Secondary research from M7. The primary proof was the loop; this is what fell
out of running it, and it is the evidence D-018 has been waiting on since M3.

**Short answer: the declarative format is still not earned, but for a different
and much more useful reason than before.**

## What was run

Five games, five kinds, generated from a request with no hand editing:

| Request | Kind | Result |
| --- | --- | --- |
| "a memory game where you repeat a pattern" | memory | 17/17 checks |
| "dodge the falling rocks before they hit you" | dodge | 17/17 |
| "a reaction test, press when it turns green" | reaction | 17/17 |
| "collect the coins before time runs out" | collect | 17/17 |
| "hit the targets with a crosshair" | target | 17/17 |

All five conform. Two of the five — reaction and memory — are turn-taking rather
than continuous, which is the shape the corpus lacked entirely before Sequence.

## Finding 1: the toolbox absorbed everything it was built for

No generated game reimplemented a phase machine, an elapsed-time accumulator,
centred text, a versioned save, or randomness. That is the toolbox doing its
job, and it means the five primitives D-023 admitted were the right five.

It also means those five are **not** what a format needs to decide. They are
plumbing, and plumbing is exactly what a library should absorb.

## Finding 2: "faster" is not a property of games, it is a property of genres

The first revision request in M7 was "make it faster" against a memory game. It
did nothing, because the spec's speed knob was `speed`, and a memory game has
no such thing.

The fix was not a bigger `speed` field. It was a per-kind mapping:

| Kind | "faster" means |
| --- | --- |
| collect, dodge | `speed` **up** |
| memory | `flashSeconds`, `gapSeconds` **down** |
| reaction | `minWait`, `maxWait` **down** |
| target | `seconds` **down** |

In three of five kinds, faster is a *smaller* number. A format with a `speed`
field would be wrong for most of its own games, and a format without one cannot
answer the most common thing a person asks for.

**This is the single most useful thing M7 learned.** A schema needs a layer of
*intent* — "harder", "faster", "longer" — that each genre resolves into its own
parameters. Intent is not a field; it is a mapping, and it is per-genre.

## Finding 3: what the spec could not express

Change requests were run against a working game and recorded:

| Request | Expressible |
| --- | --- |
| "make it faster" | yes |
| "give me 5 lives" | yes |
| "call it Echo" | yes |
| "add a second player" | yes |
| "make the panels blue" | **no** — no appearance vocabulary |
| "add a boss at round 10" | **no** — no notion of an entity, or of an event at a time |
| "let two people play over the internet" | **no** — players are a count, not a topology |
| "add sound when I get it right" | **no** — no audio vocabulary, and no notion of "when X happens" |
| "make it scroll sideways" | **no** — no camera or world larger than the screen |

Five of nine failed, and they fail in four distinct directions: **appearance**,
**entities and events**, **audio**, and **space**. Those are the four things a
declarative format would have to introduce, and none of them are guessable from
the three hand-written games — Drift, Ring Out and Sequence each solved all four
privately, in code, in ways that share nothing.

## Finding 4: the shape of a request maps badly onto a shape of a game

The synthesizer has one template per kind. It works, and it is also the limit:
"a memory game where the panels chase you" has no home. Every genuinely new
request needs a new template, which is the same problem as needing a new game.

A format would have to decompose a game into parts that recombine — and *what
those parts are* is precisely what five templates cannot tell us, because each
template is a whole game rather than a set of pieces.

**More kinds will not fix this.** A sixth template teaches as little as the
fifth. What would teach something is a generator that composes from pieces
rather than filling in a template, and that is a model's job — which is why
M7 stopped at the boundary rather than guessing past it.

## What this means for the format decision

D-018 asked for more games and more genres. M7 supplied five games across five
kinds, and the answer is still **not yet** — but the reason has changed.

Before: *we do not have enough games to know what a format should contain.*

Now: *we know four things it must contain — appearance, entities and events,
audio, space — and one thing nobody expected, that intent is a per-genre mapping
rather than a set of fields. What is still missing is evidence about how a game
decomposes into recombinable parts, and a template-based synthesizer
structurally cannot provide it.*

That is a sharper question than the one M7 started with, and it names exactly
what the next milestone would need to produce.

## Cost

Zero. The synthesizer needs no model and no provider (D-025). Everything in this
document was produced by code that ships in this repository.
