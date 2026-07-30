import { defineConfig } from "vitest/config"

/**
 * Unit tests: pure logic, no database. `npm test` runs these, so a reviewer can
 * clone and run the suite without Docker.
 *
 * Integration tests live in `*.db.test.ts` and run via `npm run test:db`.
 */
export default defineConfig({
  // Resolve the `@/*` alias from tsconfig so tests import exactly what the app imports.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/*.db.test.ts"],
  },
})
