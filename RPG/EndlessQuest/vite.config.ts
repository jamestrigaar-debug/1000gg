import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so the built game runs from whatever directory it is dropped
  // into -- 1000goals.co.uk/RPG/EndlessQuest as much as the root of a domain -- without
  // the build needing to know the path in advance.
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: {
      clientPort: 443,
    },
    cors: true,
    // @ts-ignore - allowedHosts exists in newer vite
    allowedHosts: true,
    headers: {
      'X-Frame-Options': 'ALLOWALL',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
