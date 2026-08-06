import type { NextConfig } from 'next';

/**
 * The API's origin as seen from the Next.js server process.
 * In development that is the local Express server; in production it is the
 * deployed API. Never exposed to the browser. See the rewrite below.
 */
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:8000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Proxy `/api/*` to the Express server so the browser only ever talks to this
   * origin.
   *
   * This is what makes cookie authentication work without weakening it. If the
   * browser called the API directly on another origin, the session cookies
   * would have to be `SameSite=None`, which removes the browser's built-in CSRF
   * protection and does not work over plain HTTP in local development at all.
   * Same-origin means `SameSite=Lax` is enough.
   */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },

  images: {
    /**
     * Avatars, logos and attachments are served as bytes from our own API, so
     * no remote hosts are needed. Keeping this list empty means a compromised
     * settings value cannot turn the image optimiser into an open proxy.
     */
    remotePatterns: [],
    formats: ['image/webp'],
  },

  /**
   * Baseline security headers for the HTML responses Next.js serves.
   * The API sets its own via Helmet.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },

  experimental: {
    /**
     * Ant Design ships a very large barrel file. Without this, importing three
     * components pulls the whole library into the client bundle.
     */
    optimizePackageImports: ['antd', '@ant-design/icons'],
  },
};

export default config;
