import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Forge serves the resource from a sub-path, so assets must be relative.
export default defineConfig({ base: './', plugins: [react()] });
