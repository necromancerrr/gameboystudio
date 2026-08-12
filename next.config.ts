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
         * SPIKE ONLY. The mGBA build is a pthreads build, so it needs
         * SharedArrayBuffer, so the document must be cross-origin isolated.
         *
         * Scoped to the spike route on purpose. Applying this site-wide would
         * mean every cross-origin subresource has to opt in with CORP, and the
         * hosted-games iframe (D-018/D-019) is served from a different origin —
         * so a global COEP is a decision about the hosted-origin contract, not
         * a header tweak. See GBA_SPIKE.md.
         */
        source: "/spike/gba",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        /**
         * The core spawns a pool of pthread workers, each of which re-fetches
         * mgba.js. A dedicated worker started from a cross-origin-isolated
         * document must itself be served with COEP, same-origin or not — without
         * these headers every worker request fails ERR_BLOCKED_BY_RESPONSE and
         * the module factory simply never resolves. No error, no rejection: the
         * page sits on "loading" forever. Found the hard way.
         */
        source: "/emulator/mgba/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
