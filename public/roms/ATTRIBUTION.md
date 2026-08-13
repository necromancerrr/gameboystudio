# ROM attribution

Every ROM in `public/roms` carries an explicit license permitting redistribution,
verified against the upstream repository rather than trusted from catalog
metadata. Game Boy ROMs are additionally verified to boot under binjgb; Game Boy
Advance ROMs are header-checked here and booted in the browser suite, because
mGBA cannot run outside a browser. See D-008 and D-026.

22 ROMs, of which 15 are listed in the catalog: 13 Game Boy / Game Boy Color
and 2 Game Boy Advance. Re-check with
`npm run verify:catalog`.

The seven marked *unlisted* below were cut from the catalog for editorial
reasons — duplicates of a better version, or nothing to distinguish them — not
for any licensing problem. Their files are kept so the decision stays reversible
and so the attribution record stays complete. See CATALOG_LINEUP.md.

| Game | Author | License | Source |
| --- | --- | --- | --- |
| 2048gb | Sanqui | Zlib | https://github.com/Sanqui/2048-gb |
| 5 mazes *(unlisted)* | godai / Gniazdo Światów | MIT | https://github.com/godai78/5-Mazes |
| 5 mazes: Master levels *(unlisted)* | godai / Gniazdo Światów | MIT | https://github.com/godai78/5-mazes-Master-levels |
| 5 more mazes *(unlisted)* | godai / Gniazdo Światów | MIT | https://github.com/godai78/5-more-mazes |
| Aevilia | ISSOtm, Kai, Parzival, Charmy | Apache-2.0 | https://github.com/ISSOtm/Aevilia-GB |
| CrossConnect | quinnp | MIT | https://github.com/QuinnPainter/CrossConnect |
| Europa rescue! | godai / Gniazdo Światów | CC-BY-SA-4.0 | https://github.com/godai78/europa |
| Flooder | Oliver Balfour | MIT | https://github.com/Obalfour/Flooder |
| GBHack | statico | MIT | https://github.com/statico/gbhack |
| JP | Graham Coulby (IonicLimb) | MIT | https://github.com/gcoulby/JP |
| Labirinth | godai / Gniazdo Światów | CC-BY-SA-4.0 | https://github.com/godai78/labirinth |
| Max Pirate *(unlisted)* | Lemmy Hawkins | MIT | https://github.com/MWehrstedt/MaxPirate |
| Max Pirate Extra Boom | Lemmy Hawkins | MIT | https://github.com/MWehrstedt/MaxPirateExtra |
| PostBot | Tobias Rojahn | MIT | https://github.com/MasterIV/PostBot |
| Renegade Rush | quinnp | MIT | https://github.com/QuinnPainter/Renegade-Rush |
| Shock Lobster | tbsp | Zlib | https://github.com/tbsp/shock-lobster |
| Snake *(unlisted)* | Yvar de Goffau | WTFPL-2.0 | https://github.com/Yvar-deGoffau/GBSnake |
| Squishy the Turtle *(unlisted)* | Cppchriscpp | MIT | https://github.com/potatolain/SquishyTheTurtle |
| Tobu Tobu Girl *(unlisted)* | Tangram Games | MIT | https://github.com/SimonLarsen/tobutobugirl |
| Tobu Tobu Girl Deluxe | Tangram Games | MIT | https://github.com/SimonLarsen/tobutobugirl-dx |
| The Hat Chooses the Wizard *(GBA)* | Corwin & Gwilym Kuiper, music "Sylvan Waltz" by Otto Halmén (CC-BY-3.0) | MPL-2.0 | https://github.com/agbrs/agb/tree/master/examples/the-hat-chooses-the-wizard |
| The Purple Night *(GBA)* | Corwin & Gwilym Kuiper, music by Sam Williams | MPL-2.0 | https://github.com/agbrs/agb/tree/master/examples/the-purple-night |

## Excluded

### License unverifiable

Permissive in Homebrew Hub metadata, but not confirmable upstream. Held back
until a human confirms the license with the author:

- No repository linked: a-slime-travel, crystal-lake, dashy-no-witch, deep-scan, gunpey
- Repository has no license file: grub-glide, domination, madpews-battlegrounds, plantboy, tuff

### Note on the two Game Boy Advance titles

Both are agb example games: MPL-2.0 repository, and audio that carries its own
compatible licence. The Hat Chooses the Wizard uses Otto Halmén's "Sylvan
Waltz", CC-BY-3.0 / OGA-BY-3.0 — commercial use permitted with credit, which the
game's own title screen already gives and the catalog entry now repeats. The
Purple Night's music is by Sam Williams, committed to the MPL-2.0 repository as a
credited contributor.

That credit was found by playing the game, not by reading the repository. It is
the reason the GBA rule is per-asset.

### Game Boy Advance: audited but held back

GBA homebrew routinely pairs a permissive code licence with assets that are not
redistributable, so for GBA the licence check is per-asset rather than
per-repository. These were audited and excluded:

- **Skyland** (evanbowman, MPL-2.0) — the strongest GBA homebrew there is, and
  the repository documents its assets properly, which is how this was caught:
  the Maryland font is a commercial licence *purchased by the author personally*
  and the music comes from PD Info tracks *licensed to the author by name*.
  Neither is obviously sublicensable to us. One email would probably settle it.
- **MeteoRain** (Dr. Ludos, MIT) — code is MIT, but the title screen credits
  "music by WARLORD" and no licence for it is recorded anywhere in the
  repository.
- **Butano Fighter** and **Varooom 3D** (GValiente, zlib) — music, models and
  palettes are CC BY-NC-SA and CC BY-NC-ND.
- **BeatBeast** (afska, MIT) — GBA Jam 2024 winner; every music and most SFX
  files are CC BY-NC 4.0.

GPL-family titles (Apotris, Attack on Voxelburg) are excluded pending a
licensing policy, not on their merits. See ACQUISITION.md.

### Does not run

- **Rex Runner GB** (The Void, MIT) — license is fine, but the ROM renders a
  blank screen under binjgb even after 20 emulated seconds and input. Its cart
  header is valid (MBC5+RAM+battery, 32K, CGB-compatible), so this is a core
  compatibility gap rather than a bad download. Revisit if the core is updated.

## Note on the 5 mazes family

Homebrew Hub records CC-BY-SA 4.0 for `5 mazes`, `5 mazes: Master levels` and
`5 more mazes`; the upstream repositories carry MIT. Both permit
redistribution. The upstream license is recorded here as authoritative.
