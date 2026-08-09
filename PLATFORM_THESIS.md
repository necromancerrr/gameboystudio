# PLATFORM_THESIS.md

## Purpose

This document describes what would make GameBoyStudio a platform rather than simply a retro game website.

It is intentionally future-facing.

It should influence product decisions without causing the MVP to overbuild.

## Settled Direction

The platform thesis is recorded in PLATFORM_DIRECTION.md. In short:

**GameBoyStudio is an instant-play gaming platform for the web, built
controller-first**, existing to remove the distance between wanting to play
something and actually playing it.

Three contracts define it: **Instant** (how the platform behaves — binding),
**Controller-first** (how it feels — a default and a certification, not a
prohibition), and **Session-friendly** (what we curate toward — philosophy, not
a gate).

## The Platform Thesis

A game platform becomes more valuable when it connects three groups:

1. players
2. games
3. creators

GameBoyStudio initially connects:

**players ↔ games**

The long-term opportunity is:

**players ↔ games ↔ creators**

Creators produce more things to play.
Players give creators an audience.
Multiplayer and community increase the value of both.
AI can reduce the cost of becoming a creator.

## Layer 1: Runtime

The runtime is the ability to make a game playable inside GameBoyStudio.

Today this may mean browser emulation.

Later it may also include:

- HTML5 games
- Canvas games
- WebGL games
- WebAssembly games
- games built with a GameBoyStudio runtime
- multiplayer-native games

Players should not need to care which runtime powers a game.

Runtimes are invisible infrastructure. Emulator internals — cores, frame rates,
save-state plumbing — must never appear in player-facing UI.

## Input Profiles

Every game declares which input profiles it **requires** and which it
**supports**.

```
Standard Gamepad        d-pad · sticks · face buttons · shoulders/triggers · menu
Keyboard                optional
Mouse / Pointer         optional
Touch                   optional
Motion                  future
Custom / Experimental   future
```

**Gamepad Native** is a platform capability worth certifying:

> A Gamepad Native game can be discovered, launched, played, paused, navigated,
> and completed without requiring another input device.

The majority of the curated library should carry it and all first-party games
must. The platform does not forbid games that need another interaction model.

## Layer 2: Library

The library is the player's map of the platform.

Eventually, discovery should not be organized only around consoles.

Useful dimensions may include:

- genre
- mood
- multiplayer
- quick play
- difficulty
- era
- player count
- trending
- recently added
- classics
- community-made
- experimental

Console should remain metadata and a useful filter, not necessarily the permanent top-level structure.

## Layer 3: Player Identity

Accounts should exist only when they improve playing.

Good reasons:

- continue a save
- sync progress
- remember controller preferences
- keep favorites
- see play history
- join friends
- join multiplayer rooms
- appear on leaderboards
- follow creators

Bad reason:

- every platform has profiles

## Layer 4: Social Play

The social layer should grow from games.

Prioritize actions like:

- invite a friend
- join a room
- challenge someone
- compare a score
- spectate
- share a game
- replay together

Avoid turning GameBoyStudio into a generic feed-first social network.

## Layer 5: Creation

Creation transforms GameBoyStudio from a finite catalog into an ecosystem.

The ideal flow is:

**IDEA → BUILD → PLAYTEST → CHANGE → PUBLISH**

The same platform used to play should also make testing immediate.

## Layer 6: AI Creation

AI should eventually help build games inside a constrained, reliable system.

Possible responsibilities:

- scaffold game logic
- create levels
- create sprites or assets
- generate dialogue
- design enemies
- configure physics
- add multiplayer rules
- explain bugs
- adjust difficulty

A controlled GameBoyStudio game format may ultimately be better than generating arbitrary web apps.

## Layer 7: Distribution

Publishing should eventually be native.

A creator makes a game.
The game becomes playable through a URL.
It can enter the GameBoyStudio library.
Players can discover it.

The creator should not need to configure separate hosting.

## Potential Flywheel

More games
→ more player choice
→ more players
→ larger creator audience
→ more creators
→ more games

AI can accelerate the creator side.

This flywheel does not exist yet.

The MVP must first earn players through the quality of play and discovery.

## Two Independent Roadmaps

Content expansion and platform evolution are separate tracks with separate
priorities. Conflating them produces bad decisions in both directions.

```
CONTENT                          PLATFORM
what there is to play            what the platform owns

GB / GBC                         Instant Play
GBA / NES / Atari / other retro  Discovery + Continuity
Homebrew + indie                 Native Runtime
GameBoyStudio originals          Multiplayer
Community games                  Creator Tools
                                 AI Creation
```

Content is gated by **legal supply**, not architecture — the adapter boundary
already makes a new core cheap. Platform is gated by the previous rung.

## Strategic Distinction

Supporting more consoles does not automatically make GameBoyStudio a platform.

That may only make it a larger emulator frontend.

This is not an argument against adding consoles. More systems mean more worth
playing, which is a legitimate goal on the content track. It is only an argument
against mistaking catalog growth for platform progress.

The transition into a platform happens when GameBoyStudio begins to own:

- discovery
- player identity
- social play
- creation
- publishing
- distribution

Emulation is one source of content inside that system.

It is not the entire system.
