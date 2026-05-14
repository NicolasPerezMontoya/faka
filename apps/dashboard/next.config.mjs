/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // RESEARCH §1 — monorepo: transpile workspace packages so Next can compile their TS.
  transpilePackages: ['@faka/ui', '@faka/auth', '@faka/connectors', '@faka/schema', '@faka/db'],
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',     // CSV uploads up to 20MB (RESEARCH §6 Pitfall 6).
    },
  },
  // RESEARCH Pitfall 5 — block accidental client-bundling of server-only secrets.
  // The lint rule in @faka/config/eslint.base.cjs handles source-time enforcement;
  // this is a runtime backstop.
  serverRuntimeConfig: {},
  publicRuntimeConfig: {},
  // F1 workspace packages compile-time .js imports → .ts resolution.
  // Required because @faka/* packages write imports as `./foo.js` (ESM
  // convention from TS source) but the actual files are .ts. Without
  // this alias, webpack fails with "Can't resolve './lib/cn.js'".
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
