# M3_PLAN.md — "Games that could only exist here"

Approved direction for milestone 3. Strategy lives in PLATFORM_DIRECTION.md.

## Goal

Prove a game built *for* GameBoyStudio can sit in the same library as an
emulated one, and that the player cannot tell the difference. Then prove one
player can become two — two controllers, one screen, no account, no server, no
networking.

## The safety rule that shapes this plan

> M3 architecture must support native games **without making M1/M2 regressions
> likely.**

The earlier proposal opened by extracting the game loop out of BinjgbAdapter
into a shared host. That is rejected. Those 466 lines carry every hard-won fix
in this project — the joypad callback, one WASM module per emulator, heap-view
refresh, debounced save flushing — and they interleave with the loop. Elegance
is not worth reopening them.

**BinjgbAdapter is not modified in M3.**

The native runtime gets its own small loop helper. That duplicates roughly forty
lines of requestAnimationFrame and delta-clamping logic, which is a far cheaper
price than destabilising working emulation. If both loops prove identical in
practice, converging them later is a boring refactor done when it is safe.

The same principle applies to the runtime contract: rather than renaming
`EmulatorAdapter` and touching every retro file, the player component adapts.
The router emits a player index; retro ignores it.

## What native means

A native game implements the platform's contract directly instead of being
interpreted by an emulator. Not an engine, not a file format.

The host owns what every game gets wrong: the loop, normalized input, audio
unlock, save storage, pause and visibility. Games supply `update` and `render`.

No third-party engine. Whatever we adopt becomes what creators and AI target
later, and an engine that owns the canvas and the DOM forecloses sandboxing.
The contract is ours; an individual game may use a library internally, but the
first two stay dependency-free to prove the contract is sufficient.

A declarative format remains the destination — but it cannot be designed before
we have written games, so these two games are the research.

## Runtime API

```ts
interface NativeGame {
  readonly resolution: { width: number; height: number };
  readonly players: { min: number; max: number };
  init(ctx: GameContext): void | Promise<void>;
  update(dt: number, input: InputSnapshot): void;
  render(g: CanvasRenderingContext2D): void;
  serialize?(): Uint8Array;   // opt into saves and Continue
  restore?(data: Uint8Array): void;
  dispose?(): void;
}
```

`InputSnapshot` exposes `player(n).held(button)` and `player(n).pressed(button)`.
Edge detection lives in the runtime, not in every game. Games never touch
requestAnimationFrame, AudioContext unlock, storage or visibility.

`NativeGameRuntime` drives any `NativeGame` and satisfies the same shape the
player component already expects, so the game page does not learn a second way
to host something.

## Input

`InputRouter.set(source, button, pressed)` becomes
`set(player, source, button, pressed)`, keyed `${player}:${source}`. Union logic
is unchanged.

**Controller assignment is slot-based, never positional.** `gamepads[0] = P1`
breaks the moment a pad sleeps and reconnects at a different index. A slot map
assigns the lowest free slot on connect, frees it on disconnect, and prefers the
previously held slot when the same pad id returns.

- Keyboard → P1. A second scheme (WASD + G/H) binds only for two-player games,
  so couch play is testable without two physical pads.
- Touch → P1 only.
- **Retro merges every player into one input**: whichever pad you pick up drives
  a Game Boy game. Correct behaviour, not a compromise.

**Two-player touch is deliberately not built.** Two thumb decks on one phone is
unusable, and faking it would break the honesty rule set in M2. A two-player
game on a touch-only device says so plainly.

## Manifest

Only fields with a use today.

| Field | Purpose |
| --- | --- |
| `runtime: 'gb' \| 'gbc' \| 'native'` | picks the adapter |
| `entry` | ROM path or native module id; replaces `romPath` |
| `players: { min, max }` | the 2P game needs it; discovery needs "2 players" |
| `inputs: { required, supported }` | lets the platform say "needs two controllers" |
| `saves` | replaces `hasSave`, no longer cart-header-derived |

`console` becomes display metadata for retro titles. `romBytes` is dropped — no
reader.

## The two games

**Drift** — single player. Thrust-only control around gravity wells. Instantly
legible, high skill ceiling, and smooth momentum at 60fps is a real test of the
loop. Best score persists, which exercises the save path through a non-emulated
runtime for the first time.

**Ring Out** — two players, one screen. Top-down sumo: move plus one dash
button, shove the other player off a shrinking platform. One sentence of rules,
rounds of about fifteen seconds, instant rematch. Physics produces the comedy;
no authored content required. This is the game that earns "wait — plug your
controller in."

No third game. Two that each prove something specific beats three that overlap.
Not Snake or Pong — Snake is already in the catalog.

## Implementation sequence

Each stage ends by rerunning the retro verification before the next begins.

1. **Player-indexed InputRouter** — router, keyboard, gamepad slots, touch.
   BinjgbAdapter untouched; the player component collapses players for retro.
2. **Manifest migration** — catalog gains runtime/entry/players/inputs/saves
   across all 20 existing games. Data and types only.
3. **Native runtime** — `GameLoop` helper, `NativeGameRuntime`, `NativeGame`
   contract. All new files; nothing existing changes.
4. **Drift** — loop, input, audio, restart, persistence.
5. **Ring Out** — two players, two pads, one screen, rematch.
6. **Library and Continue integration** — native games in the grid, previews.
7. **Full verification** — M1, M2 and M3 together.

## Success

- A visitor cannot tell which games are emulated and which are native
- Two people with two controllers go from deciding to playing in under ten
  seconds, with no account, server or setup
- A native game loads in under a second and holds 60fps
- Best score persists and appears in Continue exactly as a battery save does
- **Every M1 and M2 verification still passes**
- Dependencies remain `next, react, react-dom`

## Not in M3

Online multiplayer, netcode, rooms, matchmaking · accounts, profiles, social ·
creator editor · AI generation · marketplace, monetization · community
publishing or arbitrary user code · sandboxing · declarative game format ·
asset pipeline · physics dependency · WebGL · more than two players.
