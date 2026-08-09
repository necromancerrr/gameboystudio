@AGENTS.md

# CLAUDE.md

## Project: GameBoyStudio

GameBoyStudio is an instant-play gaming platform for the web, built
controller-first. It exists to remove the distance between wanting to play
something and actually playing it.

See VISION.md and PLATFORM_DIRECTION.md for the platform direction.

The first release focuses on Game Boy and Game Boy Color. The long-term direction may expand into additional vintage systems such as NES, SNES, Sega Genesis, Game Boy Advance, and other consoles, but the first product should prove that a user can discover a game, open it, connect a controller, and actually play.

This repository should be treated as a product, not as an emulator demo.

## Core Product Idea

The user opens the site, browses a polished library of retro games, selects one, and immediately plays it in the browser.

The primary loop is:

DISCOVER GAME -> OPEN GAME -> CONNECT CONTROLLER -> PLAY

Everything else is secondary until this experience feels excellent.

## Current Scope

The first release is Game Boy and Game Boy Color only.

The MVP should support:
- Game Boy / Game Boy Color game catalog
- Game detail / play pages
- Real browser-based Game Boy emulation
- Keyboard controls
- Gamepad / controller support
- Fullscreen
- Pause / resume
- Reset
- Mute / audio controls
- Local controller preferences where useful
- Responsive modern UI

Do not add authentication, multiplayer, profiles, achievements, payments, chat, social features, cloud saves, or a backend unless specifically requested.

## Product Principles

1. Play should be immediate.
2. The emulator is infrastructure; the game is the product.
   **Runtimes are invisible.** Emulator internals must never appear in
   player-facing UI: no frame counters, no core names, no save-state plumbing,
   no input diagnostics. Debug affordances belong behind a development flag.
3. Retro does not mean visually outdated.
4. Avoid fake nostalgia, excessive scanlines, neon overload, and arcade-site clutter.
5. Controller support is a first-class experience.
6. The architecture should make adding new consoles possible later without building a premature universal emulator platform today.
7. Keep the MVP small enough to actually finish.

## Design Direction

The interface draws on Game Boy hardware as a design language, not as a literal
reproduction. See D-009.

Visual direction:
- Dark, neutral foundation built on DMG-derived greys
- The green LCD palette as a deliberate accent, never as page chrome
- Game artwork provides most color
- Large covers and strong imagery
- Clean modern typography
- Retro typography only as an accent
- Generous spacing
- Minimal chrome around gameplay
- Hardware reference through proportion, spacing, and detailing rather than
  through drawn plastic
- Subtle late-1980s / early-1990s Nintendo industrial design influence
- High-quality transitions and hover states

Avoid:
- A literal Game Boy shell framing the play area
- Green-on-green applied site-wide
- Cheap neon arcade aesthetics
- Pixel fonts everywhere
- Heavy LCD ghosting or scanline filters by default
- Overly skeuomorphic console frames
- Dense dashboards
- Generic SaaS cards

Think more like a premium media library that happens to contain playable retro games.

## Legal / Content Constraint

Never automatically download, scrape, bundle, or suggest sourcing copyrighted commercial ROMs from unauthorized websites.

The platform may host ROM files that the project has the legal right to distribute, including licensed, public-domain, homebrew, or otherwise authorized ROMs.

An entry appearing in a public archive is not by itself a distribution grant. Only
include ROMs carrying an explicit license that permits redistribution, and record
that license in the catalog. See D-008.

If no authorized ROM is available during development, use fixtures, placeholders, test ROMs, or clearly documented local paths. Do not silently obtain ROMs online.

## Preferred Stack

Unless the existing repository already establishes something else:
- Next.js
- TypeScript
- React
- Tailwind CSS

Prefer native browser APIs where appropriate.

Controller support should use the Gamepad API.

Prefer a mature browser-compatible emulator core. Evaluate licensing, maintenance status, browser compatibility, performance, integration difficulty, and controller/input API before choosing one.

The current proposed core is binjgb (MIT, WebAssembly). See D-006.

## Architecture Principle

Keep emulator-specific code behind a small adapter layer.

Conceptually:

```ts
interface EmulatorAdapter {
  loadGame(source: GameSource): Promise<void>;
  start(): Promise<void> | void;
  pause(): void;
  resume(): void;
  reset(): void;
  setInput(input: EmulatorInput): void;
  setMuted(muted: boolean): void;
  enterFullscreen?(): Promise<void> | void;
  destroy(): void;
}
```

Do not force this exact interface if the emulator integration suggests something better. The goal is separation between the product UI and emulator implementation.

The catalog should also be console-aware so additional systems can be added later.

## Expected Game Model

A game record will likely need fields such as:

```ts
{
  id,
  slug,
  title,
  description,
  year,
  developer,
  publisher,
  genre,
  coverImage,
  screenshots,
  romPath,
  console,        // 'GB' | 'GBC'
  controls,
  license,        // SPDX identifier — required, see D-008
  attribution,    // author/source credit, required by MIT and CC-BY-SA
  sourceUrl       // upstream repository or author page
}
```

Change the model when product needs justify it. Avoid speculative fields.

## Controller Experience

Controllers are the platform's defining interaction. The default GameBoyStudio
game is completely playable with a controller, and native games treat the
standardized gamepad model as a first-class target.

This is a default and a certification, **not** a prohibition. Games declare the
input profiles they require and support, and the platform may host games using
keyboard, pointer, touch, motion or combinations — including asymmetric play
where different players use different devices.

**Gamepad Native** means: discoverable, launchable, playable, pausable,
navigable and completable without requiring another input device. The bar covers
the whole session, not just gameplay.

Gamepad support should feel deliberate.

Expected behavior:
- Detect connected controllers after browser interaction where required.
- Show a subtle controller-connected state.
- Support common Xbox, PlayStation, Switch Pro, USB, and Bluetooth controllers when exposed through the browser Gamepad API.
- Map D-pad and/or left analog stick to the Game Boy D-pad.
- Map face buttons to A and B, respecting physical position rather than label,
  so Nintendo-layout and Xbox-layout pads both feel correct.
- Map Start and Select to sensible pad equivalents (typically Start/Menu and
  Back/Share).
- Allow keyboard fallback at all times.
- Avoid browser-global event behavior that breaks navigation or typing outside the player.
- Persist mappings locally only when there is a useful mapping UI.

Do not hardcode assumptions about every controller having identical button indexes without an abstraction or fallback.

## Before You Code

Do not jump directly into implementation when given a broad feature request.

For substantial work:
1. Read the relevant repository files.
2. Restate the concrete product problem internally.
3. Identify unknowns and risks.
4. Brainstorm 2-4 viable approaches.
5. Compare them based on user experience, implementation complexity, maintainability, and MVP fit.
6. Choose a direction and explain why.
7. Create a short implementation plan.
8. Only then modify code.

For trivial fixes, do not over-process.

## Brainstorming Standard

Brainstorming should produce decisions, not filler.

Good brainstorming asks:
- What does the user actually experience?
- What is the smallest version that proves the idea?
- What could make the implementation brittle?
- Which decisions are reversible?
- Which decisions will constrain future consoles?
- What is being added because it is useful versus because it sounds impressive?

When there are multiple plausible product directions, explicitly surface the tradeoffs before coding.

## When Evaluating Emulator Options

Research before selecting an emulator dependency.

Evaluate:
- Game Boy / Game Boy Color compatibility, including cartridge mappers (MBC1/3/5)
- Browser support
- JavaScript versus WebAssembly
- Input APIs
- Audio behavior
- Fullscreen behavior
- ROM loading mechanism
- Save-state support, even if not used yet
- License
- Maintenance activity
- Package size
- Framework integration difficulty
- Ability to isolate the emulator from React lifecycle issues

Do not pick a library solely because its name sounds appropriate or because it appeared in an old tutorial.

## Coding Rules

- Use TypeScript strictly.
- Prefer small components with obvious responsibilities.
- Keep emulator lifecycle logic out of visual components where possible.
- Clean up event listeners, animation loops, gamepad polling, and emulator resources.
- Avoid unnecessary global state.
- Do not introduce a state-management library unless complexity warrants it.
- Keep accessibility in mind for non-game UI.
- Ensure the site remains navigable without a controller.
- Avoid placeholder functionality that appears real but does nothing.
- Never fake successful emulator integration.

## Testing Priorities

The most important tests are product-flow tests:

1. Site starts locally.
2. Library loads.
3. Selecting a game routes to the correct page.
4. Authorized ROM/test fixture loads.
5. Emulator displays and runs.
6. Keyboard input works.
7. Controller is detected.
8. Controller input reaches the emulator.
9. Reset works.
10. Fullscreen works.
11. Leaving the page cleans up emulator resources.

Browser testing matters because Gamepad, audio, canvas, WebAssembly, and fullscreen behavior can differ between browsers.

## Performance

Retro games should feel instant.

Avoid loading emulator bundles, ROMs, screenshots, and every game asset on the homepage unnecessarily.

Use lazy loading and code splitting where useful, particularly for emulator code.

Do not optimize prematurely, but do not ship obvious large-bundle mistakes.

## How To Respond During Development

When asked for a broad feature:
- Start with a short product/technical assessment.
- Brainstorm meaningful options.
- Recommend one.
- Then implement when appropriate.

When something is uncertain, say so and verify it rather than inventing an answer.

When you discover a better product direction while implementing, surface it before making a large architectural detour.

## Definition of MVP Success

The first meaningful milestone is complete when a user can:

1. Open GameBoyStudio.
2. Browse Game Boy and Game Boy Color games.
3. Open one game.
4. Start playing without uploading a ROM.
5. Use a keyboard or connected controller.
6. Enter fullscreen and reset the game.

If that flow is not solid, do not prioritize secondary features.
