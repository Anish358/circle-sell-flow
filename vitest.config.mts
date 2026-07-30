import { defineConfig } from "vitest/config"

export default defineConfig({
  // Resolve the `@/*` alias from tsconfig so tests import exactly what the app imports.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
})
