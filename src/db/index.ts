import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { env } from "@/lib/env"
import * as schema from "./schema"

/**
 * The database client.
 *
 * The timeouts below are not tuning — they are what keeps a serverless deployment from
 * exhausting the connection pooler and hanging.
 *
 * A serverless instance is **frozen** after it responds, not torn down. postgres.js leaves
 * an idle connection open indefinitely by default (`idle_timeout` is unset), so a frozen
 * instance keeps holding a pooler slot it is not using. Enough concurrent invocations —
 * a page of prefetched links is plenty — and every slot is held by a sleeping instance.
 * New invocations then wait for a slot that never frees, and because a connection attempt
 * also had no timeout, they waited until the platform killed them at 300 seconds.
 *
 * That is the failure the deployment logs showed: 300-second timeouts and a 504 on pages
 * that work instantly against a local database.
 */
function createClient() {
  return postgres(env.DATABASE_URL, {
    // One connection per instance. Serverless invocations are single-request, so a pool
    // per instance would multiply slot usage for no benefit.
    max: 1,

    // Give the slot back rather than sitting on it while frozen. This is the setting whose
    // absence caused the outage.
    idle_timeout: 20,

    // Fail fast and visibly instead of hanging until the platform's timeout. A request
    // that cannot get a connection should return an error in seconds, not five minutes.
    connect_timeout: 10,

    // Recycle long-lived connections, so an instance that stays warm for hours does not
    // hold one slot forever.
    max_lifetime: 60 * 30,

    // Supabase's transaction-mode pooler does not support prepared statements.
    prepare: false,
  })
}

// Next.js hot-reloads modules in dev, which would otherwise leak a pool per edit.
const globalForDb = globalThis as unknown as { client?: ReturnType<typeof createClient> }
const client = globalForDb.client ?? createClient()
if (env.NODE_ENV !== "production") globalForDb.client = client

export const db = drizzle(client, { schema })
export { schema }
