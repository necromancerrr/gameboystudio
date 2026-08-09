# M1_PLAN.md — "A place to play"

Working plan for milestone 1. Supersedes the sequence in the M1 audit.
Not strategy — see PLATFORM_DIRECTION.md for that.

## Goal

A stranger lands, sees games in motion, understands in one line what this is,
picks something on impulse, and is playing within ~10 seconds — never seeing the
word "emulator", a frame counter, or a keyboard mapping table.

On a phone, they play. There is no dead end.

## Sequence

| | Step | Why here |
| --- | --- | --- |
| S1 | Strip emulator / debug UI from the player | Cheap, and cleans the component before it is restructured |
| S2 | Boot and loading experience | Same component, same pass |
| S3 | **Handheld Mode** — mobile play | A visitor who cannot play is a correctness failure, not a polish gap |
| S4 | Library hierarchy, curation, search | Discovery matters once play works everywhere |
| S5 | Gameplay preview generation | Highest delight, highest curation cost, lowest correctness risk |

S1 and S2 should be done as one pass. They touch the same file and neither is
large.

---

# Handheld Mode

**Principle: on mobile, do not shrink the desktop player. Turn the phone into
the controller.**

Classic handheld ergonomics as inspiration. Not a hardware replica — the phone
is already the shell. Our own visual language, consistent with D-009 (DMG-derived
neutrals, LCD green as accent, no drawn plastic).

## 1. Portrait — the primary layout

```
┌─────────────────────────┐
│  ‹ back        ⋯ menu   │  minimal, fades during play
├─────────────────────────┤
│                         │
│      GAME DISPLAY       │  10:9, full width, centred
│      (letterboxed)      │  takes all remaining height
│                         │
├─────────────────────────┤
│                         │
│    ▲              ⒷⒶ    │  D-pad left · actions right
│  ◀ ✛ ▶           Ⓑ Ⓐ    │  A upper-right, B lower-left
│    ▼                    │  (matches thumb roll)
│                         │
│      ▭ SELECT  ▭ START  │  smaller, central, low frequency
│                         │
│    ── safe area ──      │  env(safe-area-inset-bottom)
└─────────────────────────┘
```

**Proportions are derived, not hardcoded.** The control deck gets an ergonomic
height (`clamp(200px, 34vh, 300px)`) driven by touch-target maths; the game
takes the remaining space and letterboxes to 10:9. On a tall phone the game ends
up around 55–60% — but as an outcome, not a constant.

## 2. Landscape — its own layout, not a rotation

A useful property of the 10:9 aspect: on a landscape phone the game is
height-constrained, which leaves genuine side gutters exactly where thumbs rest.
**No overlay on the game is needed.**

```
┌───────────────────────────────────────────────┐
│         ┌───────────────────────┐             │
│    ▲    │                       │      ⒷⒶ     │
│  ◀ ✛ ▶  │     GAME DISPLAY      │     Ⓑ Ⓐ     │
│    ▼    │   (full height, 10:9) │             │
│         │                       │             │
│ ▭SELECT └───────────────────────┘  ▭START     │
└───────────────────────────────────────────────┘
```

Controls sit in the gutters, biased low toward the natural thumb arc. If a
device is short enough that gutters get tight, controls become translucent
overlays anchored to the bottom corners rather than shrinking the game.

## 3. Control sizing and thumb ergonomics

- **Minimum 44px** hit target (Apple HIG); 48px preferred (Material).
- Action buttons ~60–64px diameter, D-pad ~140px overall with each direction ≥48px.
- **A upper-right, B lower-left**, diagonally offset. This matches the natural
  thumb roll and mirrors the hardware convention players already have in muscle
  memory.
- ≥8px dead space between distinct controls to reduce mis-hits.
- Start/Select are pills, smaller, central, deliberately harder to hit by accident.
- Hit areas may exceed visual bounds — the drawn button can be smaller than the
  region that responds.
- Scale down on small devices but **never below 44px**; sacrifice game area first.
- Bias everything toward the bottom corners. The centre-bottom is the worst
  place for anything frequent.

## 4. Touch event strategy

**Pointer Events, hit-tested at the deck level — not per-button handlers.**

Per-button `onTouchStart` cannot express the two things that make a touch d-pad
feel right: sliding between directions without lifting, and rolling from B to A.

- One `pointerdown/move/up/cancel` handler on the deck container.
- Maintain `Map<pointerId, Set<LogicalButton>>`; hit-test on every move.
- Diagonals: D-pad divided into 8 zones, so up-right presses both.
- **No `setPointerCapture` on individual buttons** — capture would defeat sliding.
- `touch-action: none` on the deck; `user-select: none`;
  `-webkit-touch-callout: none`; `overscroll-behavior: none` on the page.
- Release everything on `pointercancel`, `pointerleave`, window blur, visibility
  change and orientation change. A finger mid-press that stops being tracked must
  never leave a button stuck down.

## 5. Simultaneous inputs — requires one architecture change

**This is the only architectural change in M1.**

Today `bindKeyboard` and `bindGamepad` each call `adapter.setButton` directly,
so state is last-writer-wins. Hold Left on a gamepad, then tap and release Left
on touch, and the release cancels the gamepad's hold. This is latent today and
becomes live the moment touch exists — and specifically during
controller-connect transitions, which is exactly when it will be noticed.

Introduce a small **input router** that owns per-source state and writes the
union to the adapter:

```
keyboard ─┐
gamepad  ─┼─→ InputRouter (OR per button) ─→ adapter.setButton
touch    ─┘
```

Small, additive, and it makes `releaseAllFrom(source)` trivial — needed when
touch controls hide, when a pad disconnects, and on orientation change.

## 6. Controller connect / disconnect transitions

**On connect:** release all touch-held buttons → fade the deck out (~200ms) →
game grows into the reclaimed space → brief toast, then gone. No permanent
status line.

**On disconnect:** deck fades back in. No toast, no pause, no modal. Gameplay is
not interrupted.

Debounce ~500ms so a flaky Bluetooth reconnect does not thrash the layout. If a
pad is connected but the player taps the game area, bring touch back — last-used
input wins.

## 7. Orientation changes

- Layout switches via **CSS**, not JS, so it is instant and cannot fail.
- **The emulator must not remount.** The player effect keys on
  `[romUrl, consoleId, saveKey]`, so layout changes are safe today — this must
  stay true. A rotation that resets the game is a serious bug.
- Release all touch buttons on change; fingers are now over different regions.
- Recompute deck metrics from `visualViewport` where available.
- Explicit test: rotate mid-game, confirm the game continues unaffected.

## 8. How the game screen resizes

- Canvas stays **160×144 internally**, always. CSS scales it.
- `image-rendering: pixelated`, `aspect-ratio: 10/9`, fit within the available
  box via `object-fit: contain`.
- Size with CSS, not JS measurement, to avoid layout thrash on rotate.
- Non-integer scaling accepted on mobile — integer-only would waste too much
  screen. An "integer scale" preference can come later for purists.

## 9. Mobile browser limitations

| Limitation | Consequence |
| --- | --- |
| **iPhone Safari has no Fullscreen API for elements** (iPad does) | Cannot rely on browser fullscreen. Decides §10 |
| `100vh` includes browser chrome | Use `100dvh` / `100svh` |
| AudioContext needs a user gesture | The Play tap *is* the gesture — a design win, not a workaround |
| iOS silent switch can mute WebAudio | Audio may be silent through no fault of ours; do not claim it works |
| `navigator.vibrate` unsupported on iOS Safari | Haptics are Android-only. See §11 |
| Background tabs throttle rAF | Pause the emulator on `visibilitychange` — correctness *and* battery |
| Double-tap zoom, pull-to-refresh | `touch-action`, `overscroll-behavior`, viewport meta |
| Gamepad API on iOS | Supported in recent Safari for MFi/Xbox/PS pads — verify on device |

## 10. Browser fullscreen vs app-level immersive

**Decision: an app-level immersive layout. Browser fullscreen only as an
enhancement where supported.**

Reasoning: iPhone Safari cannot fullscreen a non-video element, and that is the
single most important mobile browser to get right. A layout-driven immersive
mode is deterministic, testable, works identically everywhere, and needs no
permission or gesture.

So: **tap Play → Handheld Mode**, automatically. The player never learns that
"fullscreen" was involved. Desktop keeps its optional fullscreen button.

## 11. Haptic feedback

Progressive enhancement only.

- `navigator.vibrate()` — works on Android Chrome, **not on iOS Safari**. There
  is no reliable web haptic API on iPhone; the known workarounds are hacks and
  should not ship.
- ~8–12ms pulse on **press only**, never on release, never on auto-repeat.
- Action buttons only. Vibrating on every D-pad direction is noise.
- Feature-detect, fail silent, and expose a toggle once there is a settings
  surface. Never let haptics gate anything.

Visual depression feedback is the real feedback channel and must be excellent on
every device: immediate scale/tint change on press, no transition-in delay.

## 12. Evolving toward richer controller inputs

Handheld Mode should be **driven by the game's declared input profile**, not
hardcoded to eight buttons.

For M1 every game is Game Boy, so the deck is fixed. But the component should
take a control-layout descriptor from the start, so that later:

- A game needing sticks gets virtual sticks.
- A game needing triggers gets trigger zones.
- A game whose required inputs **cannot** be expressed on touch says so
  honestly — "this one needs a controller" — instead of presenting an overlay
  that cannot work.

This is exactly the payoff of the input-profiles decision in D-014: touch is a
*mapping* of the platform input vocabulary, and when a mapping is impossible the
platform can say so instead of failing silently.

---

## Per-step detail

### S1 — Strip emulator / debug UI
Problem: the play page reads as a diagnostic tool. Experience: screen dominant,
controls quiet, no jargon. Scope: `GameBoyPlayer.tsx`; move fps / key / pad
indicators behind `NODE_ENV === 'development'`. Architecture: none.
Verify: production HTML contains no "fps", no key legend, no controller status.

### S2 — Boot and loading
Problem: seven seconds of white reads as broken. Experience: a calm loading
state until the game's first non-uniform frame. Scope: adapter signals first
varied frame. Architecture: one additive callback.
Verify: Tobu shows loading through its whole intro, then reveals.

### S3 — Handheld Mode
Problem: phones cannot play. Experience: the phone becomes the controller.
Scope: `TouchControls` + `useInputRouter` + responsive player shell + immersive
layout. Architecture: **input router** (§5).
Verify: complete a real game action on a phone viewport with no keyboard; rotate
mid-game without resetting; connect a pad and watch touch fade.

### S4 — Library, curation, search
Problem: the library reads as a database. Experience: short honest hero, curated
order, maze trilogy grouped, console demoted to a facet, instant search.
Scope: `page.tsx`, `GameCard`, catalog gains `sortOrder` / `series` / facets.
Architecture: additive catalog fields only.
Verify: first mobile screen shows four visually distinct games; search resolves
in under three keystrokes.

### S5 — Gameplay previews
Problem: tiles show title screens, not games. Experience: a library that moves.
Scope: `scripts/generate-previews.mjs`, per-game recipes as data, contact-sheet
review, sprite-strip playback with pause-when-offscreen and
`prefers-reduced-motion` respected. Architecture: additive catalog field.
Verify: every shipped preview reviewed by eye — a frame-difference metric cannot
distinguish gameplay from a blinking "PRESS START".
