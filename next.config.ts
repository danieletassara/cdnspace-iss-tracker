import type { NextConfig } from "next";
import { execSync } from "child_process";

function getGitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_BUILD_ID: getGitHash(),
  },
  generateBuildId: async () => {
    return getGitHash();
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
          {
            key: "Expires",
            value: "0",
          },
        ],
      },
      {
        source: "/embed",
        headers: [
          // "ALLOWALL" is not a valid X-Frame-Options value (browsers ignore
          // it), so it was a no-op. Framing of /embed is allowed by the CSP
          // frame-ancestors directive below, which supersedes X-Frame-Options.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
