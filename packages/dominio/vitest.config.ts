import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.prueba.ts'],
    environment: 'node',
  },
});
