import { defineConfig } from 'vitest/config';

// Minimal Vitest config for lightweight pure-function unit tests (pricing
// helpers + collection-value math). Node environment; no DOM needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
  },
});
