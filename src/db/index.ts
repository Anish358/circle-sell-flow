import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { env } from "@/lib/env"
import * as schema from "./schema"

/**
 * The database client.
 *
 * This module is **shared by every request the instance is serving at once**, which is the
 * fact the first version of it got wrong.
 *
 * Vercel's Fluid Compute runs several requests concurrently in one instance rather than one
 * request per instance — the function logs record `concurrency: 3` on the requests that
 * failed. Every one of those requests imports this module and gets the same client. So the
 * pool here is not sized for one render; it is sized for every render the instance happens
 * to be doing simultaneously, times the queries each of those renders runs in parallel.
 *
 * Sized at 1, as it originally was, the consequences compound:
 *
 *   - **Queries queue instead of running.** postgres.js writes them onto the one socket
 *     ahead of any reply — and a transaction-mode pooler wants a single query at a time per
 *     client connection, because that is how it decides which server connection a statement
 *     belongs to.
 *   - **A stall is total, and it is sticky.** postgres.js has no query timeout, so once that
 *     socket stops making progress every later query on the instance waits forever, and the
 *     instance stays warm and keeps accepting requests. That is a poisoned instance: it
 *     explains why "Try again" failed repeatedly while "Back to listings" worked — the retry
 *     landed on the same instance, the navigation landed on a different one.
 *   - **It is invisible from the database side.** Those requests died at Vercel's 20-second
 *     limit having logged no Postgres error at all, because their queries were still sitting
 *     in a client-side queue. Which is exactly why the database's own logs, read alone, kept
 *     pointing at the wrong thing.
 *
 * None of it reproduces locally: no pooler, and one request at a time.
 *
 * The remaining defences, which matter once queueing is no longer the bottleneck:
 * `connect_timeout` here, `maxDuration` on each route, and — since 0007 — a server-side
 * `statement_timeout` below both, so a query that does reach Postgres and misbehave is
 * cancelled by the database before anything else gives up on it.
 */
function createClient() {
  return postgres(env.DATABASE_URL, {
    // Enough connections that concurrent queries never queue behind each other.
    //
    // Budget it from the observed worst case rather than a guess: three requests on one
    // instance, each re-rendering a tree whose layout and page query in parallel. Ten
    // leaves headroom over that and is also postgres.js's own default.
    //
    // The original `max: 1` was reasoned from slot scarcity, and the arithmetic doesn't
    // hold: what is scarce is Supavisor's pool of *server* connections, which it manages
    // itself and which are only occupied while a statement is actually executing. Client
    // connections into Supavisor are cheap — multiplexing them is the entire reason it
    // exists. Ten idle client connections cost approximately nothing; one shared busy
    // connection cost an outage.
    max: 10,

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
