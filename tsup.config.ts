import { defineConfig } from 'tsup';

// The package is consumed from Next.js App Router layouts (e.g. layout.tsx),
// which are Server Components by default. ErrorBoundary is a React class
// component and ErrorBridge uses browser-only APIs (window, postMessage),
// so the whole module must be a client boundary.
//
// Individual source files carry `'use client'` directives, but tsup strips
// them during bundling. Inject a single banner at the top of the output so
// Next.js treats the published entry as a client module.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  banner: {
    js: "'use client';",
  },
  external: ['react', 'react-dom'],
});
