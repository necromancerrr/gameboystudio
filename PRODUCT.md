# PRODUCT.md

## GameBoyStudio

GameBoyStudio is an instant-play gaming platform for the web, built
controller-first. See VISION.md and PLATFORM_DIRECTION.md for the platform
direction; this document covers the current product.

The first release focuses on Game Boy and Game Boy Color games that the platform is authorized to distribute. Players browse a visual game library, choose a title, and play immediately using keyboard or a connected controller.

## Product Promise

Retro games should be as easy to start as playing a video on a modern streaming platform.

No emulator configuration.
No ROM upload flow.
No confusing setup.
No desktop application.

Pick a game and play.

## The Catalog Has No Nostalgia Hook

An earlier version of this document assumed players would recognize the games
and arrive for nostalgia. That is false and worth stating plainly.

The catalog is 20 obscure homebrew titles. Nobody has heard of any of them, and
the platform legally cannot host recognizable commercial classics. There is no
"I remember this!" moment available.

The product must therefore win on **curation and feel** — how good it feels to
arrive, choose, and start — not on recognition. This changes what the library
has to do: it must make unknown games look worth trying.

## Primary User Journey

1. Player lands on the library.
2. Player sees gameplay and metadata that make an unfamiliar game look worth trying.
3. Player chooses a game.
4. Game page loads.
5. Emulator initializes automatically.
6. Player uses keyboard or controller.
7. Player can enter fullscreen.
8. Player can reset or leave and choose another game.

## MVP Audience

People who:
- want something good to play in the next thirty seconds
- own a modern controller and would rather use it
- do not want to configure emulators manually
- are willing to try a game they have never heard of if it looks appealing
- enjoy small, approachable games

## MVP Features

Required:
- Game Boy / Game Boy Color catalog
- Search — **listed here but not yet built**
- Basic filtering
- Game page
- Browser emulation
- Keyboard controls
- Controller support
- Reset
- Pause/resume if supported cleanly
- Audio toggle
- Fullscreen

Nice later:
- Favorites
- Recently played
- Save states
- Playtime tracking
- Accounts
- Cloud saves
- Achievements
- Ratings
- Social features
- Leaderboards
- More consoles

## Non-Goals For V1

- Universal emulator frontend
- ROM management tool
- User ROM uploads
- Multiplayer
- Marketplace
- Social network
- Game streaming infrastructure
- Native apps

## Design Personality

Premium, nostalgic, restrained, playful.

The product should respect the visual history of retro gaming without becoming a parody of it.
