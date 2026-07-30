import { loadEnv } from "vite"
import { defineConfig } from "vitest/config"

/**
 * Integration tests. They read from a real, seeded Postgres — the resolver's
 * substance is a recursive CTE, and a mocked version of it would test nothing.
 *
 * Needs `npm run db:migrate && npm run db:seed` first. CI does exactly that.
 */
export default defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    // Vitest does not read .env into process.env on its own, and the db client
    // validates its environment at import time. An empty prefix loads every key.
    env: loadEnv(mode, process.cwd(), ""),
    // One database, so no parallel writers — and these only read anyway.
    fileParallelism: false,
  },
}))
