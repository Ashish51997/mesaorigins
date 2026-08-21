import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const src = (p: string) => path.resolve(__dirname, 'src', p);

// Separate from vite.config.ts so component tests run under jsdom without the
// Tailwind build plugin. Only *.test.tsx / *.spec.tsx files are picked up.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': src('shared'),
      '@platform': src('platform'),
      '@mesaops': src('mesaops'),
      '@mesaerp': src('mesaerp'),
      '@mesaleads': src('mesaleads'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}']
  }
});
