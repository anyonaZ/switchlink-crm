/* Switchlink CRM — © 2026 Anyonaz NewTech. All rights reserved. */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=()" },
          // Authorship signature (see src/lib/signature.ts).
          { key: "X-Software", value: "Switchlink CRM" },
          { key: "X-Software-Author", value: "Anyonaz NewTech" },
          { key: "X-Software-Signature", value: "SLCRM-ANZ-2026-22618b25b6481b46c0702c9c" },
        ],
      },
    ];
  },
};

export default nextConfig;
