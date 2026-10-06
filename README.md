# GameDex Studio

Describe the game you want to play. GameDex Studio searches its playable library
first, then offers experimental game creation when nothing fits. Play, ask for a
change, and keep the last working version while the next revision is checked.

For players with an idea and creators who want to keep shaping it. The library
includes browser originals and licensed Game Boy, Game Boy Color, and Game Boy
Advance homebrew.

**Existing deployment: https://gameboy-jet.vercel.app**

The display brand is GameDex Studio. Existing deployment URLs, package scopes,
environment variables, storage keys, and license identifiers retain their legacy
names for compatibility.

> **Deploying?** Read RELEASE_GBA.md first. The hosted-games Worker must be
> deployed before the app, and `npm run hosted:deploy` is not safe to run on its
> own — it uploads a build directory that does not match production.

## Status

The product loop is **describe → search the library → play a match or choose
creation → play → request a change → play again**.

- **Playable library:** curated browser originals and redistributable homebrew,
  with keyboard, controller, and touch support where each game supports it
- **Experimental creation:** Forge builds and checks a new game or revision. A
  failed revision never replaces the last working game
- **Configuration-dependent AI:** configured model access enables AI generation.
  Without it, the built-in synthesizer supports a limited set of game types;
  that mode is not AI generation
- **Creator offering:** pricing and usage limits are not finalized. The
  early-access form collects interest; it is not a subscription checkout

Game creation is a prototype that needs a Node.js host with child-process support
and writable project storage. A deployed library alone does not establish that
creation is configured or working on that deployment.

## Getting started

```bash
npm install
npm run sdk:build
npm run forge:build
npm run dev
```

Then open http://localhost:3000.

For repeatable local creation without model calls, run
`GBS_GENERATOR=synthesizer npm run dev`. Forge selects the model generator when
`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is available; `GBS_GENERATOR` can
explicitly select `synthesizer` or `model`. Keep credentials server-side.

Generated projects are stored under `.forge` by default (`GBS_FORGE_ROOT`
overrides it). The default creation check builds and bundles the game;
`GBS_FORGE_FULL_CHECK=1` also runs the browser conformance checks and requires
Chrome. Passing the default build gate is not a guarantee of gameplay quality.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint checks |
| `npm run verify:request-search` | Library-first request matching, relevance, and no-generation checks |
| `npm run verify:forge` | Creation, revision, and last-working-version checks |
| `npm run verify:catalog` | Boots every ROM, checks input reaches the core, and round-trips every battery save |
| `npm run verify` | Full verification pipeline, including the production build and browser checks |

## Early-access waitlist

The creator early-access landing lives at `/early-access`, linked from the studio
header. `/` opens the game-description flow and playable library; neither is
gated by the waitlist. The landing distinguishes experimental creation from the
live library and does not promise pricing or monthly quotas.

Signups post to `/api/waitlist`, which forwards `{ email, source }` to
whatever capture service is configured:

| Variable | Required | What it does |
| --- | --- | --- |
| `GBS_WAITLIST_ENDPOINT` | yes | POST endpoint that accepts JSON |
| `GBS_WAITLIST_TOKEN` | no | sent as `Authorization: Bearer …` |

With no endpoint set the API answers `503` and the form says registration is
not connected yet, rather than reporting a signup that was never stored.

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

The library and creation loop share the player surface. Emulator specifics sit
behind a small adapter so the UI never talks to a core directly. Generated games
live separately from the curated catalog, with a play pointer that only advances
after a revision passes its configured checks.

```
src/
  app/         studio, /games/[slug], /g/[id], /early-access, and API routes
  catalog/     game data + queries (committed, not fetched at build time)
  components/  library, retro/native/hosted players, and studio creation UI
  emulation/
    core/      console-agnostic EmulatorAdapter contract
    gameboy/   binjgb adapter + module loader
  input/       keyboard.ts, gamepad.ts -> logical buttons
  lib/         server-side Forge bridge
packages/
  forge/       generation, revision checks, and last-working play pointer
  sdk/         hosted-game runtime and creator tooling
```

binjgb is not published to npm, so its WebAssembly artifacts are vendored in
`public/emulator/binjgb/`. Each emulator gets its own module instance — sharing
one across games corrupts the core.

Design and technical decisions, including the reasoning and the things that went
wrong, are recorded in [`DECISIONS.md`](DECISIONS.md).

## Tech

Next.js 16 (App Router) · TypeScript · Tailwind CSS · binjgb (MIT)
