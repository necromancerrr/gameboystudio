# ARCHITECTURE.md

## Objective

Build the Game Boy / Game Boy Color MVP in a way that is simple today and does not make future console support painful.

## Suggested Layers

### Application UI

Responsible for:
- navigation
- library
- search/filtering
- game metadata
- player chrome
- settings UI

Should not know emulator internals.

### Game Catalog

Provides normalized game metadata.

Path:
`src/catalog/` — `games.ts` holds the generated data, `types.ts` the `Game`
shape, `index.ts` the query helpers.

The data is committed rather than fetched at build time. Homebrew Hub's license
field is community metadata, so each entry is verified by hand against its
upstream repository before it lands here; a build-time fetch would let the
catalog change without that review. See D-008.

`npm run verify:catalog` boots every ROM through binjgb and fails if one does
not render.

The data source may begin as TypeScript/JSON and move to a backend later only when necessary.

### Player

Owns:
- emulator lifecycle
- loading state
- error state
- fullscreen
- pause/reset/mute
- input coordination

Suggested path:
`src/features/player/`

### Emulator Adapter

Owns console-specific emulator integration.

Suggested shape:

`src/emulation/core/`
`src/emulation/gameboy/`

The binjgb WASM artifacts (`binjgb.js`, `binjgb.wasm`) are vendored static assets,
not an npm dependency. See D-006.

Keep the interface small. Do not design abstractions for consoles we have never integrated.

### Input Layer

Normalizes keyboard and controller input into logical actions:
- UP
- DOWN
- LEFT
- RIGHT
- A
- B
- START
- SELECT

All eight are first-class for Game Boy. Do not treat START/SELECT as optional.

Path:
`src/input/` — `keyboard.ts` and `gamepad.ts`, each exporting a `bind*` function
that returns an unbind callback.

Neither binding is focus-scoped. Both listen while a player is mounted and stop
on unmount. Keyboard events are ignored when they target a form field, button or
link, so typing and control activation still behave normally. See D-010 for the
gamepad mapping and D-011 for keyboard matching.

The gamepad binding polls on its own animation frame, so a controller still
works while the game is paused.

This layer should not care whether the emulator is Game Boy, NES, or another future console.

## Example Flow

Controller/Keyboard
-> normalized logical input
-> player controller
-> Game Boy emulator adapter
-> emulator core

Catalog record
-> game route
-> ROM/source loader
-> emulator adapter

## Suggested Routes

`/`
Library / discovery

`/games/[slug]`
Game details + player

Additional routes should be added only when justified.

## ROM Handling

Development can use a local public directory or authorized object storage.

Do not expose assumptions that all ROMs will permanently live in `public/roms`.

The catalog should refer to a source/path through a small abstraction so storage can move later.

## State

Prefer local React state and focused hooks.

Potential local persistence:
- controller mappings
- volume/mute
- last-used controller
- recent games later

Do not add Redux/Zustand solely because the project may grow.

## Emulator Lifecycle

A game page must explicitly manage:
- initialization
- ROM loading
- game start
- input subscription
- gamepad polling
- audio setup
- reset
- teardown

React Strict Mode and route changes can expose double-init bugs. Emulator construction should be idempotent or safely cleaned up.

## Browser Concerns

Expect restrictions around:
- autoplay audio
- fullscreen requiring user interaction
- Gamepad API behavior
- WebAssembly loading
- cross-origin ROM requests
- canvas sizing

These should be handled intentionally rather than hidden behind generic error messages.
