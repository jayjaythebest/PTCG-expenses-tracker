import { defineConfig } from 'vitest/config';

// Minimal Vitest config for lightweight pure-function unit tests (pricing
// helpers + collection-value math). Node environment; no DOM needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    // A pure-logic test can still import a module that imports the Supabase
    // client (batchScan.test -> gemini -> apiFetch -> supabase), and
    // createClient throws without a URL — which CI, having no .env, never has.
    // Placeholders let the module load; no test talks to Supabase.
    env: { VITE_SUPABASE_URL: 'http://localhost', VITE_SUPABASE_ANON_KEY: 'test' },
  },
});
