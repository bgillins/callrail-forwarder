import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow up to 300s for webhook processing (paid Vercel)
  serverExternalPackages: ["openai"],
};

export default nextConfig;
