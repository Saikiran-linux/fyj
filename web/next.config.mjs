/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API is a separate Cloudflare Worker (NEXT_PUBLIC_API_URL); this app is
  // UI only. For Cloudflare Pages deployment, add @opennextjs/cloudflare and its
  // build step (see docs/INFRA-SETUP.md) — kept out of the shell so it builds
  // as a standard Next app today.
};

export default nextConfig;
