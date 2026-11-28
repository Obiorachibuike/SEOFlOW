/** @type {import('next').NextConfig} */

// Optional transition redirect for the Vercel consolidation: when REDIRECT_SECONDARY_HOST
// is set on a project (the duplicate deployment), every request to that host is permanently
// redirected to CANONICAL_APP_ORIGIN. The canonical project leaves both variables unset.
const secondaryHost = process.env.REDIRECT_SECONDARY_HOST?.trim();
function canonicalOrigin() {
  try {
    const parsed = new URL((process.env.CANONICAL_APP_ORIGIN ?? "").trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

const nextConfig = {
  poweredByHeader: false,
  experimental: { optimizePackageImports: ["lucide-react", "recharts"] },
  async redirects() {
    const origin = canonicalOrigin();
    if (!secondaryHost || !origin) return [];
    return [{
      source: "/:path*",
      has: [{ type: "host", value: secondaryHost }],
      destination: `${origin}/:path*`,
      permanent: true
    }];
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
      ]
    }];
  }
};
export default nextConfig;
