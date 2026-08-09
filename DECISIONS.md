# DECISIONS.md

Use this file for durable product and architecture decisions.

## D-001: Atari 2600 First

Status: Superseded by D-007

Decision:
The first supported system is Atari 2600.

Note:
This decision was written into the original planning documents as a starting
assumption and was never deliberate. It conflicted with the product name and the
actual product intent. See D-007.

## D-002: Browser-First

Status: Accepted

Decision:
Games should run directly inside the website without requiring users to install a
native emulator.

## D-003: Controller Is Core

Status: Accepted

Decision:
Modern game controller support is part of the core player experience, not a future
enhancement.

## D-004: Authorized ROM Hosting

Status: Accepted

Decision:
The product experience assumes games can launch from platform-hosted ROM sources,
but only content the project has the legal right to distribute should be included.

See D-008 for how this is satisfied in practice.

## D-005: Adapter Boundary

Status: Accepted

Decision:
The UI should not directly depend on console-specific emulator APIs. Emulator
integration should sit behind a small adapter boundary so the product can later
support additional systems.

## D-006: Emulator Core

Status: Accepted — integration verified 2026-08-07

Decision:
Use binjgb (WebAssembly) as the Game Boy / Game Boy Color emulation core, behind
the D-005 adapter boundary.

Verification:
The integration risk noted below was retired by an end-to-end spike on Next.js
16.3 (Turbopack, App Router) running Tobu Tobu Girl:
- Headless Node harness: core ran 3 emulated seconds in 42ms — ~72x realtime
- In-browser: steady 60 fps, correct 4-shade DMG output, cart header parsed
- Keyboard input reaches the core; reset returns to boot with a fresh handle
- Teardown frees the handle and ROM allocation, cancels the loop, closes the
  AudioContext, and is idempotent; post-destroy calls are inert
- Audio buffers schedule when unmuted and stop when muted
- The .wasm is fetched once and cached; each emulator gets its own instance
- `/emulator/binjgb/binjgb.wasm` is served as `application/wasm`
- No emulator code reaches the homepage bundle

Not yet verified: audible audio output (the harness is headless), Safari and
Firefox behaviour, and gamepad input.

Context:
Supersedes an earlier draft of D-006 that recommended 6502.ts / Stellerator. That
recommendation was scoped to Atari 2600 and became void with D-007.

Options considered:

1. binjgb — RECOMMENDED
   - License: MIT
   - C compiled to WebAssembly; consistently outperforms JS Game Boy emulators
   - Actively maintained: commits through June 2026, multiple contributors
   - DMG, CGB ("hacky-but-passable"), and SGB support
   - Cartridge types MBC1, MBC3, MBC5 and others
   - Features already present: save/load battery backup, save/load emulator state,
     rewind and seek, per-channel audio control, fast-forward, pause, frame step
   - Used in production by gbdev's Homebrew Hub, which is meaningful third-party
     validation on exactly our workload
   - Weakness: not published on npm. Integration means building or vendoring
     `binjgb.js` + `binjgb.wasm` and wiring them as static assets. This is the
     main integration cost and must be proven before the adapter is built out.

2. WasmBoy
   - License: GPL-3.0-or-later — disqualifying for a proprietary product
   - npm `wasmboy`, latest 0.7.1, published 2022-03-25; effectively dormant
   - AssemblyScript/WASM, GB + GBC, full component coverage, good browser support
   - Would be the most convenient integration (real npm package) if the license fit
   - Viable only if the project itself becomes GPL-3.0

3. gameboy-emulator (npm)
   - License: ISC (permissive)
   - Latest 1.1.2, published 2022-05-05; dormant
   - TypeScript-written, but declares no types entry
   - Rejected: significantly less proven than binjgb on compatibility and audio

4. serverboy
   - License: GPL-2.0; built for headless/server use, not browser play
   - Rejected as the wrong category of tool

5. EmulatorJS (gambatte core)
   - License: GPL-3.0, bundled libretro cores separately copyleft
   - Ships its own player chrome, fighting both our design direction and D-005
   - Rejected on the same grounds as in the Atari research

Reason:
binjgb is the only option that is simultaneously permissively licensed, actively
maintained, and demonstrably good at GB/GBC emulation. WasmBoy is the more
convenient package and loses on license; the ISC alternatives lose on quality and
activity.

Consequences:
- No npm package means a vendoring step for the WASM artifacts. Resolved for now
  by vendoring the upstream gh-pages build into `public/emulator/binjgb/`; before
  shipping, build from a pinned commit with Emscripten instead.
- binjgb ships its own input handling and an on-screen touch gamepad. We will
  likely suppress those to keep normalization in `src/input/`.
- **A joypad callback must be installed or all input is silently discarded.**
  `set_joyp_*` writes into a joypad buffer that the core only reads once
  `_emulator_set_default_joypad_callback(e, _joypad_new())` has been called.
  Without it the games render perfectly at 60fps and respond to nothing. The
  upstream `simple.js` installs this inside its Rewind class, so skipping rewind
  as out-of-scope silently dropped input along with it. `_joypad_delete` on
  teardown. See D-012 for how this went unnoticed.
- **One module instance per emulator is mandatory.** Reusing a module across
  games traps: after `_emulator_delete` + `_free`, allocating a differently
  sized ROM corrupts the core and the next `_emulator_new_simple` dies with
  "memory access out of bounds". Found when navigating between two games of
  different ROM sizes, and reproduced headlessly outside React. The glue script
  and .wasm bytes are still fetched once and cached, so the repeat cost is
  instantiation only (~88KB).
- Save states and rewind come free. They are explicitly out of MVP scope, but the
  capability exists when we want it.
- Low-level C/WASM boundary means debugging is less pleasant than a TS core.

## D-007: Game Boy First

Status: Accepted

Decision:
The first supported systems are Game Boy (DMG) and Game Boy Color (CGB), together.

Context:
The original documents specified Atari 2600 while the product is named
GameBoyStudio. The Atari scope was an artifact of AI-drafted planning docs, not an
intentional product choice.

Reason for including GBC rather than DMG only:
- binjgb handles DMG and CGB in one core; excluding CGB saves no work.
- Of the legally clean launch catalog, 23 titles are GB and 8 are GBC. Dropping
  GBC discards roughly a quarter of an already small catalog for no benefit.
- Color artwork materially improves a library UI whose design direction depends on
  cover imagery carrying the color.

Consequences:
- The catalog must be console-aware from day one (`GB` vs `GBC`), which D-005 and
  the catalog design already anticipated.
- The input layer must treat A, B, START, and SELECT as first-class, not as the
  "later if needed" afterthought the Atari-shaped draft described.

## D-008: ROM Sourcing via Homebrew Hub

Status: Accepted — catalog built and verified 2026-08-07

Decision:
Source launch catalog ROMs from the gbdev Homebrew Hub database, filtered to
entries carrying an explicit permissive license.

Context:
D-004 requires that only legally distributable content ship. Homebrew Hub
(hh3.gbdev.io, `gbdev/database` on GitHub) is a community archive of Game Boy
homebrew with a public REST API and per-entry metadata.

Verified findings as of 2026-08-07:
- 1571 total entries; 656 GB, 440 GBC, 189 GBA, 23 NES
- 665 GB/GBC entries tagged as games
- Of those: 31 carry an explicitly permissive license, 11 are GPL-family,
  5 are non-commercial CC variants, and 618 record no license at all
- All 31 permissive titles have a playable ROM file
- Entry metadata maps closely onto our game model: title, slug, developer,
  platform, screenshots, files, license, description, tags, date, gameWebsite,
  repository

Reason:
The absence of a license field on 618 entries is the critical finding. "Available
on a public archive" is not a distribution grant. Filtering to explicit permissive
licenses is what makes D-004 actually satisfiable rather than assumed.

Consequences:
- Launch catalog is roughly 31 titles, not 1571. This is a real, playable library
  and is a better MVP than a placeholder test ROM.
- ROMs are served from `github.com/gbdev/database/entries/<slug>/<file>` at the
  `master` branch. The hh3 API exposes only `/api/entry/<slug>.json`,
  `/api/search`, and `/api/stats` — it does not serve binaries.
- We should mirror approved ROMs rather than hotlinking GitHub, per the storage
  abstraction the architecture already calls for.
- Attribution obligations vary by license (MIT and CC-BY-SA both require it). The
  game page needs an attribution surface.
- The 618 unlicensed entries are not lost — they are a backlog of authors who
  could be asked. That is correspondence, not engineering.

Resolution of the open item:
The 31 candidate licenses were each checked against the upstream repository. The
audit cut the catalog roughly in half, which vindicates treating Homebrew Hub's
license field as a lead rather than a warranty:

- 15 matched their recorded license exactly
- 3 were rescued by reading the repository's license file directly, which
  GitHub's detector had not classified (labirinth, europa-rescue, snake)
- 3 disagreed with upstream: the "5 mazes" family is recorded as CC-BY-SA 4.0 but
  the repositories carry MIT. Both permit redistribution; upstream wins
- 10 could not be verified — 5 have no repository linked, 5 have a repository
  with no license file — and are excluded

That left 21 titles. A boot test then removed one more (see below), for a
shipping catalog of 20: 12 Game Boy, 8 Game Boy Color.

Every ROM is additionally verified to boot and render before shipping, by
`npm run verify:catalog`. This caught Rex Runner GB, whose license is fine but
which renders a blank screen under binjgb despite a valid cart header — a core
compatibility gap, not a bad download. A correctly licensed game that does not
run is still not shippable.

Excluded titles and reasons are recorded in `public/roms/ATTRIBUTION.md`. The
unverifiable ones are a backlog of authors who could be asked, not a dead end.

## D-009: Visual Direction

Status: Proposed

Decision:
The interface draws on Game Boy hardware as a design language, not as a literal
reproduction.

Context:
The product should read as Game Boy without becoming a hardware mockup. The
original design direction explicitly warned against skeuomorphic console frames;
that warning stays useful even now that Game Boy is the subject.

Approach:
- DMG-derived neutrals as the foundation: the greys, not the greens
- The green LCD palette used as a deliberate accent, not as page chrome
- Hardware references expressed through proportion, spacing, and detailing
  rather than through drawn plastic
- Game artwork still carries the color

Avoid:
- A literal Game Boy shell framing the play area
- Green-on-green applied site-wide
- Pixel typography outside of accent use
- Heavy LCD ghosting or scanline filters enabled by default

Reason:
A hardware mockup constrains the play viewport, dates quickly, and works against
the premium-media-library positioning. Design language survives where costume
does not.

## D-010: Gamepad Mapping By Physical Position

Status: Accepted — verified 2026-08-07

Decision:
Map Game Boy A to the pad's **east** face button and B to the **south** face
button, using the W3C standard gamepad indexes, which are defined by physical
position rather than by printed labels.

Context:
Game Boy's A sits to the right of B. The standard mapping gives index 1 for the
east button and index 0 for the south button on every pad the browser
recognises.

Consequences:
- On a Nintendo-layout pad this coincides with the printed A and B.
- On an Xbox-layout pad, the button printed "B" acts as Game Boy A. This looks
  wrong on paper and is correct under the thumb, which is what matters. It is
  also the long-standing convention in emulators, including RetroArch's default.
- Mapping by label instead would mirror the buttons on one of the two layouts,
  so there is no option that satisfies both label sets.
- North and west face buttons are deliberately unmapped rather than aliased to
  A/B; aliasing invites accidental presses on a two-button console.

Other behaviour:
- The left analog stick drives the D-pad with a 0.5 deadzone. A digital D-pad
  substitute needs a firm threshold or diagonals chatter between directions.
- Start maps to Start/Menu/Options/Plus (index 9), Select to Back/Share/View/
  Minus (index 8).
- All connected pads are merged, so whichever one the player picks up works.
- Pads reporting a non-standard mapping still get the same index profile as a
  best effort, and the UI says the layout was not recognised rather than
  pretending the mapping is right.
- Disconnecting mid-press releases held buttons, so a yanked cable cannot leave
  the emulator with a button stuck down.
- No mapping UI and no persisted mappings yet — per the project rule, mappings
  are only worth persisting once there is a UI to edit them.

## D-011: Keyboard Matching And Scope

Status: Accepted — fixed a reported "keyboard does nothing" bug 2026-08-07

Decision:
Match key events on **both** `event.code` and `event.key`, and listen on
`window` rather than on the focused player element.

Context:
The first implementation matched only `event.code` and bound listeners to the
player div, which required the user to click the screen before anything worked.
Reported as keyboard input simply not working.

Reason for matching both:
- `event.code` is physical key position. It keeps WASD in the right shape on any
  layout, and is correct for direction keys.
- `event.code` alone breaks the letter-labelled buttons on non-QWERTY layouts.
  On AZERTY the key printed Z reports `code: "KeyW"`, so a user following the
  on-screen hint to press Z got nothing.
- Some environments do not populate `code` at all. Observed directly: real
  trusted keydown events arriving with `code: ""` and only `key` set.
- `code` is tried first so physical layout wins where both would match.

Reason for global listening:
- Requiring a click to focus an unlabelled div fails silently, which is
  indistinguishable from broken input.
- The risk the project rule warns about — breaking navigation and typing — is
  handled by ignoring events that target an input, textarea, select, button,
  link or contenteditable, and by ignoring anything with Ctrl/Meta/Alt held so
  browser and OS shortcuts pass through.
- `preventDefault` is called only for the arrow keys, whose default is scrolling.
  Everything else keeps its default, so Enter still activates a focused button.

Consequences:
- Arrow keys no longer scroll a game page. Wheel, space and Page Down still do.
- The play area stays focusable with `role="application"` for assistive tech,
  but focus is no longer required for input.

Follow-up fix, same day:
The first version of the guard treated every focusable element as off-limits,
which killed the entire keyboard as soon as anyone clicked Pause, Mute or the
Library link — focus stayed on the control and every key was ignored, with
nothing on screen explaining why. The guard is now narrow: text-entry elements
own all keys, but buttons and links own only their activation keys (Enter and
Space). Arrows and letters reach the game regardless of which control has focus.

Second follow-up:
Listeners moved from `window` bubble phase to `document` capture phase. In the
bubble phase any element between the target and the window can call
`stopPropagation` and silently kill game input — a dev overlay, a browser
extension, or a future component of our own. Capture runs first, so nothing can
intercept it. Verified against an element that deliberately swallows keydown.

The player also shows live input activity for both keyboard and gamepad. This is
a product affordance, not only a debugging one: "is my controller actually
doing anything" should be answerable by looking at the page.

Related bug fixed at the same time:
`togglePause` and `toggleMute` called `adapter.pause()` / `adapter.resume()`
inside a `setState` updater. React double-invokes updaters in development, so
the two effects fired back to back and the button toggled to nowhere. Side
effects now happen in the handler, not the updater.

## D-012: Verify Playability, Not Just Rendering

Status: Accepted — after shipping a catalog of unplayable games

Decision:
A game does not count as working until input has been shown to change what
happens on screen. `npm run verify:catalog` asserts this, not just that pixels
appear.

Context:
The joypad callback described in D-006 was missing for the entire build-out. The
result passed every check that existed: 20/20 ROMs booted and rendered, the
emulator held 60fps, keyboard and gamepad events reached `setButton`, and the
activity indicators lit up. Every layer reported success. The games were
unplayable the whole time.

How it survived so long:
- The boot test asserted "more than one colour on screen", which a title screen
  satisfies whether or not it can be interacted with.
- Manual checks were read too generously. Tobu Tobu Girl advances through an
  intro and an attract-mode demo on its own, and that motion was mistaken for a
  response to input.
- An early A/B test looked like proof but was invalid: the "pressed" run
  advanced 0.2s more emulated time than the control, so the screens differed for
  reasons that had nothing to do with the button. A test that cannot fail is
  worse than no test, because it is counted as evidence.

Consequences:
- Input assertions hold the button across an identical time window in both runs,
  so a difference can only come from the input.
- "It renders" is never reported as "it works" again.
- When a user says something does not work, their observation outranks a local
  check that says otherwise. Three rounds were spent fixing real but secondary
  input bugs — event `code` matching, focus scoping, capture phase — while the
  actual cause sat one layer below, because the layer below had a green test.

## D-013: Battery Saves In localStorage

Status: Accepted — verified 2026-08-08

Decision:
Persist battery-backed cartridge RAM to `localStorage`, keyed per game, written
on a short debounce after the cartridge reports a write.

Context:
14 of the 20 catalog games have battery RAM, including Aevilia (128K, an RPG).
Without persistence, closing the tab discarded all progress, which made part of
the existing catalog effectively pointless.

Reason for localStorage:
- Saves are 2K–128K; well within quota even for the whole catalog.
- No backend, per project scope.
- Synchronous read on mount means the save is in place before the first frame.

Behaviour:
- `_emulator_was_ext_ram_updated` drives an `onBatteryDirty` callback; the write
  is debounced 700ms because games write in bursts.
- Pending writes are flushed on unmount, `pagehide`, and `visibilitychange`, so
  closing or backgrounding the tab does not lose the last burst.
- A save whose size does not match the cartridge's RAM is rejected rather than
  partially applied — that combination means the save belongs to another game.
- Reset preserves the save, matching what the reset button does on real
  hardware, which is why the adapter retains it and reapplies after re-creating
  the core.
- The player shows a brief "saved" indicator, and "save failed" if the quota is
  exceeded, rather than failing silently.

Consequences:
- Saves are per-browser and per-origin. Clearing site data loses them, and there
  is no sync between devices. Acceptable while there is no backend.
- `reset()` now creates a fresh WASM module, like `loadGame` does. It had been
  reusing the existing one, which is exactly the pattern D-006 warns about; it
  survived only by accident until ext-RAM allocations made it trap.

## D-014: Platform Thesis And Input Philosophy

Status: Accepted 2026-08-08

Decision:
GameBoyStudio is an instant-play gaming platform for the web, built
controller-first, existing to remove the distance between wanting to play
something and actually playing it.

Three contracts, with different force:

- **Instant** — how the platform behaves. Binding. No install, no configuration,
  no signup to play, fast start, a direct link plays the game.
- **Controller-first** — how it feels. A strong default and a certification,
  **not** a prohibition. Every game declares required and supported input
  profiles. "Gamepad Native" means discoverable, launchable, playable, pausable,
  navigable and completable without another input device. First-party and native
  games must be Gamepad Native; the platform never forbids a game for using
  another interaction model.
- **Session-friendly** — what we curate toward. Philosophy, not a gate.

Content expansion and platform evolution are **separate roadmaps**. Content is
gated by legal supply; platform is gated by the previous rung. Adding consoles
is a legitimate content decision and is not postponed — it simply must not be
mistaken for platform progress.

Options considered:
Three candidate contracts were compared on what they permit, exclude,
differentiate, and how each affects the native runtime, multiplayer, AI creation
and ten-year durability. Constraining friction alone gives no creative identity;
constraining session scope is unenforceable; constraining input gives creators a
target, bounds the interaction space enough to make AI generation reliable,
makes local multiplayer natural, and is genuinely uncontested on the web.

Reason:
Two earlier drafts were rejected for the same underlying error — freezing a good
default into a permanent rule.

The first proposed an "eight-button constrained console": 8 inputs, a Game Boy
sized screen, tiny binaries, games finishable in one sitting. It was refuted by
our own catalog — Aevilia is a 128K-save RPG that the rule would have excluded.
The constraint described the sample, not the product.

The second corrected the axis from hardware to input but then declared that
keyboard, mouse and touch must be "optional additions, never requirements."
That would have banned asymmetric party games where one player holds a pad and
others use phones — a proven format. Identity does not require prohibition.

Consequences:
- Games need declared input profiles, which the catalog does not yet model.
- Discovery should be able to answer "what can I play with the controller in my
  hand", which requires those profiles as facets.
- The native runtime targets a modern gamepad vocabulary, not eight buttons.
- Multiplayer depends on native games: the retro catalog cannot deliver it,
  since link-cable play is absent from nearly all homebrew and unsupported by
  binjgb. PRODUCT_LAYERS was reordered accordingly.
- Emulator internals are barred from player-facing UI, which means removing the
  fps counter and input indicators currently shipped in the player.

## D-015: Native Runtime And GameBoyStudio Originals

Status: Accepted — M3 verified 2026-08-09

Decision:
Games written for the platform implement a small first-party contract —
`init`, `update`, `render`, with optional `serialize`, `restore`, `dispose` —
hosted by `NativeGameRuntime`. No third-party engine. The catalog is one shared
manifest for emulated and native titles, keyed on `runtime`.

Context:
M1 and M2 proved a person can find a Game Boy game and play it. Neither proves
anything only this platform can do: the retro catalog cannot deliver local
multiplayer, because link-cable play is absent from nearly all homebrew and
unsupported by binjgb (see D-014).

Options considered:
1. Adopt an existing web engine (Phaser, PixiJS, Kaboom). Fastest to a first
   game, and wrong for the thing being built: whatever we adopt becomes what
   creators and generated games target later, and an engine that owns the
   canvas and the DOM forecloses sandboxing. Also a dependency in a project
   with three.
2. Design a declarative game format now. That is the destination, but it cannot
   be designed before any game has been written. These two games are the
   research that earns it.
3. A thin first-party contract — CHOSEN. Small enough to hold in the head,
   ours to change, and it makes the host responsible for exactly the things
   every game otherwise gets wrong.

Reason:
The host owns the loop, normalized per-player input, edge detection, audio
unlock, mute, pause and when saves are read. A game supplies two methods. Both
Originals are dependency-free, which is what proves the contract is sufficient
rather than merely present.

Consequences:
- **BinjgbAdapter is not touched by any of this.** Its 466 lines carry the
  joypad callback, one-module-per-emulator and heap-view fixes, and the loop
  interleaves with them. The native runtime duplicates roughly forty lines of
  requestAnimationFrame and delta-clamping instead. If the two loops prove
  identical in practice, converging them is a boring refactor done when it is
  safe — not during the milestone that introduces native games.
- `InputRouter.set` is player-indexed and pads are assigned to slots by id, not
  by browser index. Retro collapses every player onto one joypad, so whichever
  controller someone picks up still drives a Game Boy game.
- Native games use the same eight logical buttons as retro, because that is
  what `src/input` produces today. D-014 points them at a wider gamepad
  vocabulary; widening it is a change to the input layer, and neither planned
  game needed it.
- `reset()` carries the save across, mirroring D-013 — a cartridge's battery
  survives pressing reset. A native game therefore serializes durable progress,
  such as a best score, rather than the state of the current run.
- The catalog's `console` becomes display metadata and `runtime` picks the
  host. The two overlap and could drift in data, so `verify:catalog` asserts
  they agree.
- Native code must never load on a Game Boy page. A Server Component that
  dynamically imports a Client Component does not code-split, so the split
  starts on the client side of the boundary. `verify:bundles` checks the built
  output rather than the source, matching user-visible strings because a
  minifier renames identifiers.
- Library art for Originals is authored, not captured. A native game has no ROM
  to run headlessly the way retro previews are generated, and a fabricated
  "screenshot" would be worse than an honest illustration.
- Two-player touch is deliberately not built. Two thumb decks on one phone is
  not a control scheme, so a two-player game on a touch-only device says so.

Verification:
`verify:native` plays both games headlessly through the runtime by reading the
canvas draw stream, and `verify:browser` plays them in Chromium by reading
pixels and pressing keys. Following D-012, each assertion was checked against a
deliberately broken build: removing the delta clamp, the pressed-edge clear,
the reset save carry, the player clamp, the slot assignment, or the dynamic
import each breaks the check that covers it.

## Template For Future Decisions

### D-XXX: Decision Name

Status: Proposed | Accepted | Rejected | Superseded

Decision:

Context:

Options considered:

Reason:

Consequences:
