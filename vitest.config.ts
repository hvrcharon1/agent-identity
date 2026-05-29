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
    //   packages/**     — all other publishable packages (anomaly, compliance,
    //                     dynamic store, and any future packages)
    //
    // Previously this only covered packages/core/src/**. The result was that
    // test files added in packages/integrations/compliance, packages/integrations/anomaly,
    // and packages/stores/dynamic were silently skipped by CI even though they
    // are fully valid Vitest suites (43 test cases total).
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
      '@datacules/agent-identity': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@datacules/agent-identity/schemas': path.resolve(__dirname, './packages/core/src/schemas.ts'),
      '@datacules/agent-identity/react': path.resolve(__dirname, './packages/core/src/react/index.ts'),
    },
  },
});
