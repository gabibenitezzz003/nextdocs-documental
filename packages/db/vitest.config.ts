import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.prueba.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
