# CONTENT_RESEARCH.md

Content-track research, 2026-08-12. Separate from M7. Nothing here is
implemented; this is the evidence and the recommendation.

Covers: (1) an audit of the shipping catalog, (2) GBA runtime options, (3) GBA
titles we could legally carry, (4) lawful routes to recognizable content.

---

## 1. Catalog audit

22 entries today: 2 native originals, 20 emulated (12 GB, 8 GBC).

The catalog was assembled by a license filter (D-008), not by a quality filter.
That was the right call for a legal foundation and the wrong basis for a
storefront. `games.ts` already admits the symptom in its own header comment —
alphabetical ordering "put three near-identical mazes in the first four tiles."
Curated rank hid the problem rather than fixing it.

### Cut (7)

| Game | Why |
|---|---|
| `5-mazes` | Three ROMs, one game. Same author, same premise, same art, escalating grid size. This is the clearest padding in the catalog. |
| `5-more-mazes` | As above. |
| `5-mazes-master-levels` | As above. |
| `snake` | 32KB, no description, empty genre array, no year. Undifferentiated Snake — the one game a visitor is guaranteed to have played elsewhere and gains nothing from playing here. |
| `squishy-the-turtle` | 2015, 128KB, one screenshot, no description. Nothing distinguishes it. |
| `maxpirate` | Superseded by `maxpirateeb` (Extra Boom), which is the author's own re-release of the same game. Carrying both is shelf-filling. |
| `tobutobugirl` | Superseded by `tobutobugirldeluxe`. The DX version is better in every respect and is already rank 2. |

The `series` field was built to group these; grouping still shows two tiles for
one game. Ship the better version, link the original from the game page as
history if we want to honour it.

**22 → 15.**

### Demote (5)

Keep, but off the front grid — these are fine to find, not fine to lead with.

- `2048gb` — competent, but it is 2048. Recognisable, not a reason to visit.
- `flooder` — Flood-It clone. Pleasant, thin.
- `postbot` — small puzzle, no description, no year.
- `jp` — "a casual jumping platform game", 64KB. Accurate self-description.
- `labirinth` — same author as `europa-rescue`, weaker of the two.

### Keep and lead with (10)

`drift`, `ring-out` (our originals — `ring-out` is the only two-player title in
the catalog and the only one that demonstrates the platform thesis),
`tobutobugirldeluxe`, `shock-lobster`, `crossconnect`, `gbhack`,
`renegade-rush`, `europa-rescue`, `maxpirateeb`, `aevilia`.

One flag on `aevilia`: it is an RPG that I believe ships unfinished upstream.
`verify:catalog` proves it boots and responds to input; it does not prove there
is a game behind the first screen. Worth a human playthrough before it keeps
rank 3.

### Metadata defects (independent of which games we keep)

These make the catalog *feel* like padding even where the games are good:

- **10 of 22 have an empty description**, including `tobutobugirldeluxe` and
  `shock-lobster` — two of the best things we host. The store page for our
  second-ranked game says nothing about it.
- **12 of 22 have no year.**
- **`shock-lobster` genre is `["gbcompo21", "gbcompo21-shortlist"]`** — jam
  submission tags leaking into player-facing genre. This is a Product Principle
  2 violation: pipeline internals visible in the UI.
- **6 entries have a single screenshot**, so the detail page has no gallery.
- `snake` and `squishy-the-turtle` have empty genre arrays.

Writing 10 descriptions and 12 years is a smaller, higher-return job than
adding any new game. Homebrew Hub does not have this text; someone has to play
each game and write it.

### The strategic point

Do not backfill the gap. M5–M7 built a pipeline that generates games; the
answer to a 15-game catalog is not to re-open the license filter and scrape
weaker entries, it is generated titles plus a small number of deliberately
licensed strong ones. A tight catalog is consistent with "the game is the
product."

---

## 2. GBA runtime

### Recommendation: mGBA compiled to WebAssembly, behind the existing D-005 adapter.

**Core choice.** The field is thinner than it was for Game Boy:

| Core | License | Verdict |
|---|---|---|
| **mGBA** | **MPL-2.0** | **Recommended.** The reference GBA emulator. Weak copyleft: modified mGBA files stay MPL, our app does not become MPL. |
| NanoBoyAdvance | GPL-3.0 | More accurate (first to pass all AGS aging tests), but GPL-3.0 is disqualifying on the same grounds D-006 used to reject WasmBoy. No wasm build. |
| VBA-M | GPL-2.0 | Same license problem, worse accuracy. |
| EmulatorJS | GPLv3 wrapper, mGBA core | Rejected for the same reasons as in D-006: GPLv3, and it ships its own player chrome that fights D-005 and D-009. |
| gbajs2 / Iodine | GPL | License. |

MPL-2.0 vs our situation: MPL is file-level copyleft. We can ship a proprietary
product that loads an MPL wasm module as long as we publish any changes we make
to mGBA's own files and carry the notice. That is a real obligation but a small
one, and it is the same shape as vendoring binjgb (D-006) with a bit more
paperwork.

**How to get a wasm build.** mGBA's own timeline lists a first-party WebAssembly
port as planned, dated around early 2027 — too late to depend on. The working
path today is `thenick775/mgba` (`feature/wasm` branch), an Emscripten build of
mGBA published as `@thenick775/mgba-wasm` on npm and used in production by
**gbajs3** (BSD-2-Clause). gbajs3 is the strongest existing proof that this
stack works in a browser: it does saves, save states, controller remapping,
virtual touch controls, fast-forward and PWA offline, and it is actively
maintained.

That is a fork, not upstream. Same tradeoff as D-006 ("not published on npm"),
one notch worse: we would be pinning a third-party fork of an MPL project.
Mitigation is the same — vendor a pinned build rather than tracking a branch,
and re-verify on bump.

**Fit with our architecture.** The `EmulatorAdapter` interface in
`src/emulation/core/types.ts` needs almost nothing:

- `ConsoleId` gains `'GBA'`; `GameRuntime` gains `'gba'`.
- `LogicalButton` gains `l` and `r`. This is the only genuine interface change,
  and it reaches `src/input/` (D-010 mapping) and the on-screen touch controls.
  Ten logical buttons instead of eight.
- `SCREEN_WIDTH/HEIGHT` are currently module constants at 160×144. GBA is
  240×160 — a different aspect ratio, not just a different size. These need to
  come from the adapter, and the player chrome has to stop assuming 10:9.
- One module instance per emulator, as with binjgb. Assume the same rule until
  disproven.

**Three things that will actually bite:**

1. **Saves break D-013.** GB battery RAM is 8–32KB. GBA saves are SRAM, Flash or
   EEPROM up to 128KB, and the *save type is not reliably in the header* — it is
   detected by scanning the ROM for signature strings, and gets it wrong on some
   titles. 128KB base64-encoded into `localStorage` is ~175KB against a ~5MB
   origin budget, before save states. D-013 needs revisiting for IndexedDB
   before the first GBA title with a save ships, not after.
2. **ROM size vs "play should be immediate."** Our largest GB ROM is 1MB and the
   median is 64KB. GBA ROMs run to 32MB; the Goodboy Galaxy demo download is
   ~50MB. A 16MB fetch before the first frame is a different product from what
   we ship today. Needs a real streaming/progress story, and it changes hosting
   cost.
3. **Mobile performance is unverified.** GBA is roughly an order of magnitude
   more work per frame than Game Boy. Desktop wasm is comfortably fast; I found
   claims in both directions about iOS Safari (throttled framerate and disabled
   audio in one report) and none of them from a source I would trust. Per D-012,
   this gets measured on real devices before it gets planned around — a headless
   benchmark plus a phone, on the two or three heaviest candidate ROMs.

**BIOS is a non-issue.** mGBA ships an HLE BIOS replacement that covers
essentially all games. We never touch or distribute Nintendo's BIOS.

---

## 3. GBA titles we could carry

### The headline finding

I ran the same D-008 method against the GBA archive
(`gbadev-org/games`, surfaced through the Homebrew Hub API). Of **129 GBA
entries tagged as games, 8 carry any license at all**:

| Title | Author | License | Notes |
|---|---|---|---|
| **Skyland** | evanbowman | MPL-2.0 | Realtime strategy, FTL-inspired. Roguelike campaign, island builder, VS and co-op multiplayer, endless mode, embedded LISP interpreter. Years of work, still maintained (June 2026). **The single best candidate.** |
| **Apotris** | akouzoukos | GPL-3.0 | Block-stacker. Widely regarded as the best modern GBA puzzle game. See trademark caveat below. |
| **Attack on Voxelburg** | nuclear / MutantStargoat | GPL-3.0+ | GBA Jam 2022 entry, pseudo-3D. Maintained through Aug 2025. |
| **The Purple Night** | Corwin & Gwilym Kuiper | MPL-2.0 | Platformer where your health bar is your sword. |
| **The Hat Chooses the Wizard** | Corwin & Gwilym Kuiper | MPL-2.0 | Platformer. |
| **Minicraft for GBA** | Vulcalien | GPL-3.0+ | Port of Notch's Minicraft. IP derived from someone else's game — skip. |
| **MeteoRain** | Dr. Ludos | MIT | GBA Jam 2021, small arcade score-attack. |
| **piuGBA (demo)** | Afska | MIT | Pump It Up clone. Code is MIT; the music is the whole game and is not ours. Skip. |

**121 of 129 record no license.** The GBA scene is materially less
open-source-by-default than the Game Boy scene, so the automated D-008 lane
yields roughly 5 usable titles, not 20. GBA content is a *correspondence*
problem, not a filtering problem.

### The trap: permissive code, non-commercial assets

This is new relative to Game Boy and it invalidates repo-level license checks.
GBA homebrew commonly uses tracker and SoundCloud music under CC BY-NC. The
repo badge says permissive; the ROM is not redistributable on a commercial
platform. Verified by reading the per-asset credits:

- **Butano Fighter** (GValiente) — engine zlib, but `credits/music.txt` lists
  tracks under CC BY-NC-SA and **CC BY-NC-ND** from modarchive. Blocked.
- **Varooom 3D** (GValiente) — *all* music, 3D models, palettes and the logo are
  **CC BY-NC-SA 4.0**. Blocked.
- **BeatBeast** (afska, Lu, Synthenia — GBA Jam 2024 **winner**) — repo is MIT,
  but every music and most SFX files are **CC BY-NC 4.0**. Blocked.

All three are excellent games. None can ship without the authors relicensing the
audio, which for BeatBeast and Varooom means a third-party musician's consent.
Each is a short, specific, winnable email — not a legal dead end.

**The rule this implies:** for GBA, the license check must go per-asset, not
per-repo. D-008's method needs that amendment before it is pointed at GBA.

### Two caveats on the licensed list

- **Butano** (the engine, zlib) is fine to build on. Its two bundled *games* are
  not, per above. Do not conflate them.
- **Apotris** is a Tetris-alike. The Tetris Company enforces aggressively against
  clones regardless of the developer's license. GPL-3.0 answers whether *the
  author* permits redistribution; it does not answer whether hosting it draws a
  takedown. Legal read needed before it ships.

**GPL is worth reconsidering.** D-008 excluded GPL-family titles. That was
probably over-cautious: hosting a GPL ROM we did not link into our app is
straightforward compliance — carry the license and point at the corresponding
source. Reversing that unlocks Apotris and Voxelburg on GBA and 11 titles that
were dropped on Game Boy. This deserves its own decision record.

### Ask-for-permission candidates (the real supply)

- **Goodboy Galaxy** (Rik Nicol + Jeremy Clarke / "exelotl", Goodboy Galaxy Ltd)
  — the first full commercial GBA release in 13 years, and the highest-profile
  modern GBA game that exists. A free demo ROM is already published on itch as a
  funnel to a $20 full version. "Free to download" is not a redistribution
  grant, but **a hosted, instant-play demo with a buy link is the exact thing
  their demo already exists to do**. Best single ask in this document.
- **setsquare + LostImmortal** (Corwin and Gwilym Kuiper) — authors of `agb`, the
  Rust GBA library, and of *Dungeon Tactics Advance* (4th, GBA Jam 2024, called
  one of the best roguelikes on the platform), *The Dungeon Puzzler's Lament*,
  *Hyperspace Roll*, *Khiera's Quest*. Two of their games are already MPL-2.0 in
  the `agb` repo, which means **they have already demonstrated they are
  comfortable open-licensing their work** — the friendliest ask on the list, and
  it comes with four more titles.
- **Afska** (BeatBeast) — needs the musicians' sign-off, but the author's own
  code is already MIT and he open-sources everything he makes.
- **GValiente** (Butano) — same shape: needs Tempest's consent on the audio.
- **Incube8 Games** — publisher, ~30 signed homebrew titles (Deadeus, Kien,
  Dragonyhm, The Machine, Genesis). Note: their catalogue is **Game Boy / Game
  Boy Color, not GBA** — the search did not surface GBA titles. They are the
  right conversation for *strengthening the GB catalog we already have*, which
  given section 1 may matter more than GBA does. They exist to monetise homebrew
  and a digital revenue-share channel is a product they do not currently have.
- **Piko Interactive** — owns 100+ retro IPs (acquired ~60 from Atari SA in 2018,
  plus Infogrames, GT Interactive, Ocean assets) and licenses them to anyone who
  asks: Evercade, Antstream, cheap retro hardware. This is the one rights-holder
  in the recognizable tier with a demonstrated willingness to license broadly to
  small platforms. Their catalog is mostly 16-bit and arcade rather than GBA.
- **GBA Jam open-source entries** — the jam marks open-source entries explicitly
  (BeatBeast, Space Evangelion, Detective Monroe: Murder at Sea in 2024, more in
  2025/2026). This is a recurring, pre-filtered candidate stream. Every one still
  needs the per-asset audio check.

---

## 4. Recognizable content — the realistic path

### Nintendo is closed. Not expensive: closed.

Pokémon, Mario, Zelda, Metroid, Fire Emblem and Advance Wars are not licensable
by us at any price. The evidence is directional: Nintendo licenses *inward* —
until September 2025 all 25 GBA titles on Nintendo Classics were
Nintendo-published, and the first third-party additions (Klonoa, Mr. Driller 2)
were Bandai Namco licensing **to** Nintendo. There is no outward-licensing
program, and Nintendo's 2024 suit against Yuzu shows what engagement looks like
instead. Treat this as settled and stop spending thought on it.

### BYOROM: legally viable, product-hostile, reputationally expensive

Letting users load their own ROM is defensible. Emulators themselves are legal
(*Sony v. Connectix*), and *Sony v. Universal* means a tool with substantial
non-infringing uses does not carry contributory liability by default — we have
one, since our own catalog is authorized. The user's copy is their problem.

But it fails on three counts:
- It breaks MVP success criterion 4 — "start playing **without uploading a
  ROM**." A file picker is the distance between wanting to play and playing.
- Whatever the law says, becoming the site where people play their Pokémon file
  puts a target on the platform. Nintendo's enforcement pattern does not
  distinguish carefully.
- It is a lever people reach for when the catalog is weak. Section 1 says fix
  the catalog.

**Recommendation: no.** If it ever ships, it must be a quiet local-file
affordance with zero discovery surface, no ROM-adjacent copy, and no
persistence — never a catalog entry, never marketed.

### What actually works

1. **Licensed-demo partnerships.** Free, playable, instant, with a buy link.
   Zero legal ambiguity, aligned with the developer's own interest, and the
   thing we are technically better at than anyone: no download, no emulator
   setup, controller works. Goodboy Galaxy is the pilot.
2. **Revenue share on a paid tier**, once there is traffic to share. This is the
   Antstream model — 3000+ licensed games from Disney, Taito, Bandai Namco,
   SNK, Data East, Interplay — and it works because rights holders get a revenue
   stream plus play data. Note that Antstream **streams** rather than shipping
   ROMs to the client, which is why cautious rights holders say yes. If we ever
   pursue tier-one back catalog, expect streaming to be a condition, and that is
   a completely different runtime.
3. **Second-tier rights holders first.** Piko, Interplay, Ziggurat, Evercade's
   partners. They license to small platforms; Nintendo does not. Nothing here is
   GBA-heavy, so it is a "later consoles" play, not a first-release one.
4. **Redefine recognizable.** Within the audience that actually seeks out a
   retro web platform, Skyland, Apotris, Dungeon Tactics Advance and Goodboy
   Galaxy *are* the recognizable names. Being the only place these are instantly
   playable is a stronger position than being one more place with an
   unauthorized Pokémon ROM.

---

## 5. Who to contact, in order

1. **Rik Nicol / Jeremy Clarke (exelotl), Goodboy Galaxy Ltd** — host the free
   demo, instant-play, with a buy link. Highest-profile, clearest mutual win.
2. **Corwin & Gwilym Kuiper (setsquare / LostImmortal)** — two titles are already
   MPL-2.0 and need no permission at all; ask about the other four. Also the `agb`
   maintainers, so a relationship here is a relationship with the Rust GBA scene.
3. **evanbowman (Skyland)** — already MPL-2.0, so this is a courtesy note, not a
   request. Verify the audio assets are his before shipping.
4. **akouzoukos (Apotris)** — GPL-3.0, so also courtesy; the blocker here is our
   own trademark read, not his permission.
5. **afska (BeatBeast)** and **GValiente (Butano Fighter, Varooom 3D)** — narrow,
   specific ask: would the musicians relicense off CC-NC, or supply an alternate
   soundtrack for a hosted build?
6. **Incube8 Games** — for the Game Boy catalog, not GBA. A digital revenue-share
   channel for their ~30 published titles.
7. **Piko Interactive** — exploratory, and only once there is traffic worth
   quoting.

---

## 6. What I did not verify

- **iOS Safari GBA performance.** Sources conflict and none are credible. Must be
  measured before any GBA commitment. (D-012.)
- **Per-asset licensing of Skyland and the two `agb` platformers.** The repos are
  MPL-2.0 at the root; I did not walk their asset trees the way I walked
  Butano's and BeatBeast's. Given what that walk turned up, do it before
  shipping.
- **`aevilia` completeness** — boots and responds; unknown whether there is a
  finished game behind it.
- **Whether Apotris draws Tetris Company attention.** Needs a legal read, not a
  developer email.
- **`@thenick775/mgba-wasm` bundle size and cold-start cost.** Relevant to the
  performance rules in CLAUDE.md; not measured.
