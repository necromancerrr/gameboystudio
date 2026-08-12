import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forge runs on the server only: it reads the filesystem, spawns npm and
  // esbuild, and imports the SDK from a generated project's own node_modules at
  // runtime. Bundling it makes the bundler try to resolve those paths at build
  // time, which it cannot and should not.
  serverExternalPackages: ['@gameboystudio/forge', '@gameboystudio/sdk'],
  // The app only ever imports forge's read side, which is filesystem-only.
  // Generation runs as a child process, so esbuild and the rest never enter
  // this build's module graph at all.
  // The dev indicator floats over the bottom-left of the viewport, which is
  // exactly where the Handheld Mode D-pad sits. Off so mobile layout can be
  // developed and screenshotted honestly. Development only either way.
  devIndicators: false,
};

export default nextConfig;
