# ACQUISITION.md

A short working list, not a survey. Evidence is in CONTENT_RESEARCH.md.

Three tiers: what we could add after an audit, what needs an email, and who is
worth a conversation. GPL-licensed titles are quarantined at the bottom and are
**not** proposed for the catalog until there is a compliance policy.

---

## 1. Addable after a per-asset audit

Permissively licensed, redistribution allowed by the author, no permission
needed. Each still needs the audit **and** a boot/playability check before it is
a catalog entry — D-008 and D-012 both apply unchanged.

| Title | Author | Licence | Platform | Audit still required |
|---|---|---|---|---|
| ~~**Skyland**~~ | evanbowman | MPL-2.0 | GBA | **Audited, held back.** The repo documents its assets well, which is how this surfaced: the Maryland font is a commercial licence purchased by the author personally, and the music is PD Info tracks licensed to him by name. Neither is obviously ours to redistribute. Moved to tier 2 — one email would probably settle it. |
| ✅ **The Purple Night** | Corwin & Gwilym Kuiper | MPL-2.0 | GBA | **Shipped.** MPL-2.0 repo, music by Sam Williams committed to it as a credited contributor. |
| ✅ **The Hat Chooses the Wizard** | Corwin & Gwilym Kuiper | MPL-2.0 | GBA | **Shipped.** |
| ~~**MeteoRain**~~ | Dr. Ludos | MIT | GBA | **Audited, held back.** Code is MIT; the title screen credits "music by WARLORD" and no licence for it is recorded anywhere. |

**The audit is not a formality.** Reading the credits files turned up three
otherwise-perfect GBA titles whose *code* is permissive and whose *music* is
CC-BY-NC or CC-BY-NC-ND: Butano Fighter, Varooom 3D and BeatBeast. A repo-level
licence badge is not a licence for the ROM. For GBA this check must be
per-asset, which is an amendment D-008 does not currently make.

## 2. Needs the creator's permission

Ordered by expected value, not by ease.

| Who | What to ask for | Why they might say yes |
|---|---|---|
| **evanbowman** (Skyland) | Confirmation that the font and music licences cover redistribution of the ROM by others | He already distributes the ROM publicly and licensed the assets deliberately. Probably a yes, and it is the best GBA game in reach. |
| **Rik Nicol & Jeremy Clarke (exelotl)**, Goodboy Galaxy Ltd | Host the existing free demo, instant-play, with a buy link | The demo already exists to sell the full game; we would make it playable without a download or an emulator. Highest-profile modern GBA game there is. |
| **Corwin & Gwilym Kuiper** (setsquare / LostImmortal) | Dungeon Tactics Advance, The Dungeon Puzzler's Lament, Hyperspace Roll, Khiera's Quest | Two of their games are *already* MPL-2.0 in the agb repo, so they have shown what they think of open licensing. Friendliest ask on the list, and it comes with four titles. |
| **afska** (BeatBeast) | Relicensed or replaced audio for a hosted build | Code is already MIT and he open-sources everything; the blocker is Synthenia's CC-BY-NC music, not him. GBA Jam 2024 winner. |
| **GValiente** (Butano Fighter, Varooom 3D) | Same: audio off CC-NC, or an alternate soundtrack | Same shape. Tempest's music is the blocker. |
| **statico, tbsp, quinnp, Tangram Games** | Nothing — already shipping | Listed only so nobody re-asks. |

## 3. Worth a conversation, not a request

- **Incube8 Games** — ~30 published homebrew titles. Note their catalogue is
  **Game Boy / Game Boy Color, not GBA**, so this strengthens the library we
  already have rather than opening a new console. They exist to monetise
  homebrew and have no digital instant-play channel.
- **Piko Interactive** — 100+ retro IPs, licenses broadly to small platforms
  (Evercade, Antstream). Mostly 16-bit and arcade, so this is a later-consoles
  conversation, and only once there is traffic worth quoting.
- **GBA Jam open-source entries** — the jam marks them explicitly, every year.
  A recurring pre-filtered pipeline, and the same per-asset audit applies to
  every one.

## 4. Quarantined: GPL-family — do not add yet

Flagged separately as instructed. These are **good games with no rights problem
in principle**: the GPL permits redistributing the compiled ROM. The open
question is ours, not theirs — what compliance looks like when we host a
GPL binary, and whether "here is the upstream repository" satisfies the
corresponding-source obligation for the users we distribute to.

| Title | Author | Licence | Note |
|---|---|---|---|
| **Apotris** | akouzoukos | GPL-3.0 | Widely considered the best modern GBA puzzle game. Carries a *separate* risk: it is a block-stacker, and The Tetris Company enforces against clones regardless of the developer's licence. Needs a trademark read, not just a licence read. |
| **Attack on Voxelburg** | nuclear / MutantStargoat | GPL-3.0+ | GBA Jam 2022, still maintained. |
| **Minicraft for GBA** | Vulcalien | GPL-3.0+ | Port of someone else's game. Skip regardless of licence. |
| **piuGBA (demo)** | afska | MIT code | Not GPL, but listed here because the music is the game and is not the author's to license. Skip. |
| *(11 Game Boy titles)* | various | GPL-family | Excluded by D-008's original filter. The same policy decision would restore them. |

Deciding this is worth doing on its own: it is the difference between ~5 and ~7
usable GBA titles, and between 15 and ~26 Game Boy ones. It is a licensing
decision, not a content one, and it should get a decision record.

## What this adds up to

The GBA library reachable without asking anyone turned out to be **two titles**,
not four: the audit removed Skyland and MeteoRain. Both survivors shipped. That
is a foothold, not a console launch. GBA becomes
worth shipping only if tier 2 lands — and the single ask that would change the
picture is Goodboy Galaxy.

Which means the order of work is: **ask first, build second.** The runtime spike
proves the engineering is tractable; the content is the constraint, and the
content is correspondence.
