/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // ─── @libsql/client — keep out of the webpack bundle ─────────────────────
  // @libsql/client uses native Node.js bindings (the libsql Rust/WASM addon).
  // webpack cannot bundle native addons; telling Next.js to treat the package
  // as external causes it to emit a plain `require('@libsql/client')` in the
  // server output that Node.js resolves at runtime from node_modules.
  //
  // This is required because the tsconfig.json paths entry for
  // @datacules/agent-identity-store-libsql now points webpack to the
  // TypeScript source files in packages/stores/libsql/src/, which
  // transitively reference @libsql/client. Without this setting the
  // production build fails with:
  //
  //   Module build failed: @libsql/client cannot be bundled
  //   (or: README.md Module parse failed: Unexpected token)
  experimental: {
    serverComponentsExternalPackages: ['@libsql/client'],
  },

  // ─── Windows dev-server webpack cache fix ────────────────────────────────
  // The default file-based webpack PackFileCacheStrategy performs an atomic
  // rename (e.g. 0.pack.gz_ → 0.pack.gz) to swap the new cache file into
  // place. On Windows, a concurrent lock held by the Next.js file watcher
  // causes this rename to fail with ENOENT, spewing warnings on every hot
  // reload:
  //
  //   [webpack.cache.PackFileCacheStrategy] Caching failed for pack: Error:
  //   ENOENT: no such file or directory, rename
  //   'S:\\...\\agent-identity\\.next\\cache\\webpack\\...\\0.pack.gz_'
  //       -> 'S:\\...\\agent-identity\\.next\\cache\\webpack\\...\\0.pack.gz'
  //
  // Switching the dev cache to in-memory eliminates the rename entirely and
  // makes hot-reload silent on Windows.
  //
  // Production builds are not affected — `next build` sets dev:false, so
  // the filesystem cache is preserved and incremental builds remain fast.
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = { type: 'memory' };
    }
    return config;
  },
};

module.exports = nextConfig;
