# STUDIO_DESIGN.md — the generative play experience

A product and system redesign. Nothing here is implemented.

The internal loop already works: request → generate → check/repair → playable →
revise → playable, in 7.8s and 6.8s with full conformance (M7). This document is
about how a person experiences that without ever seeing forge, source, manifests,
builds, or revisions — and how the same machinery serves someone who *does* want
to build.

## The loop being tested

```
ASK → GAME BUILDS → PLAY → CHANGE → REBUILD → PLAY AGAIN → SHARE
```

Every design decision below is judged by whether it moves someone around that
loop a second time.

## One system, two depths

There are not two products here. There is one loop, entered at different depths.

| | Player | Creator |
| --- | --- | --- |
| Wants | a game to play | a game to shape |
| Asks | "a memory game" | "a memory game where the panels chase you" |
| Changes by | tapping *Faster* | describing precisely, then checking what changed |
| Cares about | the game | the game **and** how it got that way |
| Exit | shares it | ejects it into the SDK |

The player-facing surface is effortless. Underneath, the same request is
literally building, checking, repairing, versioning and serving — and a creator
can see more of that without a second product being built for them.

**The creator on-ramp already exists and is nearly free.** A forge project is a
real SDK project — it has a `gbs.game.json`, an entry point, and the SDK
installed from a tarball, because that is how the loop builds it (M6, M7). So
"open this in code" is a download, not a feature. That is the escape hatch that
makes this credible to builders without turning it into a build tool for
everyone else.

---

## Four challenges to the brief

### 1. "Lovable for games" points at the wrong audience

Lovable's user is a **builder** who wants an artifact. A player wants **play**.
A product that presents as a build tool — projects, versions, iterate, ship —
inherits the builder audience, which is smaller and already crowded.

The framing is not *make a game*. It is **get a game**: something nobody else
has, in seconds, that is actually fun. Generation is the mechanism, not the
pitch. No "create", no "project", no "build" on any player-facing surface.

The creator depth exists — but it is reached by wanting more, not by being asked
up front which kind of person you are.

### 2. The specified flow tests the mechanism, not the risk

M7 already proved the pipeline. The riskiest assumption is:

> **Will a person ask for a second one, and will anyone else ever see it?**

A flow ending at "a game appeared" measures a demo. Which means **change and
share are not trailing features — they are the experiment**, and everything
before them is setup.

### 3. Generation is prominent; instant play is still binding

D-014's Instant Contract is binding. Generation is ~8s today and realistically
15–45s with a model — twenty times worse than tapping a game that already exists.

The resolution is not to demote generation. It is that **generation runs in the
background and browsing is the wait**:

- You ask. The request starts building immediately.
- You are returned to browsing, and can play anything.
- A quiet indicator tracks the build.
- When it is ready, you are pulled in.

The catalog stops being legacy and becomes the thing that makes a 30-second wait
cost nothing. Both halves of the product hold each other up.

### 4. The honest ceiling right now is ~44%

M7 measured **five of nine change requests as inexpressible** — speed, lives,
name and player count worked; appearance, entities, audio and space did not.

A bare free-text box at that hit rate teaches people the product does not
listen. So the change surface is **high-confidence chips first, free text
second**. Chips convert near 100% and teach the vocabulary. Free text is where
we learn what people actually want, and **its misses are the roadmap** — the
same corpus M7 said the format still needs.

---

## The home must not harden around the catalog

This is the most consequential instruction in the brief, and it is an
architecture problem rather than a layout preference.

If the home is written as *ask row, then Continue, then Your games, then the big
catalog grid*, the catalog's dominance is baked into the markup. When generated
play grows, the home has to be rebuilt — and it will be rebuilt reluctantly,
because it works.

### The home is a ranked list of shelves

Each shelf declares what it is, when it renders, and how it earns its place:

```
shelf
  id            continue | making | yours | originals | classics | …
  renders       a rule over state, not a hardcoded position
  weight        how strongly it wants the top, given that state
```

The home asks each shelf whether it applies and sorts by weight. Nothing about
the composition is positional. Concretely, today:

| Shelf | Renders when | Wants the top when |
| --- | --- | --- |
| **Making** | a build is in flight | always — it is the loop in progress |
| **Continue** | you played something | you left mid-game |
| **Your games** | you have generated one | recently, or after a change |
| **Originals** | always | you have nothing else |
| **Classics** | always | you have nothing else |

On a first visit, the catalog is at the top because nothing else applies — which
is correct, and is a *consequence of state* rather than a decision cast in
layout. On the tenth visit by someone with six generated games, it is below
them, with no code change and no redesign.

**The ask is not a shelf.** It is persistent — present on the home and reachable
from anywhere, including from inside a game — because it is the entry to the
loop and the loop is the product. A person who just finished playing should be
able to ask for the next thing without going home.

This is the single design decision that decides whether GameBoyStudio can become
a generative network later, or stays a retro library with a text box on it.

---

## The flow

### 1. Ask

Persistent. One line, an input, and three examples that solve the blank page
while honestly hinting at what works.

```
   What do you want to play?
   ┌──────────────────────────────────────┐
   │ a game where…                        │
   └──────────────────────────────────────┘
   a memory game · dodge falling rocks · a two-player race
```

Asking does not navigate anywhere. It starts a build and drops a **Making**
shelf at the top of the home, then leaves you exactly where you were, free to
play something.

### 2. Builds

Visible as a shelf and as a small persistent indicator, not as a page you are
trapped on.

```
   Making “a memory game where you repeat a pattern”
   A memory game · one player · keeps your best score
   ● Writing it   ○ Testing it   ○ Ready
```

Two things matter.

**It reflects what was understood**, in plain words, from the spec the request
produced. Cheap to correct now; and it makes a later failure comprehensible
rather than mysterious.

**Phases are honest but in player language** — "Writing it", "Testing it". Never
conformance, bundle, manifest, or check. Those words do not exist in this
product.

A dedicated route exists for people who want to sit and watch, because
generation is slow enough that people refresh and come back — but nobody is made
to.

### 3. Pulled in

When it is ready, a single unmissable but non-modal invitation:

```
   Recall is ready        [ Play it ]
```

If they are mid-game in something else, it waits — interrupting play to deliver
play is self-defeating.

### 4. Play

The ordinary player. Same chrome, same controls, same everything, because a
generated game is a hosted game and inherits controller, touch deck, saves,
phone multiplayer and fullscreen for free.

### 5. Change

The core action after play, and the interaction where most products feel
dangerous.

```
   Recall                                        made for you

   [ Faster ] [ Slower ] [ More lives ] [ Two players ] [ Rename ]
   ┌────────────────────────────────────────────────────┐
   │ or ask for a change…                               │
   └────────────────────────────────────────────────────┘
```

**The game you have stays on screen and stays playable while the change is
made.** You are never sent back to a loading screen for a game you already had.
A quiet line appears; the game swaps when the new one is ready.

On success: the new game, and a transient **Changed · Undo**.

### 6. Share

Every ready game gets a **stable unlisted link**. One button, one URL, no
account.

```
   [ Share ]  →  gameboystudio.app/g/recall-2608120727
```

Practical, and it has one real requirement worth naming: **a share link means
the project's pointer cannot live only in `localStorage`.** Someone opening your
link has no device state. So a small per-project document — title, current
artifact URL — must live on the hosted origin beside the artifacts, revalidated
the way the manifest already is (D-019).

Two consequences, both acceptable and both worth saying out loud:

- **Unlisted means anyone with the link can play it.** Not secret, just not
  discoverable. Standard, and the honest description.
- **Your device holds the list, not the games.** Losing your browser loses the
  index, not the content — a meaningfully better failure than pure-localStorage,
  and the reason to do it this way even before accounts exist.

Sharing is where the loop stops being personal, and it is the cheapest possible
test of whether generated games are worth anything to anyone but their author.

---

## History without versions

No numbers, no tree, no branch, no hash.

- **Undo** — the last change, reversed.
- **Changes** — a list of *your own requests*, in your words, each restorable.

```
   Changes
   · made it faster                    ← now
   · gave it 3 lives                     go back
   · a memory game where you repeat…     go back
```

Version history presented as a conversation, which is what it actually is.
Underneath it is D-024's append-only revisions and a pointer that moves only on
success — the player sees none of that vocabulary and gets all of its safety.

---

## Failure and repair

The dominant path, not the edge case. Three cases, three responses.

**It did not understand.** The common one — five of nine in M7.

> **I could not do that one.** Your game is unchanged.
> Nothing changed for: *"make the panels blue"*.
> Right now I can change: speed, difficulty, lives, players, name.

Specific about what was ignored, and it does not pretend the request was
malformed. Every one is logged: the list of things people asked for and did not
get is the product roadmap.

**It understood but the result did not work.**

> **That change did not come out right.** Your game is exactly as it was.
> [ Try again ]  [ Ask for something else ]

Retry is offered because with a real model a retry genuinely often succeeds —
that is what the repair stage is for.

**Something broke on our side.** One sentence. No stack, no id, no paragraph.

### The invariant

**A failed change can never cost you the game you had.** D-024 guarantees it
structurally. The copy should *say it* every time, because that fear is what the
whole category has trained into people, and being visibly safe is a
differentiator we already earned.

---

## Where generated games live

Personal and curated content stay separate. Mixing them damages both: the
catalog stops being a statement, and personal games look like products they are
not.

- **Your games** — its own shelf and its own area. Renders only if you have
  some, the rule ContinueShelf already follows.
- **Continue** — unchanged; generated games appear here naturally once played.
- **Originals** and **Classics** — unchanged. Worth collecting the console chips
  under "Classics" so the catalog reads as one collection among several rather
  than as the structure of the site.

The library's filters gain no "yours" facet. Personal things get a shelf, not a
filter.

---

## What has to exist underneath

The player-facing pieces are small. Four system questions are not.

**Generation is a job.** 8–45s, so: start, get an id, poll. The project model
already has the states — `generating | checking | repairing | ready | failed`
(D-024). Wiring, not design.

**Artifacts are unlisted, not published.** Written to the hosted origin under a
per-project path and left out of the manifest. The origin allowlist already
permits it. One path and one omission — not a submission pipeline.

**The project pointer is server-side.** Required by share, as above. A small
document per project; nothing else changes.

**Cost and abuse, designed for before a model exists.** A public prompt box on a
paid model is a bill and an abuse surface. Selection is out of scope (D-025),
but per-device rate limiting and a queue should be assumed now — retrofitting a
limit onto an unlimited-feeling product is a downgrade people notice.

---

## Minimum UI

Eight pieces. Nothing else is needed to put this in front of people.

1. The persistent ask — input plus three examples
2. Shelf-composed home with declared ordering
3. **Making** shelf and indicator, with a route for those who want to watch
4. Ready invitation — non-modal, waits if you are mid-game
5. Generated-game player — the existing player, plus a name and *made for you*
6. Change row — chips plus free text, with the game staying playable throughout
7. Undo and the Changes list
8. Share button and the unlisted link

Deferred but designed toward: **Open in code** — a download of the project the
loop already built, which is the creator on-ramp and costs almost nothing.

Not required: feed, profiles, likes, comments, remixing, prompt library, editor,
workspace, accounts, monetization.

---

## What would tell us it worked

| Question | Signal |
| --- | --- |
| Does anyone ask twice? | % of sessions with ≥2 requests |
| Is the loop the product? | % of games receiving ≥1 change |
| Do we listen? | % of free-text changes understood — **M7 baseline: 4 of 9** |
| Is it worth showing anyone? | % of ready games shared, and plays per shared link |
| Is it worth keeping? | % replayed on a later day |
| Did instant play survive? | time-to-first-play, before and after |

The third decides the roadmap. If understood-rate stays near half, the answer is
a better generator, not better UI — and that is the evidence-backed argument for
choosing a model.

The fourth decides whether this is a network or a toy. A generated game nobody
else ever sees is a much smaller business than one that travels.

---

## Where this goes, and what not to foreclose

If generative play works, the natural evolution is a generative gaming network:
remixes, discovery, creators, multiplayer, personalised playable content.

Three things are designed now so that evolution is additive rather than a
rewrite:

- **Shelves, not layout.** Discovery surfaces become new shelves competing on
  the same rules, and the catalog recedes without being torn out.
- **Unlisted stable URLs.** Sharing exists; making something *listed* later is a
  flag, not an architecture.
- **Append-only revisions with a moving pointer.** A remix is someone else's
  revision of your game — the data model already supports it, and nothing about
  it needs inventing when the time comes.

Deliberately not designed: accounts, feed, ranking, creator economy,
monetization, moderation. Naming them here is how they stay out of scope while
the shapes above stay compatible with them.

---

## Open decisions

1. **Does asking navigate, or stay put?** I recommend staying put — asking
   should feel free, and being sent to a waiting room makes a 30-second build
   feel like a commitment.
2. **Free text on day one?** Yes, alongside chips. The hit rate justifies chips
   leading; free-text misses are the research and we should start collecting
   them immediately.
3. **Unlisted share with a server-side pointer** — confirm, since it is the one
   piece of genuinely new plumbing and it is what makes SHARE real.
4. **Say "your list lives on this device" out loud?** Once, when the first game
   is made. Quiet honesty now is cheaper than a support conversation later.
