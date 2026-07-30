import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

import { env } from "@/lib/env"

/**
 * Applies every pending migration in ./drizzle, in order.
 *
 * Kept as a script rather than a Drizzle Kit invocation so the exact same code
 * path runs locally, in CI and against the deployed database.
 */
async function main() {
  // `max: 1` — migrations must run serially on a single connection.
  const client = postgres(env.DATABASE_URL, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" })
    console.log("Migrations applied.")
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
