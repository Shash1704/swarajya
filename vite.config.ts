import { defineConfig } from 'vite';

// Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  build: {
    // The 3D battlefield (Babylon.js) is one large chunk, loaded only when a battle starts.
    chunkSizeWarningLimit: 1200,
  },
});
