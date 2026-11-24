import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Permite publicar también en una subcarpeta (GitHub Pages, etc.).
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500
  }
});
