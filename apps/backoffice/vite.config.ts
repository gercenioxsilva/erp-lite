/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In Docker: API_PROXY_TARGET=http://api-core:3000  (internal Compose network)
// On host:   falls back to http://localhost:3001     (exposed host port)
const API_TARGET = process.env['API_PROXY_TARGET'] ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1':     { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals:     true,
    setupFiles:  ['./src/test/setup.ts'],
    css:         false,
    include:     ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
