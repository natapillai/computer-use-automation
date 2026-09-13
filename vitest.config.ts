import { defineConfig } from 'vitest/config';

// Projects for unit, contract, integration and e2e, and the coverage gates, land at
// S3-T03. Until then there is one project and no gate, because there is nothing yet
// for a gate to measure.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
