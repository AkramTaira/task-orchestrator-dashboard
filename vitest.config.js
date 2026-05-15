import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/core/__tests__/**/*.test.js"],
  },
});