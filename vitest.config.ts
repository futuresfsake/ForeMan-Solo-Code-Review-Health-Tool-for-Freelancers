import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several tests create a real git repository and run git a dozen times.
    // On a busy Windows CI runner that has taken more than the 5 second
    // default, which failed the build with nothing actually wrong.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
