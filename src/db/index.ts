import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { env } from "@/lib/env"
import * as schema from "./schema"

/**
 * The database client.
 *
 * A serverless instance is **frozen** after it responds, not torn down, and its open
 * connection keeps occupying a slot in Supabase's pooler. Enough frozen instances and every
 * slot belongs to something asleep; new requests then wait for a slot that never frees.
 *
 * The important limitation to be honest about: `idle_timeout` and `max_lifetime` are
 * client-side timers, and **timers do not run in a frozen instance**. They reclaim a
 * connection on an instance that is still awake, which helps, but they cannot reclaim one
 * from an instance that is asleep. There is no client-side setting that can — reclaiming
 * those is the pooler's job.
 *
 * So the durable defences are elsewhere, and they are what actually matter:
 *
 *   - **create fewer instances.** The prefetch fix (`loading.tsx` on every dynamic route)
 *     removed roughly a dozen page renders per homepage visit, which was the thing
 *     manufacturing instances faster than the pooler could recycle them.
 *   - **never wait forever.** `connect_timeout` plus a `maxDuration` on each route means a
 *     request that cannot get a connection fails in seconds with a visible error, instead
 *     of occupying a function slot for five minutes and taking the next request down too.
 */
function createClient() {
  return postgres(env.DATABASE_URL, {
    // One connection per instance. Serverless invocations are single-request, so a pool
    // per instance would multiply slot usage for no benefit.
    max: 1,

    // Reclaims the connection on instances that stay awake between requests. Cannot help a
    // frozen one, as above — kept because it is free and does help the warm case.
    idle_timeout: 20,
    max_lifetime: 60 * 30,

    // Fail fast and visibly rather than hanging until the platform's timeout.
    connect_timeout: 10,

    // Supabase's transaction-mode pooler does not support prepared statements.
    prepare: false,

    // postgres.js otherwise runs an introspection query on every new connection to learn
    // type OIDs. One extra round trip per connection, for types this app does not use.
    fetch_types: false,
  })
}

// Next.js hot-reloads modules in dev, which would otherwise leak a pool per edit.
const globalForDb = globalThis as unknown as { client?: ReturnType<typeof createClient> }
const client = globalForDb.client ?? createClient()
if (env.NODE_ENV !== "production") globalForDb.client = client

export const db = drizzle(client, { schema })
export { schema }
