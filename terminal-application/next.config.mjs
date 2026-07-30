/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 14 gates instrumentation.ts behind this flag (stable in 15).
  // Without it, register() never runs and Lane 1's poller never boots.
  experimental: {
    instrumentationHook: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      // CoinGecko serves coin logos from these two hosts (older assets.* + newer coin-images.*)
      {
        protocol: "https",
        hostname: "coin-images.coingecko.com",
      },
      {
        protocol: "https",
        hostname: "assets.coingecko.com",
      },
    ],
  },
};

export default nextConfig;
