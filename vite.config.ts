import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { devApiPlugin } from './src/server/devApiMiddleware';

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: false,
  },
});
