import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/helpers/setup.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 90,
        statements: 90,
        branches: 85,
        functions: 85,
      },
      exclude: [
        'node_modules',
        'dist',
        'dist-app',
        '*.config.ts',
        '*.config.js',
        'tests',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'app'),
    },
  },
});