import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser only ever talks to Vite (port 5173); Vite forwards /api to Express.
// Database credentials therefore never reach the browser.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true },
    },
  },
});
