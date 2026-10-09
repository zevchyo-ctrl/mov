/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The public viewer reads the JSON store from disk on every request so that
  // admin changes are visible to visitors immediately after publishing.
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
  },

  /**
   * Security headers applied to THIS site's own pages.
   *
   * Important: these headers protect our pages (e.g. /preview may only be
   * framed by our own /admin7jo). They do NOT — and technically cannot —
   * control whether a THIRD-PARTY site allows itself to be framed. Only the
   * target site's own X-Frame-Options / CSP frame-ancestors decide that.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
