import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev indicator floats over the bottom-left of the viewport, which is
  // exactly where the Handheld Mode D-pad sits. Off so mobile layout can be
  // developed and screenshotted honestly. Development only either way.
  devIndicators: false,
};

export default nextConfig;
