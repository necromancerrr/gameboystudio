# BRAINSTORM_RULES.md

## Purpose

Use this file when brainstorming significant GameBoyStudio product or architecture decisions.

The objective is not to produce more ideas.

The objective is to discover the best next decision.

## Start With The Experience

Before architecture, answer:

1. What does the player see?
2. What does the player do?
3. What happens immediately after?
4. Why is this better than the current experience?
5. What would make it feel magical rather than merely functional?

Do not begin with databases, frameworks, APIs, or abstractions unless the task is specifically technical.

## Separate Now From Later

Classify ideas as:

### NOW

Required to prove the current experience.

### NEXT

Likely valuable after the current experience works.

### LATER

Part of the platform vision, but should not add present complexity.

### MAYBE

Interesting, but not justified yet.

## Compare Real Alternatives

For substantial decisions, generate 2-4 meaningfully different approaches.

Compare:

- player experience
- simplicity
- speed to validate
- technical risk
- legal/content constraints
- future flexibility
- maintenance cost
- uniqueness

Then recommend one.

## Ask Platform Questions

When relevant:

- Does this make GameBoyStudio feel more like a destination?
- Does it improve play, discovery, connection, or creation?
- Are we solving a player problem or copying another platform?
- Does it truly need an account?
- Does it need a backend?
- Does it require real-time infrastructure?
- Does it work for old games and future native games?
- Are we exposing emulator details players should never need to understand?
- Would this still make sense when some games were never tied to a console?

## Do Not Let The Name Overconstrain The Product

GameBoyStudio is the identity.

Do not assume every future game must be a Game Boy game.

Do not organize the entire future platform around console generations only because the first catalog contains classic games.

Game Boy is the origin point.

The platform can grow beyond it.

## AI Brainstorming Rule

When discussing AI creation, do not immediately default to:

"generate arbitrary JavaScript and run it."

First ask:

- What kinds of games can users create?
- What runtime do they target?
- What capabilities exist?
- How is code or behavior sandboxed?
- How does multiplayer work?
- How are assets represented?
- How are versions stored?
- What is publishable?
- How are broken or unsafe games handled?
- What constraints make AI generation more reliable?

The creator system should probably be opinionated.

Constraints may improve both safety and quality.

## Multiplayer Brainstorming Rule

Do not treat multiplayer as one thing.

Separate:

- local multiple-controller play
- remote multiplayer for existing games
- asynchronous score competition
- spectating
- multiplayer-native GameBoyStudio games
- creator-built multiplayer games

These have different product and technical requirements.

## End Every Brainstorm With A Decision

A useful brainstorm ends with:

### Problem

What are we deciding?

### Options

What credible approaches exist?

### Recommendation

Which direction is strongest and why?

### Not Now

What are we deliberately postponing?

### Validation

What would prove the decision correct?

### Next Step

What is the smallest concrete action?
