import { sql } from "drizzle-orm"

import { db } from "@/db"

/**
 * Liveness check that actually touches Postgres.
 *
 * Worth having on its own merits, but its specific job here is to exercise the
 * runtime connection — the app talks to a transaction-mode pooler, which is a
 * different code path from the session-mode connection migrations use. Without
 * this, a broken runtime connection string would not surface until the first
 * page that reads data.
 */
export async function GET() {
  try {
    const [row] = await db.execute<{ now: string }>(sql`select now() as now`)
    return Response.json({ ok: true, database: "reachable", now: row?.now })
  } catch (error) {
    // Report the failure without leaking the connection string or a stack trace.
    console.error("Health check failed:", error)
    return Response.json({ ok: false, database: "unreachable" }, { status: 503 })
  }
}
