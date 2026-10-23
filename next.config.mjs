/* Switchlink CRM — © 2026 Anyonaz NewTech. All rights reserved. */
const isDev = process.env.NODE_ENV !== "production";
/**
 * Content Security Policy. Scripts and styles come only from this site (Next.js
 * needs inline bootstrap scripts, hence 'unsafe-inline'; dev mode also needs eval).
 * Map tiles are the only third-party content. No plugins, no framing, forms only
 * post back here, and the browser only talks to this server.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
          { key: "Content-Security-Policy", value: csp },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
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
      {
        // KYC documents open in the browser, but sandboxed: no scripts, forms or outbound requests.
        // (Listed after the site-wide rule so this policy is the one that applies.)
        source: "/api/files/:path*",
        headers: [{ key: "Content-Security-Policy", value: "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'" }],
      },
    ];
  },
};

export default nextConfig;
