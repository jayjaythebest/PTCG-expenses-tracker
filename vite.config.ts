import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({mode}) => {
  return {
    plugins: [react(), tailwindcss()],
    // `--mode demo` is the ONE switch that builds the public read-only version
    // (src/lib/demo.ts). Keeping it here rather than in a .env file matters:
    // .gitignore excludes `.env*`, so an env file would never reach Vercel or
    // CI, and the flag would silently be off in exactly the build that needs
    // it. The demo Vercel project runs `npm run build:demo`; nothing else has
    // to be configured there.
    define: mode === 'demo'
      ? {'import.meta.env.VITE_DEMO': JSON.stringify('1')}
      : {},
    // NOTE: AI provider keys (GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY)
    // are used ONLY by the serverless functions in api/ — they are intentionally
    // NOT injected into the client bundle. Do not re-add a `define` for them.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
