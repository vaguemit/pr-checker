import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: {
    // Stub PostCSS so vite doesn't walk up to the home-dir postcss.config.mjs
    postcss: { plugins: [] },
  },
  test: {
    environment: 'node',
  },
});
