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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
