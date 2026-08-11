# PRODUCT_LAYERS.md

## Why This Exists

GameBoyStudio has a large future vision.

The risk is trying to build the future before proving the present.

These layers separate what matters now from what becomes important later.

## Layer 0 — The Feeling

Before features:

**I opened GameBoyStudio and was playing something good almost immediately.**

Everything depends on this.

## Layer 1 — Instant Play

Goal:

Prove the browser can feel like a real place to play games.

Focus:

- strong library
- authorized playable games
- fast game launch
- keyboard
- controller support
- reliable audio
- fullscreen
- clean switching between games

Validation question:

**Would someone choose this instead of manually opening an emulator?**

## Layer 2 — Discovery

Goal:

Help players find something even when they do not already know what they want.

Possible additions:

- collections
- stronger search
- genres
- moods
- eras
- recommendations
- featured games
- quick-play categories
- editorial curation

Validation question:

**Can GameBoyStudio help me find a game I did not arrive looking for?**

## Layer 3 — Continuity

Goal:

Give users a reason to return.

Possible additions:

- accounts
- recently played
- favorites
- save states
- cloud saves
- play history
- playtime
- achievements

Validation question:

**Does returning feel better than starting over?**

## Layer 4 — New Games

Goal:

Stop depending exclusively on historical games.

Add:

- homebrew
- indie games
- web games
- commissioned games
- games made for GameBoyStudio

This layer requires a **native runtime** — the keystone of the whole roadmap.
Multiplayer, creator tools and AI creation all depend on it.

Validation question:

**Can GameBoyStudio become a place where new games launch, not only where old games are played?**

## Layer 5 — Playing Together

Goal:

Turn games into shared experiences.

Possible additions:

- multiple local controllers
- multiplayer-native games
- friend invites
- rooms
- challenges
- leaderboards
- tournaments
- presence

**This layer comes after new games, not before.** Game Boy multiplayer was the
link cable; almost no homebrew supports it and binjgb does not emulate it. The
retro catalog cannot deliver multiplayer at all, so multiplayer depends on games
built for the platform.

Validation question:

**Can another person make this experience meaningfully more fun?**

## Layer 5.5 — Hosted Games

Amended 2026-08-10 by D-018.

Before creators can publish, the platform has to be able to run a game it did
not compile. Today Game Boy titles are already data — a ROM is an asset,
interpreted at runtime — while native games must be compiled into the site, so
the catalog cannot grow without shipping the application.

This is not a layer of its own so much as the floor under the next two. Creator
tools publish something and AI generates something; both need somewhere to put
it that is not our source tree.

Validation question:

**Can a game change without rebuilding the platform?**

## Layer 6 — Creator Platform

Goal:

Let creators build and publish inside the ecosystem.

Possible capabilities:

- creator projects
- templates
- reusable game systems
- asset management
- live preview
- playtesting
- publishing
- versions
- analytics

Validation question:

**Can someone make something playable without leaving GameBoyStudio?**

## Layer 7 — AI-Native Creation

Goal:

Allow someone with an idea—but little or no game-development experience—to make a game.

Possible flow:

1. describe
2. generate
3. play
4. modify
5. invite
6. publish

Validation question:

**How close can we make the distance between imagination and play?**

## These Layers Describe The Platform, Not The Catalog

Content expansion runs on its own track and is gated by legal supply, not by
these layers. Adding GBA or NES is not "advancing a layer" — it is adding more
things worth playing, which is valuable on its own terms. See PLATFORM_THESIS.

## Rule For Moving Forward

Do not advance because a feature sounds exciting.

Advance when the previous layer creates a real need for the next one.

Do not build profiles before there is something worth remembering.

Do not build multiplayer before individual play is reliable.

Do not build a marketplace before creators exist.

Do not build AI generation before there is a runtime and publishing model capable of safely hosting what it creates.
