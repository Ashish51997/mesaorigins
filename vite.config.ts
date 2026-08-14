import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // The Express bundle is emitted to dist/server. Keeping the browser root
      // separate makes it impossible for express.static to publish server code.
      outDir: 'dist/client',
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // Keep any historical local data.json snapshot outside HMR. It is retained
      // only for manual recovery and is no longer read or written by the app.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/data.json'] },
    },
  };
});
