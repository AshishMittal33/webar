import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required for WebXR. The dev server serves a self-signed
// certificate so an Android phone on the same Wi-Fi can open it.
// Production (GitHub Pages) provides real HTTPS; nothing here is tied to
// localhost. Relative asset paths let the build run from any folder, such
// as https://<user>.github.io/webar/.
export default defineConfig({
  base: './',
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
