/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',

  // ─── @libsql/client — keep out of the webpack server bundle ────────────────
  // @libsql/client ships native Node.js bindings that webpack cannot bundle.
  // Without this, Next.js tries to inline the package when it appears inside
  // the dynamic-import chunk for @datacules/agent-identity-store-libsql and
  // the build fails. With it, Next.js emits a plain require('@libsql/client')
  // in the server output that Node.js resolves at runtime from node_modules.
  experimental: {
    serverComponentsExternalPackages: ['@libsql/client'],
  },

  webpack: (config, { dev }) => {
    // ─── .js → .ts extension alias for workspace package source files ──────
    // tsconfig.json path aliases direct webpack to the TypeScript source of
    // workspace packages (e.g. packages/stores/libsql/src/index.ts).  Those
    // source files re-export with .js extensions
    //   export { LibSqlBudgetStore } from './LibSqlBudgetStore.js'
    // which is valid TypeScript-first ESM style, but webpack looks for the
    // literal .js file and fails with "Module not found" because only .ts
    // files exist.  extensionAlias tells webpack to try .ts before giving up.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js':  ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };

    // ─── Windows dev-server webpack cache fix ────────────────────────────────
    // The default file-based webpack PackFileCacheStrategy performs an
    // atomic rename (e.g. 0.pack.gz_ → 0.pack.gz) to swap the new cache
    // file into place. On Windows, a concurrent lock held by the Next.js
    // file watcher causes this rename to fail with ENOENT, spewing warnings
    // on every hot reload.  Switching to in-memory cache in dev eliminates
    // the rename entirely and makes hot-reload silent on Windows.
    // Production builds are not affected (next build sets dev:false).
    if (dev) {
      config.cache = { type: 'memory' };
    }

    return config;
  },
};

module.exports = nextConfig;
