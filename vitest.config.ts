import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "evals/**/*.test.ts",
      "tests/**/*.test.ts"
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
});
