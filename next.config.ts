import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forge runs on the server only: it reads the filesystem, spawns npm and
  // esbuild, and imports the SDK from a generated project's own node_modules at
  // runtime. Bundling it makes the bundler try to resolve those paths at build
  // time, which it cannot and should not.
  serverExternalPackages: ['@gameboystudio/forge', '@gameboystudio/sdk'],
  // The dev indicator floats over the bottom-left of the viewport, which is
  // exactly where the Handheld Mode D-pad sits. Off so mobile layout can be
  // developed and screenshotted honestly. Development only either way.
  devIndicators: false,

  async headers() {
    return [
      {
        /**
         * Cross-origin isolation, site-wide. See D-026.
         *
         * The mGBA build is a pthreads build: it needs SharedArrayBuffer, which
         * needs an isolated document. Scoping this to the player route was the
         * first instinct and does not work — a hosted game and a Game Boy
         * Advance game are both `/games/[slug]`, so there is no route to scope
         * it to.
         *
         * The cost is real and is paid in one place: every cross-origin
         * subresource now has to opt in. The only one we have is the hosted
         * games origin (D-019), which we own, and which sets CORP and COEP on
         * its own responses to match. A third-party embed added later has to do
         * the same or it will not load.
         */
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
      {
        /**
         * The core spawns a pool of pthread workers, each of which re-fetches
         * mgba.js. A dedicated worker started from an isolated document must
         * itself be served with COEP, same-origin or not. Without this, every
         * worker request fails ERR_BLOCKED_BY_RESPONSE and the module factory
         * never resolves — no error, no rejection, no console output.
         */
        source: '/emulator/mgba/:path*',
        headers: [
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
