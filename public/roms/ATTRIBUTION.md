# ROM attribution

Every ROM in `public/roms` carries an explicit license permitting redistribution,
verified against the upstream repository rather than trusted from catalog
metadata, and boots successfully under binjgb. See D-008.

20 titles. Re-check with `npm run verify:catalog`.

| Game | Author | License | Source |
| --- | --- | --- | --- |
| 2048gb | Sanqui | Zlib | https://github.com/Sanqui/2048-gb |
| 5 mazes | godai / Gniazdo Światów | MIT | https://github.com/godai78/5-Mazes |
| 5 mazes: Master levels | godai / Gniazdo Światów | MIT | https://github.com/godai78/5-mazes-Master-levels |
| 5 more mazes | godai / Gniazdo Światów | MIT | https://github.com/godai78/5-more-mazes |
| Aevilia | ISSOtm, Kai, Parzival, Charmy | Apache-2.0 | https://github.com/ISSOtm/Aevilia-GB |
| CrossConnect | quinnp | MIT | https://github.com/QuinnPainter/CrossConnect |
| Europa rescue! | godai / Gniazdo Światów | CC-BY-SA-4.0 | https://github.com/godai78/europa |
| Flooder | Oliver Balfour | MIT | https://github.com/Obalfour/Flooder |
| GBHack | statico | MIT | https://github.com/statico/gbhack |
| JP | Graham Coulby (IonicLimb) | MIT | https://github.com/gcoulby/JP |
| Labirinth | godai / Gniazdo Światów | CC-BY-SA-4.0 | https://github.com/godai78/labirinth |
| Max Pirate | Lemmy Hawkins | MIT | https://github.com/MWehrstedt/MaxPirate |
| Max Pirate Extra Boom | Lemmy Hawkins | MIT | https://github.com/MWehrstedt/MaxPirateExtra |
| PostBot | Tobias Rojahn | MIT | https://github.com/MasterIV/PostBot |
| Renegade Rush | quinnp | MIT | https://github.com/QuinnPainter/Renegade-Rush |
| Shock Lobster | tbsp | Zlib | https://github.com/tbsp/shock-lobster |
| Snake | Yvar de Goffau | WTFPL-2.0 | https://github.com/Yvar-deGoffau/GBSnake |
| Squishy the Turtle | Cppchriscpp | MIT | https://github.com/potatolain/SquishyTheTurtle |
| Tobu Tobu Girl | Tangram Games | MIT | https://github.com/SimonLarsen/tobutobugirl |
| Tobu Tobu Girl Deluxe | Tangram Games | MIT | https://github.com/SimonLarsen/tobutobugirl-dx |

## Excluded

### License unverifiable

Permissive in Homebrew Hub metadata, but not confirmable upstream. Held back
until a human confirms the license with the author:

- No repository linked: a-slime-travel, crystal-lake, dashy-no-witch, deep-scan, gunpey
- Repository has no license file: grub-glide, domination, madpews-battlegrounds, plantboy, tuff

### Does not run

- **Rex Runner GB** (The Void, MIT) — license is fine, but the ROM renders a
  blank screen under binjgb even after 20 emulated seconds and input. Its cart
  header is valid (MBC5+RAM+battery, 32K, CGB-compatible), so this is a core
  compatibility gap rather than a bad download. Revisit if the core is updated.

## Note on the 5 mazes family

Homebrew Hub records CC-BY-SA 4.0 for `5 mazes`, `5 mazes: Master levels` and
`5 more mazes`; the upstream repositories carry MIT. Both permit
redistribution. The upstream license is recorded here as authoritative.
