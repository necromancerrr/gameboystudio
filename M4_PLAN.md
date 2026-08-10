# M4_PLAN.md — "The first networked layer"

Approved direction for milestone 4. Strategy lives in PLATFORM_DIRECTION.md;
ratified decisions live in DECISIONS.md (D-016, D-017).

**M4 = Rooms + Phone Controllers + Network Foundation.**

M4 is explicitly *not* the final multiplayer system. It is the first rung that
crosses a device boundary, and it is scoped so that the rungs above it —
different-places play, spectating, more players — are not boxed out by anything
built here.

## Goal

A second person, on their own phone, playing a GameBoyStudio game within seconds
of being handed a link. No install, no account, no configuration.

The primary experience, start to finish:

```
host opens Ring Out
   -> Invite
   -> QR + short code + link
   -> friend opens it on their phone
   -> their phone is Player 2
   -> playing, on the host's screen
```

Validation question:

**Can a stranger walk into the room, scan a code, and be playing in under
fifteen seconds?**

## What M3 already built

M3 delivered more of multiplayer than it claimed. The stack is player-indexed
from the pad driver down to `update()`:

| Piece | State after M3 |
| --- | --- |
| `InputRouter.set(player, source, button, pressed)` | Per-player, merges sources by OR, notifies only on real edges |
| `SlotAssigner` in `src/input/gamepad.ts` | Non-positional; pads hold slots by id and survive sleep/reconnect |
| `InputState` / `InputSnapshot.player(i)` | Per-player held state and one-frame press edges |
| `NativeGameRuntime.setButton(player, ...)` | Player-indexed |
| Catalog `players: {min,max}`, `inputs.required/supported` | Modelled and verified |
| Ring Out | `{min: 2, max: 2}`, real local versus |

The expensive part is therefore done. A "player" is already a first-class
concept everywhere it needs to be.

## Where it stops

1. **Nothing crosses a device boundary.** There is no network code in the
   project at all.
2. **Player count is frozen at construction** (`NativeGameRuntime`, from
   `players.max`). No join, no leave, no presence. Ring Out runs two-player
   whether or not a second person exists, and P2 is a statue until one arrives.
3. **Slots are not choosable.** A lone pad always takes slot 0, keyboard schemes
   are hardwired (P1 arrows, P2 WASD), and touch is pinned to player 0. One pad
   and one keyboard in a room cannot agree on who is who.
4. **Discovery cannot answer "what can two of us play."** `GameCard` renders a
   badge; the library has no players facet.
5. **Ring Out is an honest dead end on phones.** The page says a touchscreen
   cannot hold two people. That statement is true, and deleting the condition
   that makes it true is the clearest single win available in M4.

## What crosses the wire

"Real multiplayer" is three architectures sharing one word. They differ by what
is actually transmitted.

**A — Input transport.** A second device sends button edges into the host's
`InputRouter`. The host runs the only simulation and owns the only screen.
Games, runtimes and `BinjgbAdapter` are all untouched, because this lives
*below* them. Ceiling: one shared screen.

**B — Frame transport.** Host does `canvas.captureStream()` to a WebRTC video
track; guest returns input. Unlocks different-places play. Costs an encode +
network + decode stack (realistically 80–150ms round trip), and puts hard-edged
320×288 pixel art through chroma subsampling, which damages exactly the thing
D-009 cares about.

**C — State transport.** Both ends simulate — lockstep (needs fixed-timestep
determinism; `GameLoop` is variable-dt and both Originals use float physics) or
host-authoritative snapshots (needs a new per-frame contract method). Best
remote feel, highest cost, taxes every game we ever write, and retro can never
participate.

**M4 implements A.** Reasoning is recorded in D-016. In short: it is the only
option costing zero lines inside any game or runtime, it is the format
PLATFORM_DIRECTION already defended by name, and B and C both need everything A
needs anyway — rooms, codes, signaling, disconnect handling, held-button release
across a partition. A is the cheapest way to learn all of that under real
conditions.

## Not boxing out the next rung

Transport-agnostic is necessary but not sufficient. A `RemoteTransport`
interface lets WebSockets be swapped for WebRTC DataChannels, but if the *room*
only knows how to carry button edges, then B and C are still boxed out.

So the room is defined as **a session with typed channels**:

```
Room
 ├── membership   who is here, which slot they hold, ready state
 ├── control      pause / reset / host handoff signals
 └── channels
      ├── input   IMPLEMENTED IN M4
      ├── frames  reserved — B
      └── state   reserved — C
```

M4 implements the membership layer, the control layer, and exactly one channel.
The reserved channels are named in the protocol version and rejected by the
server; they are not stubs, empty handlers or speculative code. Naming them
costs nothing and means adding one later is an additive protocol change rather
than a redesign.

`RemoteTransport` carries opaque framed messages and knows nothing about
buttons. The room protocol sits above it. Either can be replaced without the
other noticing.

## Join model

**The invite flow is the primary join model.** An earlier draft of this plan led
with "press START to join", which made the local pad path look primary when the
QR/link flow is the headline experience. Pad-join is the local fallback that
happens to reuse the same slot machinery.

Host side:

- An **Invite** affordance on any game with `players.max > 1`
- QR code, short room code, and a copyable link — all three, because the phone
  in the room scans, the phone across the table types, and the person in chat
  pastes
- Clear P1 / P2 readiness, so "is it working" is answerable by looking
- The room is created **only when the player asks to invite someone**.
  Single-player pages never contact the network.

Guest side:

- `/join/[code]` is a full-screen controller and nothing else
- It reuses `TouchControls`, so the guest inherits the handheld deck from the
  post-M3 polish rather than getting a second-class one
- A gamepad attached to the guest's device works too — the guest page binds the
  same input layer the host does
- **Reconnects gracefully.** A phone that locks, drops Wi-Fi or backgrounds for
  a moment rejoins its slot rather than losing it

Local fallback, unchanged in spirit from M3: pads and keyboard schemes bind to
slots, and a lone pad may take either slot rather than always slot 0.

## Runtime independence

The network input layer sits in `src/input/`, below both runtimes. That should
mean a remote phone can drive a **retro** Game Boy game with no retro code
touched — proof that the layering is real rather than asserted.

**This is a test, not a feature.** M4 verifies it works. It does not add retro
multiplayer to the product surface, does not add a scope requirement, and does
not change anything about how Game Boy games are presented. Game Boy is a
one-player console; the interesting claim is about our architecture, not about
the catalog.

`BinjgbAdapter` is not modified in M4, exactly as in M3.

## Stages

**S1 — Slot model and readiness.**
Slots bind to a source: pad id, keyboard scheme, touch, or remote. Presence and
readiness are player chrome, with the runtime held paused until the room is
ready. Players facet in the library.
The `NativeGame` contract is **not** changed — "waiting for player two" is
chrome, not game logic. The contract changes when a game needs it to.

**S2 — Transport seam and loopback.**
`'remote'` joins `InputSource`. `RemoteTransport` carries opaque frames. An
in-process fake transport makes the whole join → input → game path testable with
no server running, which is also how S1 gets tested before S3 exists.

**S3 — The relay (Cloudflare Workers + Durable Objects).**
One room per Durable Object, WebSocket Hibernation. Rooms, codes, TTL, schema
validation, rate limits. **Latency is measured here, with a throwaway client,
before any UI is built on top of it.** If the numbers are bad we learn it now,
not in S5.

**S4 — Host: invite and room.**
QR, code, link, readiness. Remote slot assignment. Disconnect releases every
held button — D-010's yanked-cable lesson, now over a network where the failure
is far more likely than a pulled USB plug.

**S5 — Guest: the controller page.**
`/join/[code]`, full-screen, wake lock, reconnect, no accidental navigation.

**S6 — Verification.**
Per D-012, prove that a button pressed on device B changes pixels on device A,
with a deliberately broken control run that fails the assertion. Two-browser
harness in the existing `verify:browser` shape. Disconnect, reconnect, room
expiry, code guessing, message flood. Retro runtime-independence check. Latency
reported honestly rather than rounded down.

## Explicit non-goals

Accounts · profiles · friends · lobbies · matchmaking · leaderboards ·
tournaments · presence beyond a single room · different-places gameplay · video
streaming · deterministic lockstep · retro multiplayer as a product surface · a
new game · changes to `BinjgbAdapter` · changes to the `NativeGame` contract.

Ring Out is the primary proof case. Its `{min: 2, max: 2}` is the honest test:
it cannot quietly degrade to one player to make a demo work.

## Risks

| Risk | Handling |
| --- | --- |
| Relay latency makes it feel bad | Measured in S3 before UI depends on it; WebRTC is the escape hatch and the interface already allows it |
| The relay quietly becomes a backend | Payload-blind, no storage, schema-capped, TTL-bound; the constraint is ratified in D-017 rather than left to discipline |
| Code guessing means pressing buttons in a stranger's game | Six characters, short TTL, lifetime tied to the host |
| Host tab backgrounded — rAF stops, guest sees a frozen game | Defined behaviour: both pause, and the guest is told why rather than left guessing |
| Guest drops mid-press, leaving a button stuck down | `releaseSource` on the slot, same shape as the pad-disconnect fix in D-010 |
| Phone sleeps mid-session | Wake lock, and rejoin restores the slot rather than allocating a new one |

## Definition of done

1. Two people, two devices, one screen, playing Ring Out.
2. The guest never installed anything, never signed in, and never typed more
   than a six-character code.
3. A guest phone can drive a retro game, demonstrated once, in the harness.
4. Disconnecting a guest mid-press leaves no button held.
5. Single-player pages make no network requests to the relay.
6. `npm run verify` passes, including a new networked check that fails when
   deliberately broken.
