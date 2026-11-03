import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    "@orbit/shared",
    "@orbit/core",
    "@orbit/database",
    "@orbit/storage",
    "@orbit/providers",
    "@orbit/integrations",
    "@orbit/workspaces",
  ],
  devIndicators: false,
  experimental: { cpus: 2 },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(),microphone=(),geolocation=()",
          },
          ...(["staging", "production"].includes(process.env.ORBIT_ENV ?? "")
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
            : []),
        ],
      },
    ];
  },
};
export default config;
