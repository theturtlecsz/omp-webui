import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/ws': { target: 'http://127.0.0.1:7483', ws: true }, '/api': { target: 'http://127.0.0.1:7483', ws: true } } },
  test: { environment: 'jsdom', setupFiles: './test/setup.ts', globals: true },
});
