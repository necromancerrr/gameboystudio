# M6_PLAN.md — "A game can be made without this repository"

Approved direction for milestone 6. Strategy lives in PLATFORM_DIRECTION.md;
ratified decisions live in DECISIONS.md (D-020, D-021, D-022).

**M6 = The authoring boundary: an SDK package, an iteration loop, and a
conformance check.**

## Goal

> **A game can be created, run, iterated on and validated without touching the
> application source and without deploy credentials.**

Validation question:

**Can someone who has never seen this repository make a game it will run?**

That is also the AI question, one milestone early: a generator is exactly a
creator who has never seen the repository.

## Where the platform stops now

M5's claim — a game can exist without being compiled into the application — is
true and live. But a hosted game today is authored like this:

```ts
// hosted-games/src/drift.ts
import { runHostedGame } from '@/hosted/sdk';
```

That `@/` resolves only because `hosted-games/build.mjs` sets
`alias: { '@': REPO/src }`. The SDK itself reaches further in, taking
`LogicalButton` from `@/emulation/core/types`.

So the honest statement: **games no longer need the application's build, but
they still need its repository.** Publishing means someone with this checkout
runs `npm run hosted:build` and holds Cloudflare credentials.

That is the wall between M5 and anything creator- or AI-shaped.

## Why not the format, and why not AI, yet

**The declarative format is still not earned.** D-018 set the condition: more
games and more genres must exist first, and they could not while a game could
only arrive by site deploy. M5 removed that constraint, but no new game has
arrived through it, so the corpus is unchanged — still two bespoke physics
games. Designing the format now would design it from the same evidence that was
already judged insufficient.

M6 is therefore also the milestone that starts producing that evidence. Its
proof game is deliberately **not** an action game: a state machine with timers
and simple drawing is the kind of thing a declarative format could plausibly
express, and it is exactly the counter-evidence the corpus lacks.

**AI creation would lock in the wrong target.** FUTURE_CREATOR_SYSTEM says AI
should target "a GameBoyStudio-defined runtime or game schema rather than
arbitrary unrestricted web applications". Today the only target is arbitrary
JavaScript that deep-imports our source. Pointing a generator at that produces
the thing that document warns against, and makes the eventual format harder to
introduce rather than easier.

Both want the same missing thing: a stable external target, and a way to tell
whether a game is acceptable.

## What M6 builds

### 1. The SDK as a package artifact

Self-contained, versioned against the frame protocol, carrying its own types
rather than importing application internals. Distributed as a **versioned
tarball**, not a relative import and not npm — public naming and versioning are
a later decision (D-020).

### 2. The iteration loop

FUTURE_CREATOR_SYSTEM says the important interaction may not be first-generation
quality but iteration speed: **CHANGE → PLAY → FEEL → CHANGE**. Today that cycle
is edit → esbuild → wrangler deploy → reload.

The SDK ships a **preview host**: a minimal page that implements the host side
of the frame protocol — the same sandbox, the same handshake, the same lifecycle
— so a creator can play their game with nothing installed but the SDK.

It is deliberately not the full player. It has no library, no rooms, no
`InputRouter`. Saying so matters: a preview that pretended to be the product
would send people to publish games that behave differently in it. The full
player remains the thing the proof game is finally checked in.

### 3. `gbs check` — conformance, not judgement

Answers "will the platform accept this?" before anyone publishes.

It checks **the contract**:

- the handshake happens, and the protocol version is one the host supports
- declared resolution matches what the game announces
- **declared input reaches the sandbox and is decoded correctly** — the SDK's
  own input state reflects exactly what the host sent
- lifecycle conforms: start runs, pause stops, resume continues, reset does not
  error, mute is accepted, destroy is clean
- declared capabilities are true: a game claiming `saves` produces bytes and
  restores them; one that does not claim saves produces none
- the sandbox holds: no storage, no cookies, no parent DOM
- the manifest entry passes the M5 validator, and the bundle is within budget

It deliberately does **not** check that "input moves something". That is action
game bias dressed up as a standard — a turn-based game, a text game, or one that
only responds on release would all fail a rule like that while being perfectly
well-formed. Whether input produces a particular visible response is the game's
own test to write, and the proof game writes one.

`gbs check` says a game is well-formed. It never says a game is good.

### 4. A starter

One command to a game that already runs. A creator begins with something
playable, not with configuration.

## Compatibility, which begins now

Once a game exists that we did not build, **the frame protocol becomes a
compatibility surface**. A bundle built against version 1 must keep working when
the host moves to 2, or every published game breaks on a deploy its author does
not control.

D-021 makes this explicit: the host supports the current protocol version and
the previous supported one; the SDK version is recorded in the manifest entry;
and an incompatible bundle **fails clearly before play rather than mysteriously
during it**. That is the real cost of M6 and it is named here rather than
discovered in M7.

## Stages

**S1 — Extract the SDK.** Break the application-source dependency, give the
package its own types, tie its version to the protocol. The existing hosted
artifacts keep building unchanged as the regression net.

**S2 — Conformance.** `gbs check`, run against known-good and deliberately
broken bundles.

**S3 — The loop.** Preview host, local serving, rebuild on change.

**S4 — The starter.** One command to a running game.

**S5 — Proof.** A game authored in a **separate project outside this
repository**: the SDK installed from its tarball, no `@/` aliases, no imports
from `src/`, no workspace resolution, no symlinks back. After installing the
SDK its build must not touch the application source at all. Published to the
live hosted origin — the first genuinely externally authored game the manifest
has served.

**S6 — Verification.** Per D-012, every check against deliberate breaks.
Specifically: the SDK package must build with the application source **absent**,
and conformance must reject a bundle that escapes the sandbox, one that never
handshakes, one built against an unsupported protocol version, and one whose
declared capabilities are false.

## Explicit non-goals

Accounts · uploads · a publishing service or API · moderation · an in-browser
editor · the declarative format · AI generation · analytics · remixing · asset
pipelines · npm publication · changes to `BinjgbAdapter`, `NativeGameRuntime`,
or the M5 manifest and sandbox design.

Curation is unchanged. M6 makes a game *makeable* by someone else. It does not
make it *publishable* by them.

## Risks

| Risk | Handling |
| --- | --- |
| Extraction churns M5's working code | Existing artifacts rebuild unchanged as the regression net; the protocol itself is not redesigned |
| Conformance gives false confidence | It checks the contract and says so in its own output; the proof game writes its own behavioural test |
| A protocol change breaks published games | D-021, decided now: current and previous version supported, refusal before play |
| The preview host is mistaken for the product | Named as a preview everywhere it appears; the proof game is finally checked in the real player |
| Scope creep into a publishing platform | No upload path exists, so there is nothing to moderate |
| The proof game reads as catalog padding | It is proof, as Drift and Ring Out were for M3 — and it is chosen to be the genre the corpus lacks |

## Definition of done

1. A game builds from a directory outside this repository, with the SDK
   installed from a tarball and no access to the application source.
2. `gbs check` passes it, and fails a sandbox-escaping bundle, a non-handshaking
   one, one on an unsupported protocol version, and one whose declared
   capabilities are false.
3. Editing a source file shows the change in the preview host in seconds, with
   no deploy.
4. The proof game is live on the hosted origin and plays in the real player with
   keyboard and touch.

   **Corrected after the fact.** This originally said "keyboard, gamepad, touch
   and an M4 phone controller", which was not achievable and should not have
   been written: Sequence is a one-player game, and the Invite affordance is
   gated on `players.max > 1`, so no phone can be attached to it at all. That is
   a real product question — a phone as the controller for a solo game is a
   reasonable thing to want, and M4's plumbing already supports it — but it is a
   change to the player, not to M6, and it is not made here.
5. The existing hosted artifacts still build and pass.
6. `npm run verify` passes, including new checks that fail when deliberately
   broken.

   **Outstanding.** Everything except `verify:browser` passes. That suite cannot
   complete on this machine: it kills the browser at "a run can be lost and
   restarted with the keyboard", reproducibly, and **it does so on `main` too**
   — verified in a clean worktree with no M6 code present. So it is not M6's
   doing, but it does mean the browser suite has not been run end to end against
   this branch, and that should be resolved before merging rather than assumed.
