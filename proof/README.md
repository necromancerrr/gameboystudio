# proof/

`sequence/` is the game M6 was proved with: authored outside this repository,
against the SDK tarball, with no `@/` alias, no import from `src/`, no workspace
resolution and no symlink back here.

It is kept as a record, not as a buildable part of this project. **Do not add it
to a workspace or wire it into the app's build** — the moment it resolves
anything from this repository it stops being evidence of anything.

To work on it, copy it somewhere else and install the SDK the way a creator
would:

```bash
cp -R proof/sequence ~/somewhere/sequence && cd ~/somewhere/sequence
npm run --prefix /path/to/gameboy sdk:pack     # produces dist-sdk/*.tgz
npm install /path/to/gameboy/dist-sdk/gameboystudio-sdk-1.0.0.tgz
npx gbs dev .        # play it
npx gbs check .      # would the platform accept it?
```

It was verified with this repository moved off disk entirely, which is the only
version of that claim worth making.
