# FUTURE_CREATOR_SYSTEM.md

## Status

Future concept only.

Do not implement during the current retro-gaming MVP.

## Core Idea

GameBoyStudio should eventually allow people to create games inside the platform.

The goal is not to recreate a professional game engine in the browser.

The goal is to make creating a small, playable game dramatically easier.

A creator should begin with an idea, not project configuration.

## Desired Experience

A user might type:

> Make a two-player game where tiny chefs fight over ingredients in a kitchen.

GameBoyStudio creates a playable starting point.

The creator immediately plays it.

Then:

> Make the pan knock players backward.

The game changes.

Then:

> Add a timer and make whoever cooks the most dishes win.

The game changes again.

Then the creator invites a friend, tests it, and publishes it.

It should feel less like software development and more like directing a game into existence.

## AI Should Target A Game System

A strong future direction may be for AI to target a GameBoyStudio-defined runtime or game schema rather than arbitrary unrestricted web applications.

Potential primitives:

- scenes
- entities
- sprites
- collisions
- movement
- cameras
- triggers
- variables
- timers
- dialogue
- inventories
- health
- scoring
- multiplayer state
- audio
- UI
- win/loss conditions

A constrained runtime could enable:

- reliable previews
- safer execution
- easier multiplayer
- versioning
- remixing
- controller support by default
- consistent publishing
- predictable performance

## Creation Modes

Possible future modes:

### Prompt

Describe a game or modification.

### Visual Editor

Modify scenes, objects, values, and relationships directly.

### Advanced Logic

Allow deeper control for experienced creators.

All modes should operate on the same underlying project.

## Creation Is Iterative

The most important interaction may not be first-generation quality.

It may be iteration speed.

The creator should continuously move through:

**CHANGE → PLAY → FEEL → CHANGE**

A basic first generation that can be changed instantly may be more valuable than a sophisticated generation that is difficult to edit.

## Publishing

Publishing should eventually be one action.

A published game can receive:

- a playable URL
- artwork
- description
- creator attribution
- supported input information
- player count
- version
- discovery metadata

No separate hosting workflow should be required.

## Remixing

If a creator permits it, another user could:

- duplicate a game
- modify mechanics
- build new levels
- change art
- create a multiplayer variation
- publish a derivative

Attribution and permissions must be explicit.

## Important Unknowns

Before implementation, the platform would need to decide:

- runtime architecture
- sandboxing
- project format
- asset generation and storage
- multiplayer model
- moderation
- ownership
- licensing
- remix permissions
- version control
- AI cost model
- game size limits
- publishing review
- creator monetization, if any

These are intentionally unresolved until the product reaches this phase.
