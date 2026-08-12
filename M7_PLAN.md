# M7_PLAN.md — "Ask for a game, play it, ask again"

Proposed direction for milestone 7. Strategy lives in PLATFORM_DIRECTION.md;
ratified decisions live in DECISIONS.md.

**M7 = The generative loop: prompt → playable GameBoyStudio game → change it →
play again.**

## Goal

> **A game request becomes a playable GameBoyStudio game with no manual code
> editing, and a follow-up request modifies that same game and returns it to
> play quickly.**

Validation question:

**Can someone describe a game, play it, ask for a change, and play the change —
without anyone touching code?**

## The loop

```
PROMPT  →  GENERATE  →  CHECK / REPAIR  →  PLAY  →  REQUEST CHANGE  →  PLAY AGAIN
                             ↑                              │
                             └──────────────────────────────┘
```

The second half of that loop is the part that shapes the architecture.
Generating once is stateless and easy. Modifying *the same game* requires the
game to be a durable thing with a history — a spec, its source, and the record
of what has been asked of it — and it requires the round trip to be fast enough
that a person keeps asking.

## What this is not

Not an internal research experiment that emits five games and a report. An
earlier draft of this milestone proposed exactly that, and it was too small a
claim: it would have proved that a generator can satisfy `gbs check`, not that a
person can get a game they asked for.

The five-game, multi-genre run stays, **demoted to secondary research**. Its job
is to learn what primitives the eventual GameBoyStudio game system needs — see
"What the corpus is for" below.

## Why generating *into* GameBoyStudio beats generating a website

This is the whole product argument, and it is already true rather than
aspirational. A generated game is a hosted game, so it inherits, for free:

- the sandbox and its isolation (D-018)
- keyboard, gamepad and the touch deck through `InputRouter`
- **phone controllers and rooms** from M4
- saves persisted by the host (D-015)
- pause, reset, mute, fullscreen, the boot moment
- versioned immutable artifacts and rollback by repointing the manifest (D-019)
- Gamepad Native by construction

None of that has to be generated, prompted for, or gotten right by a model. A
generated *website* would have to invent all of it and would get most of it
wrong. This is why the constraint "generate inside our game system" is a product
advantage and not a limitation.

## The toolbox, and why it is not the format

The instruction is to generate **within a GameBoyStudio-defined game system**,
increasingly over time. But D-018 deferred the declarative format on evidence
grounds, and that has not changed: three authored games is still too few.

The way through is a **toolbox**, not a format:

- A **format** is declarative data that a runtime interprets. It constrains what
  a game *can be*. Designing one now would be guessing.
- A **toolbox** is a library of GameBoyStudio primitives a game *may call*. It
  constrains nothing, but it means a generator composes known parts instead of
  reinventing them.

The toolbox is derived, not invented. Only primitives that the existing games
independently reimplemented qualify. From Drift, Ring Out and Sequence:

| Primitive | Games that built their own |
| --- | --- |
| Phase/state machine with a timer (`phase`, `phaseFor`) | 3 / 3 |
| Elapsed-time accumulation from `dt` | 3 / 3 |
| Text and rectangle drawing at fixed resolution | 3 / 3 |
| Versioned `serialize`/`restore` for a best score | 3 / 3 |
| Randomness | 3 / 3 |
| Round/reset lifecycle | 2 / 3 |

Every one of those was written three times, slightly differently. That is the
evidence a toolbox is earned — and it is exactly the evidence a *format* is not
yet, because nothing above says anything about what a game **is**, only about
what games repeatedly need.

**The toolbox is also how the format gets earned.** What generated games reach
for, and what they reinvent despite the toolbox offering it, is the empirical
input a schema should be designed from.

## What M7 builds

### 1. The toolbox — `@gameboystudio/sdk/toolbox`

The primitives above, derived from real use. Shipped in the SDK, so creators get
them too: this is the game system, not an internal helper.

### 2. A game project, and its versions

Iterative modification depends entirely on this, so it is written down rather
than left to emerge. A generated game is a **project** with an ordered history:

```
project
  id                     stable, and the seed of shareability later
  currentRevision        the one that is playable now
  revisions[]            ordered, append-only
    n                    revision number
    parent               the revision this one was asked to change
    request              what was asked for, in the person's words
    spec                 the structured intent that request produced
    source               the snapshot this revision was built from
    artifactVersion      the immutable version id its build landed under
    conformance          the recorded verdict, not just pass/fail
    status               generating | checking | repairing | ready | failed
```

Two rules make it work:

**A revision is only ever added, never edited.** Every attempt keeps its own
source snapshot and its own verdict, so a failed one is a record rather than a
loss.

**`currentRevision` moves only when a new revision reaches `ready`.** While a
follow-up is generating, checking or repairing, the previous version stays
playable — and if the new one fails, it stays playable permanently. This is the
same immutable-artifact-plus-repointer shape M5 already uses (D-019), applied to
iteration instead of publishing: a new version is built beside the old one, and
a pointer moves at the end.

Persistence is **local and project-scoped** — a directory on disk. No accounts,
no cloud, no database.

### 3. The generator behind an adapter

One interface, two implementations:

- a **synthesizer** that composes a game from a spec using the toolbox, with no
  model and no cost
- a model-backed one, **not chosen or used in M7**

The synthesizer is not a stub. It genuinely turns a request into a game, which
means the pipeline is provable end to end for free — and building it is itself
research, because a rule-based composer over the toolbox is a proto-schema, and
where it strains is where the format will strain.

### 4. Check and repair

`gbs check --json` gives the loop a machine-readable verdict with per-check
reasons. Failures feed back into the next attempt rather than reaching a person.

Speed matters here, so the gate is staged: a fast build-and-smoke path for
iteration, and the full Chrome conformance run before anything is published.

### 5. Play

The preview host from M6 is where the result lands, launched automatically.
`forge new "..."` ends with a game on screen; `forge revise ...` ends with the
changed game on screen.

## Pointing at the future without building it

| Eventually | What M7 does now |
| --- | --- |
| User-facing generation | The loop is a library with a CLI over it, not a CLI with logic inside it, so a UI can drive the same calls |
| Shareable generated games | Every revision is already a versioned artifact with a manifest entry — the M5 publishing shape, unchanged |
| A feed of generated games | Sessions have stable ids and slugs; nothing else is needed to list them later |
| The declarative format | The toolbox and the synthesizer are the evidence it is waiting on |

None of those are built. The point is that none of them require undoing this.

## What the corpus is for

Five games across at least three genres — deliberately not more physics — run
through the loop. Recorded for each: what the generator got first time, what
needed repair, what it never managed, and which toolbox primitives it used
versus reinvented.

The deliverable is a written finding: **what a GameBoyStudio game schema would
need to contain**, argued from what generation actually strained against.

This is secondary to the loop, and it is not a reason to ship anything.

## Stages

**S1 — The toolbox.** Derived from the three existing games; each primitive
justified by prior duplication, not by anticipation. Existing games are *not*
rewritten onto it — that would be M1–M6 churn for no gain.

**S2 — `gbs check --json`.** Structured verdict, consumed by the loop.

**S3 — Projects and revisions.** The model above, persisted locally: append-only
revisions, per-revision source and verdict, and a current pointer that only
advances on success.

**S4 — The loop.** `forge new` and `forge revise`, with the synthesizer.
Check-and-repair, then straight into the preview host.

**S5 — The model boundary.** The adapter, with the model-backed implementation
left unselected and unused. M7 stops here deliberately.

**S6 — The corpus run and the finding.** Five games, three genres, and the
written argument about the schema.

**S7 — Verification.** Per D-012: the loop must reject non-conforming output
rather than pass it through, a deliberately broken generator must fail, a
revision must be shown to change the game it was aimed at and not another one,
and nothing may auto-publish.

## Explicit non-goals

A consumer feed · a publishing system or submission path · accounts · moderation
· a polished prompt UI · choosing or calling a paid model · the declarative
format · asset or audio generation · auto-publishing to the library · rewriting
the existing games onto the toolbox · changes to the runtimes, the frame
protocol, or the M5/M6 contracts · the recorded tech debt.

## Risks

| Risk | Handling |
| --- | --- |
| The toolbox becomes the format by accident | Only primitives with prior duplication in ≥2 shipped games. New ones need a game that needed them |
| The synthesizer flatters the pipeline | It composes from a spec rather than returning canned files; the model swap must change only the adapter, and that is a verification item |
| The loop overfits to `gbs check` — output that conforms but is not a game | Conformance and playability are recorded separately. D-022 already says conformance is not quality; here that distinction has to be enforced by a human looking at it |
| "Quickly" quietly becomes a minute | **Under 20 seconds** on the synthesizer path, with generate, build, check and reload measured *separately* so a regression is attributable. Real-model latency is measured separately, later |
| Revision corrupts a working game | Every revision is a new immutable version; the previous one keeps working and rollback is repointing the manifest |
| Scope creep toward the consumer product | No UI, no feed, no publishing. The loop is a library plus a CLI |
| IP contamination in generated content | First-party only, nothing published by default, no generating from named commercial IP |

## Definition of done

1. **`forge new "<a game request>"` produces a playable game with no manual code
   editing**, and opens it.
2. **`forge revise <session> "<a change>"` modifies that same game** and returns
   it to play, within a stated and measured budget.
3. Both work with the synthesizer — **no model, no cost** — and swapping in a
   model changes only the adapter.
4. Generated games are shown to use toolbox primitives rather than reinvent
   them, measured rather than asserted.
5. Full `gbs check` passes on a generated artifact, and the loop is shown to
   reject one that does not.
6. Five games across at least three genres, with the recorded finding on what a
   schema would need.
7. Nothing auto-published; the library is unchanged unless we choose otherwise.
8. `npm run verify` passes, including new checks that fail when deliberately
   broken.

## Decisions, settled

1. **Confirm the toolbox rule** — derived only from primitives already
   duplicated in shipped games, rather than designed forward.
2. **The revision budget** — under 20 seconds on the synthesizer path, with the
   four phases timed separately.
3. **Existing games do not adopt the toolbox in M7.** They are the evidence it
   was derived from, and rewriting working code would be churn.
