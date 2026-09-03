import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` is only loaded when DATABASE_URL is set (local dev / the test harness).
  // Keeping it external stops the bundler from trying to trace its optional
  // native deps; in production the Supabase HTTP driver is used instead.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
