import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts", "apps/api/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "json-summary"] },
  },
});
