import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite dev server must use a fixed port for the Tauri dev-window.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'es2021',
  },
});
