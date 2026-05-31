import { defineConfig } from 'vitest/config';
import path from 'path';

// NOTE: When adding component tests (.test.tsx) that render React,
// import @vitejs/plugin-react and add it to plugins here:
//   import react from '@vitejs/plugin-react';
//   plugins: [react()],
// The import is intentionally omitted for now because:
//   1. All current tests are .test.ts with environment:'node' — no JSX needed.
//   2. tsconfig.json includes vitest.config.ts in the tsc pass. The default
//      import of @vitejs/plugin-react triggers a TS2306 error under
//      isolatedModules:true until the module ships an explicit default export
//      declaration in its .d.ts (it uses export = in v4.x).

export default defineConfig({
  test: {
    environment: 'node',
    // Include tests from:
    //   src/            — Next.js app layer (API routes, components)
    //   packages/core/  — @datacules/agent-identity core package
    //   packages/**     — all other publishable packages
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'packages/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Resolve workspace package imports to source during vitest runs
      // so tests don't require a prior `npm run build:packages`.
      '@datacules/agent-identity':              path.resolve(__dirname, './packages/core/src/index.ts'),
      '@datacules/agent-identity/schemas':      path.resolve(__dirname, './packages/core/src/schemas.ts'),
      '@datacules/agent-identity/react':        path.resolve(__dirname, './packages/core/src/react/index.ts'),
      '@datacules/agent-identity-anomaly':      path.resolve(__dirname, './packages/integrations/anomaly/src/index.ts'),
      // Cloud store packages — resolved to source so tests and credentialStore.ts
      // can import them without a prior build step.
      '@datacules/agent-identity-store-vault':  path.resolve(__dirname, './packages/stores/vault/src/index.ts'),
      '@datacules/agent-identity-store-aws':    path.resolve(__dirname, './packages/stores/aws/src/index.ts'),
      '@datacules/agent-identity-store-azure':  path.resolve(__dirname, './packages/stores/azure/src/index.ts'),
      // Token exchange integration — resolved to source
      '@datacules/agent-identity-token-exchange': path.resolve(__dirname, './packages/integrations/token-exchange/src/index.ts'),
    },
  },
});
