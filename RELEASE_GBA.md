# RELEASE_GBA.md

Deploying the Game Boy Advance release (D-026).

**The order is not optional, and the documented deploy command is not safe to
run as-is.** Both are explained below. Read the whole file before deploying.

---

## Why the order matters

The application became cross-origin isolated in this release: every page now
sends `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, because the mGBA core is a
pthreads build and needs SharedArrayBuffer.

An isolated document refuses to load a cross-origin resource that has not opted
in. The application has exactly one such resource: the hosted-games origin
(D-019), which the app fetches a manifest from and frames a game from.

So:

| Order | Result |
|---|---|
| Worker first, then app | Correct. The Worker's new headers are already live when the isolated app arrives. |
| App first, then Worker | **Every hosted game breaks** for the window between the two deploys. The manifest fetch fails and the frame refuses to load. |
| Worker only | Fine. The new headers are inert until an isolated document asks for the resource. |

The Worker change is two response headers in `hosted-origin/src/index.ts`:
`cross-origin-resource-policy: cross-origin` and
`cross-origin-embedder-policy: require-corp`. Nothing else about that Worker
changed, and neither header grants access to anything — the origin already
served these files with `access-control-allow-origin: *`.

## The hazard: `npm run hosted:deploy` destroys live content

`hosted-origin/public/` is a **build output directory**, gitignored except for
`404.html` and `manifest.example.json`. `wrangler deploy` uploads whatever is in
it and removes what is not. So the obvious sequence —

```
npm run hosted:build && npm run hosted:deploy
```

— replaces production's asset set with a locally built one. Verified on
2026-08-12, before deploying:

- **Live** origin serves one game: `sequence`, at
  `https://gameboystudio-hosted.yejigu.workers.dev/games/sequence/1.0.0/frame.html`
- **`npm run hosted:build`** produces a different two: `ring-out-hosted` and
  `drift-hosted`, with `frameUrl`s pointing at **`http://127.0.0.1:8788`**

Running the documented command would have deleted the live game and published
two that point at localhost.

The cause is that two publishing paths write to one Worker. `hosted-games/`
builds the sample games (M6); the forge pipeline publishes generated games (M7),
which is where `sequence` came from. Neither knows about the other, and the
deploy step has no notion of "merge with what is already there".

**That is a real gap and it is not this release's to fix.** What this release
needs is a Worker deploy that changes the code and leaves the assets alone.

## Safe deploy procedure

### 1. Mirror production's assets locally

Take the live asset set as the source of truth, so the deploy changes code only.
Every hosted game is reachable from the manifest (D-018), so the manifest is a
complete index.

```bash
cd hosted-origin/public
curl -sO https://gameboystudio-hosted.yejigu.workers.dev/manifest.json
python3 - <<'EOF'
import json, os, urllib.request
manifest = json.load(open('manifest.json'))
for game in manifest['games']:
    base = game['frameUrl'].rsplit('/', 1)[0]
    out = base.split('.workers.dev', 1)[1].lstrip('/')
    os.makedirs(out, exist_ok=True)
    for name in ('frame.html', 'bundle.js'):
        urllib.request.urlretrieve(f'{base}/{name}', f'{out}/{name}')
        print('mirrored', f'{out}/{name}')
EOF
```

Confirm the mirror matches the live manifest before continuing: same game
slugs, same versions, `frameUrl`s still absolute and still pointing at the
workers.dev origin — **not** at 127.0.0.1.

### 2. Deploy the Worker

```bash
npm run hosted:deploy
```

Then confirm the headers and that the game set is unchanged:

```bash
curl -sI https://gameboystudio-hosted.yejigu.workers.dev/manifest.json | grep -i cross-origin
curl -s https://gameboystudio-hosted.yejigu.workers.dev/manifest.json | head -20
```

Expect `cross-origin-resource-policy: cross-origin` and
`cross-origin-embedder-policy: require-corp`, and the same games as before.

### 3. Deploy the app

The app is on Vercel (`https://gameboy-jet.vercel.app`) and deploys from `main`:

```bash
git push origin main
```

### 4. Sanity check, and nothing more

Three pages, one of each runtime:

- a hosted game — proves the isolation change did not break the frame
- a Game Boy or Game Boy Color game — proves no regression
- a Game Boy Advance game — proves the new runtime works in production

Check `window.crossOriginIsolated === true` on any page while there.

## Rollback

`wrangler rollback` on the Worker, and Vercel's previous deployment for the app.
Roll back in the reverse order of deploy — app first, then Worker — so the two
are never mismatched in the direction that breaks hosted games.
