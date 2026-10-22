import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: { optimizePackageImports: ['@phosphor-icons/react'] },
  // Baked into the page so an open window can tell when a newer version is live.
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' }
};

export default nextConfig;
