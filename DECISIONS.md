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

## D-016: Multiplayer Is An Input-Layer Concern

Status: Accepted 2026-08-10 — M4 direction

Decision:
The first networked multiplayer layer transmits **player input**, not frames and
not game state. A second device sends button edges into the host's
`InputRouter`; the host runs the only simulation and owns the only screen.

M4 is the first networked layer, not the final multiplayer system:
**Rooms + Phone Controllers + Network Foundation.**

Context:
M3 left the whole stack player-indexed — the router, the slot assigner, the
per-player input state and `NativeGameRuntime.setButton` all take a player index
— and Ring Out is a real two-player game. What is missing is not a concept of a
player; it is any path across a device boundary.

Meanwhile Ring Out is an honest dead end on a phone, because two thumb decks on
one screen is not a control scheme (D-015). That refusal is correct and it is
also the clearest thing the first networked layer can delete.

Options considered:

1. **Input transport — CHOSEN.** Button edges cross the wire; the host
   simulates and renders. Costs zero lines inside any game, any runtime, or
   `BinjgbAdapter`, because it lives below all of them. Works for retro and
   native alike for the same reason. Ceiling: one shared screen.

2. **Frame transport.** `canvas.captureStream()` to a WebRTC video track, input
   returning. Also needs no game changes, and unlocks different-places play. But
   it stacks encode + network + decode into a realistic 80–150ms round trip, and
   puts hard-edged 320×288 pixel art through chroma subsampling — degrading
   precisely what D-009 is about. Pause, reset and fullscreen all acquire remote
   semantics that have to be designed.

3. **State transport.** Both ends simulate: lockstep, or host-authoritative
   snapshots. Lockstep needs fixed-timestep determinism, but `GameLoop` is
   variable-dt and both Originals use float physics, so this is a rewrite of the
   runtime and both games. Snapshots need a new per-frame contract method, which
   taxes every game the platform will ever host. Retro can never participate in
   either.

Reason:
Option 1 is the only one that is free at the layer that matters. It is also the
format PLATFORM_DIRECTION already defended by name when it rejected an earlier
draft for banning "one player holds a pad, three others use phones."

Decisively: options 2 and 3 need everything option 1 needs — rooms, codes,
signaling, membership, disconnect handling, releasing held buttons across a
network partition — and none of that is cheaper to learn while also carrying a
video pipeline or a determinism rewrite. Option 1 is the cheapest way to find
out what networked play actually costs.

Consequences:
- **The ceiling is one shared screen.** This is not "play with a friend in
  another city", and the plan says so rather than implying otherwise. Choosing
  between options 2 and 3 happens after M4 ships, with measured latency in hand.
- `BinjgbAdapter` is not modified, for the same reason as M3.
- The `NativeGame` contract is not modified. Readiness and "waiting for player
  two" are player chrome with the runtime held paused, not game logic.
- A remote phone should be able to drive a **retro** game, since the network
  input layer sits below both runtimes. M4 verifies this as proof that the
  layering is real. It is a test, not a product surface: Game Boy is a
  one-player console and retro multiplayer is not in scope.
- Transport-agnostic is necessary but not sufficient. A room whose protocol only
  understands button edges boxes out options 2 and 3 even behind a swappable
  transport. The room is therefore defined as a session with typed channels —
  `input` implemented, `frames` and `state` reserved by name in the protocol
  version and rejected by the server. Reserving a name is not a stub; it makes
  the later addition additive rather than a redesign.
- `RemoteTransport` carries opaque framed messages and knows nothing about
  buttons, so WebSockets can be replaced by WebRTC DataChannels without the room
  protocol noticing.
- The invite flow (QR, short code, link) is the primary join model. Pad-join is
  the local fallback that reuses the same slot machinery.
- Slots stop being implicit: a lone pad may take either slot instead of always
  slot 0, and touch is no longer pinned to player 0.

## D-017: An Ephemeral Relay, And Nothing More

Status: Accepted 2026-08-10 — the project's first backend component

Decision:
Run a minimal room relay on Cloudflare Workers + Durable Objects with WebSocket
Hibernation: one Durable Object per room, ephemeral, no database, no accounts,
no stored gameplay.

Context:
PLATFORM_DIRECTION lists "netcode, rooms, presence" under *deliberately
postponed*, and its sixth proposed decision says to stay static and local-first
"until continuity or multiplayer demands otherwise." D-016 is that clause
firing. Recording it explicitly matters more than usual, because this is the
first server-side component in a project whose whole architecture has so far
been a static site with three dependencies.

Options considered:

1. **Cloudflare Workers + Durable Objects — CHOSEN.** One room maps exactly onto
   one object, so room lifetime is object lifetime and there is no room table to
   maintain. WebSocket Hibernation means an idle room costs nothing. Stays one
   small file.
2. **A small self-hosted Node or Bun WebSocket service.** Fewer new concepts, but
   we now operate a always-on process, and room state becomes something to
   manage rather than something the platform models for us.
3. **A managed realtime provider (Ably, Pusher, PartyKit).** Least code, but a
   paid dependency and a vendor in the gameplay path, in a project that has
   deliberately kept its dependency count at three.
4. **No server: manual WebRTC offer/answer exchange.** Requires copy-pasting SDP
   blobs between devices, which violates the Instant Contract outright.

Reason:
Signaling and relay are unavoidable once play crosses a device boundary, and
option 4 is the only serverless answer — it fails the one contract that is
binding. Among the rest, Durable Objects are the only option where "a room" is a
primitive the platform already has, which is what keeps the implementation
small enough to stay honest.

Transport: **relay first, WebRTC deferred.** Direct peer-to-peer on a LAN would
be roughly 2–5ms against 20–30ms through an edge relay. That is better, and it
costs ICE, candidate gathering, a connection state machine, and a fallback path
we would have to build regardless. For Ring Out's shoving physics the difference
is not the product. Latency is measured against the real relay before any UI is
built on it, and WebRTC is added only if the numbers justify it.

Measured 2026-08-10 against a local `wrangler dev`, 200 round trips
(`npm run measure:latency`): round trip mean 2.1ms, p50 1.7ms, p95 4.0ms — so
one way is about 1ms. That is the protocol and the runtime, not the internet: a
deployed Worker adds the trip to the nearest edge, which is the only term that
will matter. The useful conclusion is that **the relay design itself costs
nothing measurable**, so if remote play ever feels bad it will be geography, and
WebRTC is the answer to geography rather than to anything in this code. Re-run
the measurement against the deployed Worker before revisiting the decision.

Consequences:
- **The relay is payload-blind and stores nothing.** Six-character room codes,
  short TTL, lifetime tied to the host, strict server-side message schema, size
  and rate limits. It cannot be used as a general-purpose message relay, and it
  cannot grow into a social backend without a new decision.
- **Rooms are created only when a player asks to invite someone.** Single-player
  pages never contact the relay, so the static, local-first behaviour of every
  existing page is unchanged.
- A room code is a capability: whoever holds it can press buttons in that
  session. Six characters plus a short TTL plus host-bound lifetime is the
  entire security model, which is proportionate to the stake — there is no
  account and no persistent state to reach.
- Deployment gains a second target. The Next.js site stays static; the Worker
  ships separately.
- This does **not** un-postpone accounts, friends, lobbies, matchmaking,
  presence beyond one room, or cloud saves. Those remain postponed, and the
  existence of a Worker is not an argument for any of them.

## D-018: Hosted Games Arrive At Runtime, Not At Build Time

Status: Accepted 2026-08-10 — M5 direction

Decision:
A hosted game is described by a **runtime-loaded manifest** and executed by a
**sandboxed iframe** behind a third adapter, beside `BinjgbAdapter` and
`NativeGameRuntime`. Adding, changing or removing a hosted game must not require
rebuilding the GameBoyStudio application.

Context:
The platform already hosts one kind of game as data. A Game Boy title is a ROM —
an asset, fetched at runtime, interpreted by binjgb — and adding one is a row and
a file. Native games are the only kind that must be compiled in:

```ts
export type NativeGameId = 'drift' | 'ring-out';
```

That union type is the constraint. The catalog cannot grow without shipping the
site; M4's rooms seat four players while one game uses two and a fifth can only
arrive through this repository; and nothing outside this repo can be put on the
platform at all. Creator tools, publishing and AI creation each assume a place to
put a game that is not our source tree.

Options considered:

1. **A `runtime: 'hosted'` row in the compiled catalog — REJECTED.** This was the
   first proposal and it fails its own goal. `src/catalog/games.ts` is a
   TypeScript array compiled into the site, so the bundle would move out of the
   build while the catalog entry stayed in it: adding a game would still mean a
   code change, a Next build and a full redeploy. The catalog entry is what
   decides whether a game exists, so moving only the bundle proves nothing.
2. **A declarative game format — NOT YET.** D-015 called this the destination and
   named the two Originals as the research that would earn it. Collecting that
   research says otherwise: Drift is 503 lines of bespoke orbital gravity,
   particles, screen shake and hand-drawn vector art, and Ring Out is 482 lines
   of dash physics, restitution and round phases. A format able to express either
   would be a general-purpose engine; one that merely expressed both would
   generalise to nothing. More games and more genres must exist first — and they
   cannot while a game can only arrive by site deploy. The format now waits on
   this milestone rather than the reverse.
3. **Runtime-loaded manifest plus sandboxed frame — CHOSEN.** The smallest
   boundary that makes the goal true rather than nearly true.

Reason:
This removes a constraint rather than adding a feature. It is also the substrate
every later rung needs: creator tools publish something and AI generates
something, and both need somewhere to put it. Building an editor before this
boundary would be building the road before the ground.

Consequences:
- **The manifest carries only platform-controlled metadata, capabilities and a
  URL.** Never code, never markup, never anything a browser executes directly. It
  is validated before reaching the catalog or the player: strict schema, bounded
  sizes, `frameUrl` origin allowlisted, slug collisions with compiled games
  rejected, and one bad entry dropped rather than poisoning the document.
- **The compiled catalog renders first and never waits on the manifest.** The
  Instant Contract is binding, so a slow or dead hosted origin must not delay or
  break games that are already there. A failed manifest is a no-op.
- **`sandbox="allow-scripts"` without `allow-same-origin`** gives the frame an
  opaque origin, so it cannot reach our DOM, cookies or `localStorage`. No second
  application domain is needed for isolation.
- **Saves flow through the host**, because the sandbox has no usable storage.
  D-015 already made the host responsible for save storage, so the constraint and
  the design agree.
- **Input is unchanged.** `InputRouter` already merges keyboard, gamepad, touch
  and remote; the bridge is one more consumer, so an M4 phone controller drives a
  hosted game without new work.
- Hosted games keep `/games/[slug]` URLs. A separate URL shape would leak the
  runtime to players, which D-014 forbids. The server cannot know a hosted game
  exists, so an unknown slug renders a client resolver.
- Accepted trade: a hosted game's page metadata is generic, because metadata is
  generated at build time and the game is not known then.
- The retro and native catalogs are **not** migrated. Only hosted games use the
  manifest.
- The frame protocol's verbs are limited to what the player component already
  calls. A new verb requires a real game that needs it, or this becomes an engine
  by accretion.

Verification:
The milestone's goal is a test rather than a claim: with the application already
built and running, change the hosted artifact, redeploy only the hosted origin,
reload without a Next build, and see the change. Isolation is demonstrated by
attempting `parent.document`, `parent.localStorage` and `document.cookie` from
inside the frame and requiring each to be denied — a boundary nobody tried to
cross is not a boundary. Equivalence is checked by hosting Ring Out and Drift,
which between them cover the whole adapter surface, and requiring the existing
browser checks to pass unchanged. No new game content is written.

## D-019: The Hosted Origin

Status: Accepted 2026-08-10

Decision:
Hosted games and their manifest are served from a **static origin deployed
separately from the application**, and its contents remain curated by us.

Context:
D-017 committed the project's first backend on the promise that it stays
ephemeral, payload-blind and impossible to grow into a social backend. The hosted
origin is a second, different commitment and deserves its own entry rather than
being folded into the relay: the relay carries no payloads and stores nothing,
while this origin exists precisely to store and serve files.

Reason:
The application is deployed by Vercel, where `public/` is part of the build, so
anything served from it requires a rebuild — the exact constraint M5 exists to
remove. A separate static origin is therefore not a preference but the
requirement itself.

Consequences:
- **Curation is unchanged.** We decide what is on that origin, exactly as with
  ROMs under D-008, including the same licence and attribution discipline. M5
  does not let strangers put games on the site; it makes that possible later.
- The relay is not reused for this. Serving game files from it would contradict
  the promise D-017 was accepted on.
- A hosted game's files are built by their own build step, with their own entry
  point and output directory, and deployed by their own command. `next build`
  does not produce them and deleting `.next` does not affect them.
- The origin is on the allowlist the manifest validator checks, so a manifest
  cannot point the player's browser at an arbitrary third-party frame.
- **Artifacts are immutable and versioned; the manifest is the only mutable
  document.** A game's files live under a version in their path and are served
  `Cache-Control: public, max-age=31536000, immutable`, never overwritten. The
  manifest is served `Cache-Control: no-cache` — revalidate every time, not "do
  not store" — so an unchanged one costs a 304.

  This is what keeps the milestone's proof unambiguous. An update that appeared
  "eventually", or only after a hard refresh, would make the result depend on
  browser cache timing rather than on the boundary working. Because the manifest
  names a specific version, publishing is "add an artifact, repoint the
  manifest", rollback is "repoint the manifest back", and the two are the same
  action rather than one being a special case. The iframe URL carries the
  version, so a new version cannot be served from a stale document.

  Deliberately **not** a package registry: no resolution, no version ranges, no
  dependency graph, no publish API. A version is a path segment and the manifest
  is a pointer.
- Deployment gains a third target: the site, the relay, and this.
- Open, and deliberately not solved in M5: the manifest is fetched over the
  network and is trusted because it comes from an allowlisted origin over HTTPS.
  Signing or content hashing would harden that. It is not built yet because we
  are the only publisher; it must be revisited before anyone else is.

## D-020: The SDK Is The Authoring Boundary

Status: Accepted 2026-08-11 — M6 direction

Decision:
Games are authored against a **self-contained SDK package**, distributed as a
versioned tarball. A game's build must not reach into the application source.

Context:
M5 made a game able to exist without the application's build. It did not make
one able to exist without the application's repository. A hosted game today
imports `@/hosted/sdk`, which resolves only because the hosted build sets an
alias into `src/`, and the SDK itself takes `LogicalButton` from
`@/emulation/core/types`. Publishing means holding this checkout and Cloudflare
credentials.

That is the wall between M5 and anything creator- or AI-shaped, and it is also
the AI question one milestone early: a generator is exactly a creator who has
never seen the repository.

Options considered:

1. **In-repo package consumed by relative path.** Smallest change and proves
   nothing — a relative path is the alias problem with different syntax, and the
   proof would still be a build inside this repository.
2. **Publish to npm.** The eventual answer, but it commits to a public name and
   a versioning policy before either has been thought about, and it is a public
   act that cannot be quietly undone.
3. **A versioned tarball — CHOSEN.** Installed with `npm install ./gbs-sdk-x.y.z.tgz`,
   which copies rather than links. It is a real distribution boundary — the
   proof project has no path back to this repository — without committing to a
   public name yet.

Reason:
The tarball is the smallest thing that makes the proof falsifiable. A relative
import or a workspace link would leave the application source reachable, and a
build that still works because something is reachable is not evidence.

Consequences:
- The SDK owns the frame protocol and its own button vocabulary. The application
  imports the package rather than the reverse, so there is one definition and
  no drift between host and guest.
- The proof game lives in a **separate project outside this repository**: SDK
  installed from the tarball, no `@/` aliases, no imports from `src/`, no
  workspace resolution, no symlinks back. After installation its build must not
  touch the application source at all.
- The SDK ships a **preview host** — a minimal page implementing the host side
  of the protocol — so a creator can play their game with nothing but the SDK.
  It is explicitly not the full player: no library, no rooms, no `InputRouter`.
  A preview that pretended otherwise would send people to publish games that
  behave differently in the product.
- Public naming, versioning policy and npm publication are deliberately deferred.
- Curation is unchanged. This makes a game *makeable* by someone else; it does
  not make it *publishable* by them. There is no upload path, so there is
  nothing to moderate.

## D-021: Protocol Versions Are A Compatibility Contract

Status: Accepted 2026-08-11

Decision:
The host supports the **current frame protocol version and the previous
supported one**. A bundle outside that range is refused **before play**, with a
reason, rather than failing during it.

Context:
While every hosted game was built from this repository, a protocol change was a
refactor: change both sides, redeploy, done. The moment a game exists that we
did not build, that stops being true. Its author does not control our deploys,
so a protocol change we ship is a game of theirs that breaks.

Reason:
Supporting exactly one version makes every protocol change a flag day for
everyone else's work. Supporting all versions forever makes the protocol
un-evolvable. Two is the smallest window that gives an author a real chance to
rebuild between our releases.

Consequences:
- `hello` already carries the version, so the host can refuse at handshake —
  the check exists and this decision is about what it does.
- The SDK version is recorded in the manifest entry, so an incompatible bundle
  is caught by `gbs check` and by manifest validation, before a player ever
  loads it. Failing at validation is the point: a game that fails mysteriously
  mid-session is indistinguishable from a broken platform.
- Dropping a version is a deliberate act with a note, not a side effect of a
  refactor.
- This is the real cost of M6, and it is named at the start rather than
  discovered in M7.

## D-022: Conformance Checks The Contract, Not The Game

Status: Accepted 2026-08-11

Decision:
`gbs check` verifies that a bundle honours the frame protocol and its own
declared capabilities. It does not judge gameplay, and it does not require that
input produce any particular visible effect.

Context:
An earlier draft of this check required that "input moves something". That is
action-game bias dressed up as a standard: a turn-based game, a text game, or
one that only acts on release would each fail it while being perfectly
well-formed.

Reason:
The platform's legitimate interest is whether a game is well-formed — whether it
handshakes, whether it decodes input correctly, whether its declared
capabilities are true, whether it stays inside the sandbox. Whether input
produces a particular response is the game's own claim about itself, and belongs
in the game's own test.

Consequences:
- Input conformance is asserted at the layer where it is universal: the host
  sends a button, and the SDK's input state reflects exactly that. Delivery and
  decoding are checked; interpretation is not.
- Declared capabilities are checked against behaviour, so the manifest cannot
  lie: a game claiming `saves` must produce and restore bytes, and one not
  claiming it must produce none.
- `gbs check` reports that a game is well-formed and says plainly that it is not
  a judgement of quality, so a passing result is not mistaken for approval.
- The proof game carries its own browser test asserting visible response, which
  is where that assertion belongs.

## D-023: A Toolbox, Not A Format

Status: Accepted 2026-08-12 — M7 direction

Decision:
Generated games compose GameBoyStudio primitives from a **toolbox** shipped in
the SDK. A primitive earns its place only by having been independently
reimplemented in at least two shipped games. No speculative engine, no framework,
and no declarative format work.

Context:
M7 is to generate *within a GameBoyStudio game system* rather than produce
arbitrary web pages. But D-018 deferred the declarative format on evidence
grounds and that has not changed — three authored games is still too few.

The distinction that resolves it:

- A **format** is declarative data a runtime interprets. It constrains what a
  game *can be*. Designing one now would be guessing.
- A **toolbox** is a library a game *may call*. It constrains nothing, but a
  generator composes known parts instead of reinventing them.

Reason:
The toolbox is derived rather than invented. Across Drift, Ring Out and
Sequence, each of these was written three separate times, slightly differently:
a phase machine with a timer, elapsed-time accumulation from `dt`, text and
rectangle drawing at a fixed resolution, a versioned serialize/restore for a
best score, and randomness.

That duplication is what makes a toolbox earned. It is also precisely what shows
a format is not: nothing in that list says what a game *is*, only what games
repeatedly need.

Consequences:
- **The rule is a gate, not a guideline.** A new primitive requires a game that
  already needed it. Anticipating what a generator "will probably want" is how a
  toolbox becomes an engine.
- The toolbox ships in the SDK, so creators get it too. It is the game system,
  not an internal helper.
- **Drift, Ring Out and Sequence are not migrated onto it in M7.** They are the
  evidence it was derived from, and rewriting working code would be churn
  against three milestones of verified behaviour.
- What generated games reach for — and what they reinvent *despite* the toolbox
  offering it — is the empirical input the eventual schema should be designed
  from. The toolbox is how the format gets earned.

## D-024: A Generated Game Is A Project With Append-Only Revisions

Status: Accepted 2026-08-12

Decision:
A generated game is a durable **project** with an ordered, append-only list of
revisions. Each revision records its parent, the request in the person's own
words, the spec that request produced, a source snapshot, the artifact version
it built to, its conformance verdict, and a status of
`generating | checking | repairing | ready | failed`.

`currentRevision` advances **only** when a new revision reaches `ready`.

Context:
Generating a game once is stateless and easy. The milestone's actual claim is
the second half of the loop — that a follow-up request modifies *that same
game* — and that is impossible without the game being a durable thing with a
history.

Reason:
Two rules do the work.

**Revisions are added, never edited.** Every attempt keeps its own source and
its own verdict, so a failed attempt is a record of what was tried rather than
the loss of what worked.

**The current pointer moves last.** While a follow-up is generating, checking or
repairing, the previous version stays playable — and if the new one fails, it
stays playable permanently. A person who asks for a change and gets a broken
game has lost their game; that must not be possible.

Consequences:
- This is the same shape M5 already uses for publishing (D-019): a new immutable
  version is built beside the old one and a pointer moves at the end. Iteration
  and publishing turn out to be the same mechanism, which is why a generated
  game is already publishable without inventing distribution.
- Persistence is **local and project-scoped** — a directory on disk. No
  accounts, no cloud, no database. Those are deliberately out of scope, and
  nothing here forecloses them: a project id is the seed of shareability later.
- A failed revision is kept rather than discarded. It is the record of what a
  generator could not do, which is the research the corpus run depends on.
- Status is explicit rather than inferred, so a project interrupted mid-run is
  in a state that can be read rather than guessed at.

## D-025: The Model Boundary Is Built, The Model Is Not Chosen

Status: Accepted 2026-08-12

Decision:
Generation sits behind a `GameGenerator` adapter with two implementations: a
**synthesizer** that composes a game from a spec using the toolbox, with no
model and no cost, and a model-backed one that is **deliberately not selected or
called in M7**.

Context:
The milestone must prove the loop end to end without spending anything or
committing to a provider.

Reason:
The synthesizer is not a stub. It genuinely turns a request into a game, so the
pipeline is provable for free — and a stub returning canned files would have
made the proof hollow, since the pipeline would never have been exercised.

Building it is also research in its own right. A rule-based composer over the
toolbox is a proto-schema: where it strains to express a request is exactly
where a declarative format would strain, and that is evidence no amount of
design discussion produces.

Consequences:
- Swapping in a model must change **only** the adapter. That is a verification
  item, not an intention.
- The synthesizer path has a stated budget: **under 20 seconds** from request to
  playable, with generate, build, check and reload timed *separately* so a
  regression is attributable to a phase rather than to the whole.
- Real-model latency is measured separately, when one is chosen. It is additive
  to this budget, not a replacement for it.
- Provider, cost ceiling and where inference runs are decided later, on their
  own merits, rather than as a side effect of building the loop.

## D-026: Game Boy Advance, Behind The Same Boundary

Status: Accepted — integrated and verified 2026-08-12

Decision:
Support Game Boy Advance using mGBA (MPL-2.0) compiled to WebAssembly, behind
the D-005 adapter boundary, as a third runtime alongside `gb` and `gbc` — not as
a second player, a second catalog, or a console-first navigation.

Context:
CONTENT_RESEARCH.md found the Game Boy catalog was thinner than it looked and
that GBA was the only nearby console with genuinely strong permissively licensed
homebrew. GBA_SPIKE.md proved the core runs before any of this was built.

Consequences, in rough order of how much they cost:

- **The app is now cross-origin isolated, site-wide.** The mGBA build uses
  pthreads, so it needs SharedArrayBuffer, so the document needs COOP+COEP.
  Scoping that to the player route is impossible: hosted games and GBA games are
  both `/games/[slug]`. So every cross-origin subresource must now opt in. The
  only one we have is the hosted-games origin (D-019), which now sets CORP and
  COEP on its own responses. **Deploying the app without deploying that Worker
  breaks every hosted game.** The order and the hazard in the Worker's own
  deploy step are written up in RELEASE_GBA.md.
- **`LogicalButton` is ten wide, not eight.** L and R are produced by the
  keyboard (Q/E) and gamepad (bumpers and triggers) bindings for every console,
  and dropped by the adapters that have nowhere to send them. The input layer
  stays console-agnostic, which is what ARCHITECTURE.md asks of it. The touch
  deck renders shoulders only when the console has them.
- **The SDK's button vocabulary did not widen with it.** Hosted and native games
  are authored against eight buttons (D-020, D-021); a shoulder press has no
  meaning there. The compile-time check that the two vocabularies match is now
  one-directional, and `toGbsButton` narrows at the boundary.
- **Screen size comes from the console.** 240x160 is a different aspect ratio
  (3:2) from the Game Boy's 10:9, so the canvas, the handheld layout and the
  library tiles all read `--gbs-screen-aspect` instead of assuming.
- **Saves move to IndexedDB above 64KB.** GBA saves reach 128KB; base64 in
  localStorage against a ~5MB origin budget would fail exactly when a player's
  progress is written. Game Boy saves are unchanged. `hasSave` stays synchronous
  via a marker key, because the Continue shelf asks during render. This
  supersedes D-013 for large saves.
- **ROMs are two orders of magnitude bigger.** 64KB median on Game Boy against
  8MB for The Purple Night. The adapter streams with progress; "play should be
  immediate" now has a caveat that only measurement on real connections can
  settle.
- **`verify:catalog` cannot boot a GBA ROM.** mGBA is browser-only, so the Node
  harness header-checks GBA entries and says so in its output rather than
  quietly passing them.

Rejected alternatives:
NanoBoyAdvance and VBA-M (GPL, disqualifying on the same grounds D-006 used for
WasmBoy); EmulatorJS (GPLv3, and ships player chrome that fights D-005 and
D-009). The core is `@thenick775/mgba-wasm`, a fork rather than upstream mGBA,
whose own WebAssembly port is not expected before 2027 — the same vendoring
tradeoff D-006 accepted for binjgb, one notch worse.

## Template For Future Decisions

### D-XXX: Decision Name

Status: Proposed | Accepted | Rejected | Superseded

Decision:

Context:

Options considered:

Reason:

Consequences:

## D-026: The Home Is A Ranked List Of Shelves

Status: Accepted 2026-08-12

Decision:
The homepage is composed from shelves that each declare when they apply and how
strongly they want the top, given local state. Nothing about their order lives
in the page's markup. The ask sits above the ranking and is not a shelf.

Context:
GameBoyStudio is becoming a place where you ask for a game, but it is also a
catalog of curated retro titles that works today and is most of what a first
visitor sees. Writing the page as *ask, Continue, Your games, then the grid*
would put the catalog's prominence into the layout — and the day generated play
outgrows it, the page would have to be rebuilt rather than reordered.

Reason:
The prominence of the catalog is a **consequence of state**, not a decision. On
a first visit nothing else applies, so the catalog leads, which is correct. Once
someone has games of their own it drops below them, and once something is being
made that leads. Same file, no rewrite.

Consequences:
- A shelf that renders nothing must not rank. `played` is counted the same way
  the Continue shelf decides what to draw, or the ranking could place an empty
  shelf above the fold.
- `making` has no node of its own: a game being made is the "Your games" shelf
  in a different state, and the transition should be a change of state rather
  than a jump between two lists.
- The weights are an argument, not a constant. They are meant to be edited when
  the product learns something, which is the whole point of putting them in one
  small file.
- This is explicitly a prototype's home, not the permanent product. What it
  protects is the ability to change its mind.

## D-027: A Share Pointer, And Ownership Without Accounts

Status: Accepted 2026-08-12

Decision:
Each generated project has one small server-side pointer: `projectId`, `title`,
the current ready artifact, `updatedAt`, and `visibility: 'unlisted'`. It is
written in exactly one place — `promote()` — and therefore can only ever name a
revision that reached `ready`.

A share URL is `/g/<id>`. Whoever opens it plays the game; the change controls
appear only for the browser that asked for it.

Context:
Sharing is the last step of the loop and the first thing that cannot live in
localStorage: the person opening the link has no device state. That forces the
smallest possible piece of server-side truth, and the temptation is to make it a
project system with accounts and publishing attached.

Reason:
Five fields answer the only question a link asks — *what do I load?* — and
answer it with the last version that worked. Because `promote()` is the sole
writer, a link shared an hour ago keeps playing while its owner is mid-change or
has just broken something. That property is structural rather than remembered.

Ownership is whether this browser is the one that asked. There are no accounts
to check, so the honest options were to gate on nothing or to gate on what is
actually known. It fails in the harmless direction: the worst case is that
someone sees change controls for a game they already have the link to.

Consequences:
- Unlisted, and marked `noindex`: a shared link must not become a search result.
- Generated games are served from the app, never through the hosted manifest
  (D-018). They are personal, not curated, and must not reach the catalog.
- They live at `/g/<id>`, not under `/games/`. Putting them on the catalog's
  route would be the first step toward putting them in the catalog.
- Losing the browser loses the index of your games, not the games. That is a
  meaningfully better failure than pure-localStorage, and it is the reason the
  pointer exists at all.
- Nothing here is publishing. There is no discovery, no listing, and no way for
  a generated game to appear to anyone who was not given the link.

## D-028: The Model Writes The Game

Status: Accepted 2026-08-12

Decision:
`claude-opus-5` behind the `GameGenerator` interface, writing the game's
TypeScript source directly against the SDK. The synthesizer stays as the
no-credentials implementation and is what the test suite runs against. Selection
is by environment: the model when credentials exist, the synthesizer otherwise,
and `GBS_GENERATOR` overrides both.

Context:
M7 built the loop around a spec of named knobs and a synthesizer that composed
games from it. That proved the loop end to end and found its ceiling in the same
motion: the spec could express five kinds of game, and every request outside
them was recorded as "not understood". The honest reading of M7_FINDING.md is
that the format was the bottleneck, not the plumbing.

Reason:
**A spec cannot be widened into free text.** Each new knob is a new synthesizer
branch, and the requests people actually make — "a game where you tend a
lighthouse in a storm" — are not more knobs. Generating source instead moves the
expressiveness ceiling from what we anticipated to what the SDK can express,
which is the boundary M6 built for exactly this.

**Capability over cost, for now.** The failure mode that matters at this stage
is a game that does not work or is dull, not a slightly expensive one. Effort is
`xhigh`, the documented setting for coding work. This is a decision to revisit
with usage data, not a permanent position.

**Conformance is what makes it safe.** Nothing about generated source is
trusted: it compiles, bundles and passes `gbs check` before the pointer moves,
and a failure leaves the previous version playable (D-024). The model is a
better author, not a shortcut past the gate.

Consequences:
- The `kind` field on a spec is now a label rather than a switch. Nothing
  branches on it, because there is no longer a synthesizer to branch.
- The SDK contract given to the model is prose, not generated types — the model
  needs the constraints, not just the shapes. Prose cannot be type-checked, so
  `verify:forge` asserts every symbol it names is really exported. Renaming an
  SDK export without updating the guide is a test failure rather than a silent
  drift into confidently wrong code.
- The guide is the cached prefix of every request, so nothing per-request may be
  interpolated above it.
- `forgeNew` no longer generates twice. It did, harmlessly, to name the project
  before running the revision; with a real model that is a second paid
  generation which is not even guaranteed to produce the same game.
- Requests are logged, successes and failures alike, with the failures carrying
  the checks that rejected them. This is the research record: the projects on
  disk only preserve the requests that worked.
- The test suite must never need a key. Without credentials the synthesizer runs
  the whole loop for free, and `GBS_GENERATOR=synthesizer` keeps a developer who
  has a key from spending it on a test run.
- Refusals are handled as a clear message rather than with a server-side
  fallback model. Game generation does not go near the categories the
  classifiers target, and the plumbing would sit on top of streaming and
  structured outputs for a case that should not arise. If it does arise in
  practice, `fallbacks` is the fix.
