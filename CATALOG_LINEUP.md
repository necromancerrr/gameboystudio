# CATALOG_LINEUP.md

The catalog audit in CONTENT_RESEARCH.md §1, turned into an actual lineup.
Applied on `content/catalog-lineup`, off `main`. Not merged — `main` still ships
the 22-entry catalog.

**22 entries → 15.** Two originals, thirteen emulated (7 GB, 6 GBC).

Featured is expressed as `rank` 0-9, which is what the library grid already
orders by. No schema field, no component changes, no visual split — putting an
actual "Featured" band on the homepage is a design decision, not a data one, and
is deliberately left out of this branch.

---

## Featured (ranks 0-9)

| # | Game | Console | Why it leads |
|---|---|---|---|
| 0 | **Drift** | native | Ours. Instant, one-button, no explanation needed. |
| 1 | **Ring Out** | native | Ours, and the only two-player game in the catalog. The single title that demonstrates why this platform exists rather than just what it hosts. |
| 2 | **Tobu Tobu Girl Deluxe** | GBC | The best-made thing we host, by some distance. Colour, sound, and a real movement system. |
| 3 | **Shock Lobster** | GB | Genuine design depth — a run-based loop with unlockable skills in 32KB. Rewards a second attempt, which nothing else here does as well. |
| 4 | **GBHack** | GBC | A full NetHack on a Game Boy Color. The most surprising sentence in the catalog. |
| 5 | **CrossConnect** | GBC | The polished puzzle slot. Numberlink with a clean cursor UI and a lot of levels. |
| 6 | **Europa rescue!** | GBC | The longest-form thing we host, and the only one with a story someone wrote on purpose. |
| 7 | **Aevilia** | GBC | The RPG slot, hand-written in assembly. See the caveat below. |
| 8 | **Renegade Rush** | GB | Speed and immediacy — a good contrast against three puzzle games. |
| 9 | **Max Pirate Extra Boom** | GB | Short, loud, and finishable in one sitting. Good last tile before the fold. |

**Caveat on Aevilia (rank 7).** Its upstream README says the codebase is no
longer maintained and a rewrite is in progress; `verify:catalog` proves it boots,
responds to input and round-trips a 128K save, none of which proves there is a
finished game behind the character-select screen. **Someone should play it for
twenty minutes before this ships.** If it turns out to be a vertical slice, it
drops to the library and Flooder moves up.

## Library (ranks 10-14)

Kept and findable, not led with.

| # | Game | Why not featured |
|---|---|---|
| 10 | 2048gb | Competent port, but the player has already played 2048. |
| 11 | Flooder | Pleasant, thin. Flood-It. |
| 12 | Labirinth | Same author as Europa rescue!, and the weaker of the two. |
| 13 | PostBot | Small routing puzzle. Fine; not a reason to visit. |
| 14 | JP | The author's first Game Boy game, and reads like it. |

## Removed from the catalog (7)

None of these were removed for licensing. Files stay in `public/roms` and stay in
ATTRIBUTION.md marked *unlisted*, so every one is a one-line revert.

| Game | Reason |
|---|---|
| **5 mazes** | Three ROMs, one game — same author, same premise, same art, bigger grid. This is the clearest padding in the catalog and `games.ts` already recorded that alphabetical order put them in the first four tiles. |
| **5 more mazes** | As above. |
| **5 mazes: Master levels** | As above. |
| **Snake** | 32KB, no description, empty genre, no year. The one game every visitor has played elsewhere, with nothing added. |
| **Squishy the Turtle** | 2015, one screenshot, no description, nothing distinguishing. |
| **Max Pirate** | Superseded by the author's own *Extra Boom* re-release. Two tiles for one game. |
| **Tobu Tobu Girl** | Superseded by *Deluxe*, which is better in every respect and was already ranked above it. |

The `series` field existed to group the duplicates, but grouping still renders
two tiles for one game. With the duplicates gone, all three series
("Tobu Tobu Girl", "Max Pirate", "5 mazes") are down to one member or zero, so
`series` is now `null` throughout — a series of one is noise in search and on the
game page.

---

## Metadata fixed

This mattered as much as the cuts. The catalog was generated from Homebrew Hub,
which does not carry descriptions for most entries, so half the library had none.

- **10 empty descriptions → 0.** Every kept game now has one, written by hand
  from upstream READMEs, the authors' own store pages, and the game's own
  screenshots. Nothing was invented: where a source was thin (PostBot, Renegade
  Rush) the description describes what the screenshots actually show.
- **12 missing years → 0.** Sourced from upstream release dates and repository
  creation dates: Tobu Tobu Girl Deluxe 2019 (itch release date), 2048gb 2014,
  Aevilia 2018, PostBot 2018, Shock Lobster 2021, Labirinth 2021, Flooder 2022,
  Europa rescue! 2022.
- **Shock Lobster's genre was `["gbcompo21", "gbcompo21-shortlist"]`** — jam
  submission tags rendered to players as genre. Now `["Action", "Score Attack"]`.
  This was a Product Principle 2 violation: pipeline internals in player-facing
  UI.
- **Empty genre arrays** are gone with Snake and Squishy the Turtle.
- **GBHack** gained `Roguelike`, **Tobu Tobu Girl Deluxe** gained `Arcade`,
  **Renegade Rush** gained `Racing`.
- **JP's second screenshot was the developer's logo splash**, not the game.
  Dropped; JP now shows two screenshots, both of the game.

## One test was quietly stale

`verify:catalog`'s input assertions — the ones D-012 exists for — named
`tobutobugirl` and `snake`, and load ROMs from disk rather than from the catalog.
Both games are now cut, and the test kept passing, because nothing tied it to
what actually ships.

Renamed to games in the catalog and widened from two cases to four
(tobutobugirldeluxe, crossconnect, gbhack, 2048gb).

While picking replacements, `maxpirateeb` **failed** the START assertion — its
title screen advances on A, not START. That is a property of the game, not a
broken joypad callback, so it is excluded with a comment saying why. Worth
recording that the assertion demonstrably still fails when it should; per D-012,
a test that cannot fail is not evidence.

## Verified

- `npm run verify:catalog` — 13/13 ROMs boot and render, 4/4 respond to input,
  9/9 battery saves round-trip.
- `npx tsc --noEmit` — clean.
- `npm run lint` — unchanged from `main` (243 problems, 18 errors, all
  pre-existing and all in `.test-build` artifacts and `worker/`).
- Library page rendered and read back in the browser: 15 tiles, correct order,
  descriptions present, no empty-genre chips.

## Follow-ups not done here

- No homepage "Featured" band. Rank ordering only.
- ROM files for the seven cut games are still served from `public/roms`, and
  their screenshots still sit in `public/screenshots`. Cheap to delete once the
  cuts are agreed; kept for now so this branch is a reversible data change.
- The 618 unlicensed Homebrew Hub entries remain a correspondence backlog, not a
  filtering problem. Unchanged by this branch.
