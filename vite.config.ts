import { defineConfig } from 'vite';

// Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  build: {
    // Babylon.js and WebLLM are large chunks, loaded only when needed (3D view; in-browser AI).
    chunkSizeWarningLimit: 7000,
  },
});
