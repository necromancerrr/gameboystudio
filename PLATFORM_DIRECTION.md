# PLATFORM_DIRECTION.md

Settled platform direction as of 2026-08-08, after two rounds of brainstorm and
revision. This is the strategy document. DECISIONS.md remains the record of
individual ratified decisions.

## The product

**GameBoyStudio is an instant-play gaming platform for the web, built
controller-first.**

Games launch without installs or configuration, controls are immediately
understandable, and physical controllers are a first-class part of the
experience.

## Why it exists

> **Remove the distance between wanting to play something and actually playing
> it.**

That single sentence explains the whole roadmap, at both ends of the platform:

```
PLAYER                        CREATOR

"I want to play that."        "I want this game to exist."
        ↓                              ↓
      PLAY                          CREATE
                                       ↓
                                     PLAY
```

Today that distance is: see game → play.
Later: friend sends game → play.
Then: join multiplayer → play.
Eventually: imagine game → create → play.

This is why AI creation belongs here rather than being bolted on. It is the same
philosophy applied to the creator side: shorten the distance between intent and
play.

## The three contracts

The platform is defined by one identity contract, one operating standard, and
one curation philosophy. They are not interchangeable, and only one of them
decides what belongs.

| | Contract | Role | Binding? |
| --- | --- | --- | --- |
| **A** | Instant | How the platform *behaves* | Yes — an enforced standard |
| **B** | Controller-first | How GameBoyStudio *feels* | Yes as a default and a certification; **not** a prohibition |
| **C** | Session-friendly | What we *curate toward* | No — editorial philosophy |

### A. The Instant Contract — how the platform behaves

Binding on the platform, for every game regardless of runtime or origin.

- No install
- No configuration
- No signup required to play
- Fast start — a hard time-to-first-input budget
- A direct link plays the game
- Platform-managed persistence where appropriate

This is measurable, and we should hold ourselves to it as an SLA rather than an
aspiration.

### B. The Controller-First Contract — how it feels

The default GameBoyStudio game is completely playable with a physical
controller. Native GameBoyStudio games treat the standardized gamepad input
model as a first-class target.

**This is a strong default and a certification. It is not a ban.**

An earlier draft of this document said other input models should be "optional
additions, never requirements." That was wrong, and wrong in the same way the
original eight-button thesis was wrong: it took a good default and froze it into
a permanent prohibition. A party game where one player holds a pad and three
others use phones is a proven format. A platform that architecturally forbids it
has chosen a cage over an identity.

The correct asymmetry:

- **The platform** never forbids a game for using another interaction model.
- **First-party and native GameBoyStudio games** must be Gamepad Native.
- **Every game** declares which input profiles it requires and supports.
- **Discovery** can filter on this, so "what can I play with the controller in
  my hand" is always answerable.

### C. The Session Contract — what we curate toward

Understandable in seconds, rewarding in minutes, progress persists.

Deliberately *not* enforced. Aevilia is a 128K-save RPG already in the catalog;
an earlier draft's "finishable in one sitting" rule would have excluded a game
we already ship. This is a lean, not a gate.

## Input philosophy

Every game declares its input requirements against a platform vocabulary.

```
GAMEBOYSTUDIO INPUT PROFILES

Standard Gamepad        d-pad · sticks · face buttons · shoulders/triggers · menu
Keyboard                optional
Mouse / Pointer         optional
Touch                   optional
Motion                  future
Custom / Experimental   future
```

Retro titles map a subset of Standard Gamepad. Native games may use all of it.
Nothing is required to use all of it.

### Gamepad Native

A platform capability worth certifying, with a precise definition:

> A **Gamepad Native** game can be discovered, launched, played, paused,
> navigated, and completed without requiring another input device.

Note that the bar covers the whole session, not just gameplay — a game that
plays on a pad but needs a mouse to get past a menu is not Gamepad Native.

The majority of the curated library should carry this. All first-party games
must. It describes the default and preferred experience without prohibiting
anything.

## Two independent roadmaps

Conflating these produced a bad recommendation in an earlier draft ("postpone
more consoles"). Adding GBA is not platform progress — but it is legitimately
more worth playing, and that matters on its own terms.

```
CONTENT                          PLATFORM
what there is to play            what the platform owns

GB / GBC                         Instant Play
   ↓                                ↓
GBA / NES / Atari / other retro  Discovery + Continuity
   ↓                                ↓
Homebrew + indie                 Native Runtime
   ↓                                ↓
GameBoyStudio originals          Multiplayer
   ↓                                ↓
Community games                  Creator Tools
                                    ↓
                                 AI Creation
```

They interleave but are prioritised independently.

**Content is gated by legal supply, not architecture.** The adapter boundary
(D-005) already makes a new core cheap. The gbdev database that supplied the
current catalog also holds 189 GBA and 23 NES entries under the same licensing
discipline we already have tooling for.

**Platform is gated by the previous rung.** The native runtime is the keystone:
multiplayer, creator tools and AI creation all depend on it, and it is the step
that makes this something other than an emulator frontend.

Retro Game Boy content **cannot** deliver multiplayer — link-cable play is
absent from nearly all homebrew and unsupported by binjgb. Native games must
therefore precede multiplayer, which corrects the ordering in PRODUCT_LAYERS.

## Findings that still stand

**The nostalgia hook does not exist.** The catalog is 20 obscure homebrew titles
and legally cannot contain recognizable classics. There is no "I remember this!"
available. The product must win on curation and feel, not recognition. This
remains the most important correction to the product framing.

**Runtimes must be invisible.** The current play page shows a blank rectangle,
four emulator verbs (Pause/Reset/Mute/Fullscreen), a dense keyboard legend, an
fps counter and a controller diagnostic line. The fps and input indicators were
built to debug an input bug and shipped as product UI. None of it is the game.

**The library reads as a database.** Alphabetical ordering puts three
near-identical mazes first; the hero leads with redistribution licensing;
console chips are the only navigation; most tiles are title screens reading
"PRESS START"; there is no search.

**We can show real gameplay.** Because we control the runtime and the games are
small, the library can display generated gameplay loops instead of box art. The
`verify:catalog` harness already boots every ROM headlessly. This is enabled by
runtime ownership, not by any constraint on game size.

**The name is a legal liability.** "Game Boy" is an active Nintendo trademark.
This needs a conscious decision before the brand accrues value.

## What stays in V1

Instant play with no upload or configuration · the 20 curated, license-verified
games · keyboard and gamepad · battery saves · fullscreen · licensing rigor,
kept but moved out of the player's face.

## What should change in the current experience

**Play page:** remove fps, the key indicator and the pad-activity text from the
default UI (keep behind a dev flag) · demote the four emulator verbs into one
quiet cluster that fades when idle · replace the permanent keyboard legend with
a first-run hint · show controller state only on change · cover the boot period,
since Tobu Tobu Girl's seven seconds of white screen is indistinguishable from
broken.

**Library:** replace alphabetical ordering with curation · demote console to a
facet · move licensing out of the hero · replace title-screen tiles with
generated gameplay loops · add search.

## Next three milestones

**M1 — "A place to play."** Strip emulator chrome, generate gameplay previews,
curate the ordering, add search and a real first-run moment.
*Validation: a stranger plays something within 30 seconds without reading.*

**M2 — "A reason to return."** Local-first continuity: recently played, resume,
favorites, playtime. No accounts, no backend.
*Validation: returning is demonstrably better than arriving.*

**M3 — "Games that could only exist here."** A minimal native runtime plus two or
three first-party Gamepad Native games, one of them local two-player.
*Validation: a game exists here that cannot be played anywhere else.*

## Architectural decisions proposed, not yet ratified

Recorded here so they are not lost. **None of these are decided**; ARCHITECTURE.md
is deliberately unchanged until they are.

1. **Runtime, not console.** `runtime` (`gb` | `gbc` | future `gbs-native`)
   describes how a game runs; `console` becomes display metadata.
2. **A game manifest.** One shape for any playable thing: id, title, runtime,
   entry point, **required and supported input profiles**, players, facets,
   license, attribution.
3. **The input vocabulary as a published spec.** The profiles above, formalized.
   `src/input` is roughly 60% of this already, pitched at Game Boy altitude.
4. **Facet the catalog now** — playtime, players, difficulty, mood, origin.
   Cheap at 20 rows, painful to backfill.
5. **Saves keyed for a future account.** Already namespaced; keep the storage
   interface swappable.
6. **Stay static and local-first** until continuity or multiplayer demands
   otherwise.

## Deliberately postponed

Accounts and auth · any backend or database · netcode, rooms, presence · the
creator editor · AI generation · monetization · moderation tooling · ratings and
comments · achievements · cloud saves.

Additional consoles are **not** on this list. They are a content decision on
their own track, gated by legal supply.

## Risks

**Product.** No recognition hook. No retention loop. Curation currently absent,
so quality is invisible.

**Technical.** binjgb is a single-maintainer dependency vendored from an unpinned
build. The native runtime is a multi-month effort that everything downstream
depends on. Deterministic multiplayer is hard. Safari and Firefox unverified.

**Legal.** Pressure to add commercial ROMs will be constant and is existential.
Creator publishing brings moderation, DMCA and abuse handling. AI-generated
assets carry IP contamination risk. The trademark exposure in the name needs a
decision.

**Platform.** Roblox, itch.io and Poki are entrenched. Cold start is two-sided:
creators follow players, players follow games. The way through is first-party
content that proves the format before asking anyone else to build for it.
