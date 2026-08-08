# GameBoyStudio

Play Game Boy and Game Boy Color homebrew in the browser. Pick a game, it starts
immediately — no ROM upload, no plugin, keyboard or controller.

**Live: https://gameboy-jet.vercel.app**

## Status

The core loop works: **discover → open → connect controller → play**.

- 20 games (12 Game Boy, 8 Game Boy Color)
- Real emulation via [binjgb](https://github.com/binji/binjgb) compiled to WebAssembly
- Keyboard and Gamepad API input
- Battery saves persist across reloads (14 of the 20 games have save RAM)
- Pause, reset, mute, fullscreen

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run verify:catalog` | Boots every ROM, checks input reaches the core, and round-trips every battery save |

## Saves

Games with battery-backed cartridge RAM save automatically; a brief "saved"
appears under the player. Saves live in `localStorage`, keyed per game, so they
are per-browser and lost if you clear site data. Reset keeps the save, the way
the reset button does on real hardware.

## Controls

| Action | Keyboard | Controller |
| --- | --- | --- |
| D-pad | Arrows or WASD | D-pad or left stick |
| A | `X` | East face button |
| B | `Z` | South face button |
| Start | `Enter` | Start / Options / Plus |
| Select | `Shift` | Back / Share / Minus |

Face buttons map by **physical position, not printed label**. On a Nintendo
layout this matches the printed A and B; on Xbox and PlayStation layouts the
east button (B / Circle) is Game Boy A. That is deliberate — see D-010.

## ROMs and licensing

Every ROM here is redistributable, and that claim is checked rather than assumed.

Candidates come from the [gbdev Homebrew Hub](https://hh.gbdev.io/), but its
license metadata is community-maintained, so each entry was verified against its
upstream repository. That audit cut the catalog roughly in half: of 31
candidates, 10 could not be verified and were excluded, and one more was dropped
because it does not run under binjgb.

Per-title licenses, authors, sources, and the full list of exclusions are in
[`public/roms/ATTRIBUTION.md`](public/roms/ATTRIBUTION.md).

No copyrighted commercial ROMs are included, and none will be.

## Architecture

Emulator specifics sit behind a small adapter so the UI never talks to a core
directly, and so other consoles can be added later.

```
src/
  app/         routes — library and /games/[slug]
  catalog/     game data + queries (committed, not fetched at build time)
  components/  GameBoyPlayer, GameCard
  emulation/
    core/      console-agnostic EmulatorAdapter contract
    gameboy/   binjgb adapter + module loader
  input/       keyboard.ts, gamepad.ts -> logical buttons
```

binjgb is not published to npm, so its WebAssembly artifacts are vendored in
`public/emulator/binjgb/`. Each emulator gets its own module instance — sharing
one across games corrupts the core.

Design and technical decisions, including the reasoning and the things that went
wrong, are recorded in [`DECISIONS.md`](DECISIONS.md).

## Tech

Next.js 16 (App Router) · TypeScript · Tailwind CSS · binjgb (MIT)
