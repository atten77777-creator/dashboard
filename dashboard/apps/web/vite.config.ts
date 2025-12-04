import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 5173,
    open: false,
    fs: { strict: false },
  },
  plugins: [react()] as unknown as import('vite').PluginOption[],
});