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
    host: '127.0.0.1', // 严格限制绑定本地回环地址，防止局域网未鉴权暴露
    port: 3000,
    open: false,
  },
});
