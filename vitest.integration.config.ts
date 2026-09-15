import { defineConfig } from 'vitest/config';

// Each file starts its own target app on an ephemeral port and its own browser. Files run
// one at a time. With seven files each launching Chromium, broker sessions, which route
// every request through the network guard, timed out loading the frameset while the same
// files passed in a smaller run. A serial run was the project owner's chosen test of
// whether that was contention, and it passed twice.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
