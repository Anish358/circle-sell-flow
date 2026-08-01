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
    // Enough connections to serve one render without pipelining.
    //
    // This was 1, on the reasoning that a serverless invocation handles a single request
    // so anything more just consumes pooler slots. The first half is true; the conclusion
    // was wrong, for two reasons.
    //
    // A single request is not a single query. A revalidation re-renders the whole tree,
    // and React renders siblings concurrently — the layout resolving the current user and
    // the page loading its own data are in flight at the same time. With `max: 1` they
    // cannot each have a connection, so postgres.js pipelines them: several queries
    // written onto one socket before any reply is read. A transaction-mode pooler expects
    // one query at a time per client connection, because that is how it decides which
    // server connection a statement belongs to. This is the one situation the app gets
    // into that never occurs locally, where there is no pooler — and it is precisely the
    // situation that fails.
    //
    // And the slot arithmetic doesn't hold either. What is scarce is Supavisor's pool of
    // *server* connections, which it manages itself; client connections into Supavisor
    // are cheap and are exactly what it exists to multiplex. Three costs us almost
    // nothing and lets a concurrent render be concurrent.
    max: 3,

    // Fail fast and visibly rather than hanging until the platform's timeout.
    connect_timeout: 10,

    // Supabase's transaction-mode pooler does not support prepared statements.
    prepare: false,

    // postgres.js otherwise runs an introspection query on every new connection to learn
    // type OIDs. One extra round trip per connection, for types this app does not use.
    fetch_types: false,

    // Deliberately no `idle_timeout` or `max_lifetime`.
    //
    // Both are client-side timers, and timers do not run in a frozen instance — so they
    // could never reclaim the connections that actually fill the pooler. Worse, they
    // introduce a race on thaw: the timer that could not fire during the freeze fires
    // immediately when the event loop resumes, which can close the socket at the moment
    // the incoming request is writing a query to it. A request that loses that race waits
    // on a dead socket.
    //
    // That matches the observed failure exactly — fine on first load, broken on a
    // subsequent one after a pause — and reusing a warm connection is the common case
    // anyway. Reclaiming connections from sleeping instances is the pooler's job, and it
    // has its own server-side client timeout for precisely that.
  })
}

// Next.js hot-reloads modules in dev, which would otherwise leak a pool per edit.
const globalForDb = globalThis as unknown as { client?: ReturnType<typeof createClient> }
const client = globalForDb.client ?? createClient()
if (env.NODE_ENV !== "production") globalForDb.client = client

export const db = drizzle(client, { schema })
export { schema }
