import { defineConfig } from "drizzle-kit"

// Drizzle Kit runs outside Next, so it loads .env itself rather than via src/lib/env.
const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.")

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  // Migrations are generated, reviewed and committed — never applied from a diff
  // at runtime. `strict` makes Kit ask before anything destructive.
  strict: true,
  verbose: true,
})
