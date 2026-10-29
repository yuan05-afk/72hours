import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Local design preview: same app, with @forge/bridge replaced by fixture data. Never used for the Forge build.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@forge/bridge': fileURLToPath(new URL('./preview/bridge-mock.js', import.meta.url)) } },
  build: { outDir: 'preview-dist' },
});
