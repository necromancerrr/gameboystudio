# Vendored binjgb build

`binjgb.js` and `binjgb.wasm` are prebuilt WebAssembly artifacts from
[binjgb](https://github.com/binji/binjgb) by Ben Smith, MIT licensed.

Retrieved from the project's GitHub Pages build at https://binji.github.io/binjgb/
on 2026-08-07.

These are runtime static assets, not an npm dependency — binjgb is not published
to npm. See D-006.

## Before shipping

These artifacts are a convenience build for development. For production, build
from a pinned upstream commit with Emscripten rather than trusting a rolling
gh-pages artifact, and record the commit hash here.
