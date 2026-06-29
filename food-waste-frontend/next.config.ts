import type { NextConfig } from "next";

function getApiProxyTarget() {
  const configuredTarget = process.env.API_PROXY_TARGET?.trim();
  if (!configuredTarget) return null;

  return configuredTarget.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

const nextConfig: NextConfig = {
  output: "standalone",
  compress: true,
  poweredByHeader: false,
  async rewrites() {
    const apiProxyTarget = getApiProxyTarget();
    if (!apiProxyTarget) return [];

    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiProxyTarget}/api/v1/:path*`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${apiProxyTarget}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
