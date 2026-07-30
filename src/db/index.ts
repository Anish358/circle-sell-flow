import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { env } from "@/lib/env"
import * as schema from "./schema"

/**
 * One connection per process. `max: 1` because serverless invocations are
 * short-lived and each holds its own pool; `prepare: false` because Supabase's
 * transaction-mode pooler does not support prepared statements.
 */
function createClient() {
  return postgres(env.DATABASE_URL, { max: 1, prepare: false })
}

// Next.js hot-reloads modules in dev, which would otherwise leak a pool per edit.
const globalForDb = globalThis as unknown as { client?: ReturnType<typeof createClient> }
const client = globalForDb.client ?? createClient()
if (env.NODE_ENV !== "production") globalForDb.client = client

export const db = drizzle(client, { schema })
export { schema }
