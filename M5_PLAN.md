# M5_PLAN.md — "Games the platform did not compile"

Approved direction for milestone 5. Strategy lives in PLATFORM_DIRECTION.md;
ratified decisions live in DECISIONS.md (D-018, D-019).

**M5 = Hosted games: a runtime-loaded manifest and a sandboxed frame.**

## Goal

> **A hosted game can be added, changed or removed without rebuilding the
> GameBoyStudio application.**

Not "the bundle lives elsewhere". The whole path — the fact that the game
exists, its metadata, its capabilities, and its code — has to arrive at runtime.

Validation question:

**Can I change a game on this platform without touching this repository?**

## The correction this plan is built on

An earlier draft proposed a `runtime: 'hosted'` row in the existing catalog.
That fails its own goal, and it is worth writing down why so it is not proposed
again.

`src/catalog/games.ts` is a committed TypeScript array compiled into the site.
A hosted row would move the *bundle* out of the build and leave the *catalog*
inside it — so adding a game would still mean a code change, a Next build and a
redeploy of the whole application. The bundle boundary without the catalog
boundary proves nothing; it is the catalog entry that decides whether a game
exists.

So M5 introduces the smallest runtime-loaded catalog boundary that hosted games
need, and nothing more.

## What the platform already does, and where it stops

The asymmetry that makes this the right rung:

**Game Boy titles are already data.** A ROM is an asset, fetched at runtime,
interpreted by binjgb. Adding one is a row and a file; nothing is compiled.

**Native games are the only kind that must be compiled in:**

```ts
export type NativeGameId = 'drift' | 'ring-out';
const LOADERS = { drift: () => import('./drift'), 'ring-out': () => import('./ring-out') };
```

That union type is the whole story. Consequences today:

1. The catalog cannot grow without shipping the site.
2. M4's rooms seat four players; one game uses two, and a fifth can only arrive
   through this repository.
3. Nobody outside this repo can put anything on the platform — not a creator,
   not an AI, not an indie developer with a finished HTML5 game.
4. Bundle size is coupled to catalog size permanently.

Every later rung — creator tools, publishing, AI creation — sits on a boundary
that does not exist yet.

## Why not the declarative format

D-015 said a declarative format was the destination and that the two Originals
were "the research that earns it". Collecting that research says the format is
**not** yet earned.

Drift is 503 lines of bespoke orbital gravity, particle emission, screen shake,
a trail buffer and hand-drawn vector art. Ring Out is 482 lines of dash physics,
restitution, spark systems and round phases. A format expressive enough to
contain either would be a general-purpose engine; a format that merely contained
them would generalise to nothing.

More games and more genres have to exist first — and they cannot, while a game
can only arrive through a site deploy. The format waits on this milestone rather
than the other way round.

## The three boundaries

M5 introduces exactly three things, and each is small on its own.

### 1. The hosted origin

A static origin we control, deployed separately from the application. It serves
the manifest and every hosted game's files. Nothing on it is produced by the
Next build.

### 2. The manifest

One JSON document, fetched at runtime, listing hosted games. It carries only
**platform-controlled metadata and capabilities, plus a URL** — never code, never
markup, never anything the player's browser will execute directly.

```jsonc
{
  "version": 1,
  "games": [
    {
      "slug": "…",              // must not collide with a compiled game
      "title": "…",
      "developer": "…",
      "description": "…",
      "year": 2026,
      "players": { "min": 1, "max": 2 },
      "inputs": { "required": [], "supported": ["gamepad", "keyboard", "touch"] },
      "saves": true,
      "genre": ["…"],
      "screenshots": ["…"],
      "license": "…",            // same discipline as D-008
      "attribution": "…",
      "sourceUrl": "…",
      "frameUrl": "https://<hosted origin>/…/frame.html"
    }
  ]
}
```

It is **validated before it is allowed near the catalog or the player**: strict
schema, bounded sizes and array lengths, `frameUrl` origin checked against an
allowlist, slug collisions rejected, and a single bad entry dropped rather than
poisoning the whole document. A manifest that fails entirely leaves the site
exactly as it is today.

### 3. The sandboxed frame

A third adapter beside `BinjgbAdapter` and `NativeGameRuntime`, speaking a small
`postMessage` protocol into an iframe:

```
host                              sandboxed iframe (opaque origin)
  load / start / pause      ──▶
  resume / reset / mute     ──▶
  input(player, button)     ──▶        the game
  restore(bytes)            ──▶
                            ◀──        ready / error / saveDirty / save(bytes)
```

The verbs are deliberately the ones the player component already calls, because
that is what makes this an adapter rather than a second architecture.

Three things fall out well:

- `sandbox="allow-scripts"` **without** `allow-same-origin` gives the frame an
  opaque origin. It cannot reach our DOM, cookies or `localStorage`.
- **Saves must flow through the host**, because the sandbox has no usable
  storage. D-015 already made the host responsible for save storage, so the
  constraint and the design agree rather than fight.
- **Input already has the right shape.** `InputRouter` merges keyboard, gamepad,
  touch and remote; the bridge is one more consumer. A phone controller joined
  through an M4 room drives a hosted game for free.

## What "genuinely independent" means here

The hosted artifact must not be another chunk emitted by Next. Concretely:

- It is built by its own build step, from its own entry point, with its own
  output directory. Deleting `.next` does not affect it; running `next build`
  does not produce it.
- It is deployed to the hosted origin by its own command.
- **The proof is a swap:** with the application already built and running, change
  the hosted game, redeploy only the hosted origin, reload the page — and the
  change is there. No Next build in between. This is checked in the harness, not
  asserted.

A small **frame SDK** lives in this repo and is versioned with the protocol. A
hosted game imports it to speak the bridge. That is a published contract, not an
engine: it forwards lifecycle and input, and nothing else.

## Routing, and keeping runtimes invisible

D-014 bars runtime internals from player-facing UI, and a separate URL shape for
hosted games would leak the runtime to players. So hosted games keep the same
`/games/[slug]` URLs.

The server cannot know a hosted game exists — that is runtime data — so an
unknown slug renders a client resolver that reads the validated manifest and
mounts the hosted adapter, or shows a genuine not-found if the slug is in
neither catalog. The library renders the compiled catalog immediately, exactly
as it does today, and hosted entries appear when the manifest resolves.

That ordering is deliberate: the Instant Contract is binding, so a slow or dead
hosted origin must never delay or break the games that are already there.

Known trade, accepted for M5: a hosted game's page metadata is generic, because
metadata is generated at build time and the game is not known then.

## Stages

**S1 — The hosted origin and the manifest.** Schema, validator, allowlist, the
static origin, and graceful behaviour when it is empty, slow, malformed or
absent. Nothing renders a game yet.

**S2 — The frame protocol and SDK.** Typed, versioned messages. An in-process
fake frame so the protocol is testable without a browser, in the shape
`verify:net` already established.

**S3 — The hosted adapter.** Host side: the same verbs the player already calls,
plus input from `InputRouter`, saves through the host, and teardown.

**S4 — Lifecycle and the awkward parts.** Autoplay policy inside an iframe,
fullscreen delegation, pause on tab hide, and the failure modes: a frame that
never signals ready, one that throws, one that floods the bridge.

**S5 — Prove it with existing games.** Ring Out and Drift built as hosted
artifacts by their own build. Between them they cover the whole adapter surface:
Ring Out brings two players, gamepads and M4 phone controllers; Drift brings
saves. **No new game content is written.**

**S6 — Verification.** Per D-012, every check run against a deliberately broken
build. Three that matter most:

- **The swap.** Change the hosted artifact, redeploy only the hosted origin,
  reload without rebuilding the app, and see the change. This is the milestone's
  goal, so it is a test rather than a claim.
- **Isolation, demonstrated failing.** From inside the frame, attempt
  `parent.document`, `parent.localStorage` and `document.cookie` and require
  each to be denied. A boundary nobody tried to cross is not a boundary.
- **Equivalence.** Hosted Ring Out passes the same browser checks compiled Ring
  Out does, including a phone controller through a room.

Also extended: `verify:bundles` asserts the application build contains none of
the hosted games' code, the same way it already asserts a Game Boy page loads no
native code.

## Third-party supply

An earlier draft gated the milestone on whether legally clean third-party HTML5
games exist. That was wrong: hosted games are required for our own creator and
AI pipeline regardless of what anyone else has published.

So the supply question **informs the product and does not gate the milestone**.
It is worth answering during M5 because it tells us whether hosted games are also
a content opportunity or only an internal boundary — and D-008 is the precedent
for finding out before promising a catalog rather than after.

## Explicit non-goals

Editor · uploads · accounts · moderation · publishing UI · the declarative
format · remote multiplayer · remixing · asset pipelines · AI generation ·
changes to `BinjgbAdapter` or the `NativeGame` contract · migrating the retro or
native catalog to the manifest.

Curation is unchanged. We decide what is in the catalog, exactly as with ROMs.
This milestone does not let strangers put games on the site; it makes that
possible later.

## Risks

| Risk | Handling |
| --- | --- |
| Sandbox escape | S6 must demonstrate the boundary refusing to be crossed, not assert it |
| Hosted origin down or slow breaks the site | The compiled catalog renders first and never waits on the manifest; a failed manifest is a no-op |
| A tampered manifest injects something | Strict validation, `frameUrl` origin allowlist, no field is ever rendered as markup or executed |
| A hosted game feels worse than a compiled one | The same game is the control: hosted Ring Out against compiled Ring Out |
| The protocol grows into a mini-engine | Verbs limited to what the player already calls; a new verb needs a real game that needs it |
| Two catalogs drift apart in shape | The manifest is validated into the existing `Game` type, so there is one shape in the app |
| iframe autoplay and fullscreen policy differences | S4 owns them explicitly rather than discovering them on a phone |

## Definition of done

1. A hosted game is built by its own build, deployed to its own origin, and
   plays inside GameBoyStudio.
2. Changing that game and redeploying only the hosted origin changes what
   players get, with **no application rebuild**, demonstrated in the harness.
3. Keyboard, gamepad, touch and an M4 phone controller all reach a hosted game
   through `InputRouter`.
4. Saves for a hosted game persist through the host.
5. Pause, reset, mute and fullscreen work.
6. The sandboxed game is shown to be unable to reach parent DOM, storage or
   cookies.
7. A missing, slow, empty or malformed manifest leaves the site behaving exactly
   as it does today.
8. `npm run verify` passes, including new checks that fail when deliberately
   broken.
