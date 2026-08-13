# GBA_SPIKE.md

Branch `spike/gba-runtime`, off `main`. **Not for merge.** No production route,
no catalog entry, no change to the Game Boy player.

Question: can mGBA run a Game Boy Advance game behind the existing D-005 adapter
boundary, and what does adopting GBA actually cost?

Answer: **yes, and the cost is mostly outside the emulator** — headers, ROM
size, saves, and two extra buttons.

---

## What runs

**The Purple Night** (agb, MPL-2.0, 8MB) boots and plays at a measured
**59–60 fps** through `MgbaAdapter`, in Chrome on an M-series Mac.

Verified by looking at it and by reading the core's own framebuffer:

| Claim | How it was checked | Result |
|---|---|---|
| ROM boots and renders | core screenshot decoded, colour count | 240×160, 6–10 colours |
| Runs at full speed | `videoFrameEndedCallback` counted per second | 59.0–60.0 fps |
| Keyboard reaches the core | production `bindKeyboard`, ArrowRight and X | `right`, `a` held |
| GBA-only shoulders | KeyQ → `l` | `l` held |
| Touch reaches the core | pointerdown/pointerup on an on-screen button | `a` held, then released |
| Input changes the game | held RIGHT, then LEFT, screenshotting between | character moved each way |
| Pause stops the picture | two samples 600ms apart while paused | identical hash |
| Mute and volume | `setMuted`, `setVolume` | no throw, path exercised |
| ROM streaming | `content-length` progress | 8.0 / 8.0 MB reported live |
| Game Boy untouched | `npm run verify:catalog` on this branch | all ROMs boot, 14/14 saves |

`sampleScreen()` on the adapter is worth keeping whatever happens to this
branch. It asks the core for a PNG of what it drew and counts colours, so it
answers "is there a picture" without trusting the canvas — a WebGL canvas
without `preserveDrawingBuffer` reads back blank whether or not anything was
drawn, so canvas pixels are not evidence.

## What is NOT proven

Stated plainly, because a spike that overstates itself is worse than no spike.

- **Mobile performance. Not measured at all.** No device, and desktop numbers
  from a dev server say nothing about a phone. This was the single most
  important question and it is still open. It needs a real handset.
- **Gamepad.** No controller attached to this machine. The binding is wired to
  the production `bindGamepad` and L/R are polled at button indexes 4 and 5, but
  nothing has confirmed a pad reaches the core.
- **Audible audio.** `setMuted` and `setVolume` execute without error; nobody
  has heard anything. mGBA drives audio through `createScriptProcessor`, which
  is deprecated — worth knowing before this becomes a product path.
- **Save round-trip.** `readSave()` returns a 0-byte buffer for a game that has
  not saved yet. `loadSave()` writes into the emulated filesystem and reloads,
  which is the only route mGBA offers, and it has never been exercised against
  real save data. **This is the biggest untested area** and it is where D-013
  already needs rewriting.
- **Teardown.** `destroy()` is written to be idempotent; not stress-tested
  across mounts the way D-006 forced for binjgb.

## What cost hours, so it does not cost them again

**Cross-origin isolation, and then again for the workers.** This is a pthreads
build: the page needs `COOP: same-origin` + `COEP: require-corp`, and *the
worker script needs its own COEP header too*. Without the second one, every
pthread's fetch of mgba.js fails `ERR_BLOCKED_BY_RESPONSE`, and the module
factory simply never resolves — no error, no rejection, no console output. Both
header blocks are in `next.config.ts`.

**A blank canvas usually meant the browser was not compositing.** Most of the
debugging here chased a white canvas that turned out to be the automation
harness's browser pane being hidden — a hidden page does not paint, and the core
does not advance. Several intermediate diagnoses were made from that symptom and
were wrong: `locateFile`, `setStatus`, callback registration order and a missing
`resumeGame()` were each blamed, and none of them was the cause. Controlled
retests cleared all four. The code comments were corrected rather than left
telling a good story about the wrong thing.

That is the D-012 lesson arriving from the other side: last time a green test
hid a broken product, this time a broken environment invented four bugs that did
not exist.

## What adopting GBA would actually change

Small, in code:

- `ConsoleId` gains `'GBA'`, `GameRuntime` gains `'gba'`.
- `LogicalButton` grows from eight to ten. Every consumer must answer for L and
  R: `src/input/keyboard.ts`, `src/input/gamepad.ts`, the touch overlay, and the
  phone controller in D-016. The spike deliberately did **not** widen the shared
  union — it bound the shoulders separately — because that is a production
  change and this branch may not make one.
- `SCREEN_WIDTH`/`SCREEN_HEIGHT` are module constants at 160×144. GBA is
  240×160, a different aspect ratio. These have to come from the adapter, and
  the player chrome has to stop assuming 10:9.
- The adapter is *thinner* than `BinjgbAdapter`, not thicker: mGBA owns the
  canvas, the run loop and the audio. The D-005 boundary survived a core built
  the opposite way round, which is the most reassuring result here.

Larger, outside code:

- **COEP is a decision about the hosted origin, not a header.** The spike scopes
  COOP/COEP to `/spike/gba`. Applying it to the player route means every
  cross-origin subresource needs CORP — including the hosted-games iframe from a
  different origin (D-018/D-019). That contract has to be renegotiated before a
  GBA player ships, or GBA and hosted games cannot share a page.
- **ROM size breaks "play should be immediate."** Game Boy median in our catalog
  is 64KB. The Purple Night is 8MB; Skyland is 24MB. First frame here took
  ~9.3s, nearly all of it download. Progress reporting is in the adapter because
  without it that is a blank screen of unknown length. Hosting cost changes too.
- **D-013 does not survive.** GBA saves reach 128KB and the type (SRAM, Flash,
  EEPROM) is not reliably in the header. Base64 in `localStorage` against a ~5MB
  origin budget is not viable. IndexedDB, before the first GBA game with a save.
- **The heap is shared.** Pthreads means `FS.readFile` and `getSave()` hand back
  views onto a `SharedArrayBuffer`, which cannot go into a `Blob` or through
  structured clone. The adapter copies at both boundaries; anything else touching
  core memory must too, or it will throw at the moment a player's progress is
  written.

## Provenance

Core: `@thenick775/mgba-wasm@2.5.0`, MPL-2.0, an Emscripten build of a fork of
mGBA (`feature/wasm`, reporting `0.11-feature/wasm-9141-475686535`), vendored
into `public/emulator/mgba/` the way D-006 vendored binjgb. The npm package is
installed only to produce that copy; nothing imports it at build time.

Test ROMs are fetched by `scripts/fetch-spike-roms.mjs`, not committed:
MeteoRain (MIT), The Purple Night (MPL-2.0), Skyland (MPL-2.0). **No GPL
titles** — Apotris and Attack on Voxelburg are excluded pending a licensing
policy. None of the three has had the per-asset audit CONTENT_RESEARCH.md shows
is necessary for GBA homebrew, so none of them is a catalog candidate yet.

## If this goes forward

1. Measure on a real phone before anything else. Everything below is wasted if
   that fails.
2. Prove a save round-trip on a game that actually saves, and decide D-013's
   replacement.
3. Decide the COEP/hosted-origin question. It is architectural, not incidental.
4. Then, and only then, widen `LogicalButton` and the screen constants.
