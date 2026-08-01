import type { Metadata } from "next"
import Link from "next/link"
import { sql } from "drizzle-orm"

import { db } from "@/db"
import { Badge } from "@/components/ui/badge"
import { formatPrice } from "@/lib/form-schema/format"

export const metadata: Metadata = { title: "Verification" }

/**
 * The hub's queue: what has arrived, and what has been checked.
 *
 * Ordered unverified-first, because that is the work. The counts alongside are what an
 * operations lead actually asks — how many are waiting, how many were checked — and
 * they come from the same two columns rather than a separate pipeline table.
 */
type QueueRow = {
  id: string
  slug: string
  title: string
  pricePaise: number
  currency: string
  categoryName: string
  sellerName: string
  verifiedAt: Date | null
  verifiedCount: number
  verifiableCount: number
}

export default async function VerificationQueuePage() {
  const rows = await db.execute<QueueRow>(sql`
    WITH RECURSIVE ancestry AS (
      -- Every (category, ancestor) pair, so a category's verifiable count includes
      -- what it inherits. Same rule as the resolver: assignments apply downward.
      SELECT id AS category_id, id AS ancestor_id, parent_id, 0 AS distance FROM categories
      UNION ALL
      SELECT a.category_id, c.id, c.parent_id, a.distance + 1
        FROM ancestry a JOIN categories c ON c.id = a.parent_id
    ),
    verifiable AS (
      SELECT winning.category_id, count(*)::int AS n
        FROM (
          -- Nearest ancestor wins, exactly as the form resolver decides it.
          SELECT DISTINCT ON (a.category_id, cf.field_id)
                 a.category_id, cf.field_id, cf.verifiable
            FROM ancestry a
            JOIN category_fields cf ON cf.category_id = a.ancestor_id
           ORDER BY a.category_id, cf.field_id, a.distance
        ) winning
       WHERE winning.verifiable
       GROUP BY winning.category_id
    )
    SELECT l.id,
           l.slug,
           l.title,
           l.price_paise                                    AS "pricePaise",
           l.currency,
           c.name                                           AS "categoryName",
           u.name                                           AS "sellerName",
           l.verified_at                                    AS "verifiedAt",
           (SELECT count(*)::int FROM jsonb_object_keys(l.verified_attributes)) AS "verifiedCount",
           coalesce(v.n, 0)                                 AS "verifiableCount"
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      JOIN users u ON u.id = l.seller_id
      LEFT JOIN verifiable v ON v.category_id = l.category_id
     WHERE l.status IN ('active', 'sold')
     -- Unverified first: that is the queue. Then newest, because a hub works a backlog
     -- from the front.
     ORDER BY (l.verified_at IS NOT NULL), l.created_at DESC
     LIMIT 100
  `)

  const waiting = rows.filter((row) => row.verifiedAt === null).length

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Hub verification</h1>
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium tabular-nums">{waiting}</span> waiting ·{" "}
          <span className="text-foreground font-medium tabular-nums">{rows.length - waiting}</span>{" "}
          checked
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          No live listings yet.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/admin/verification/${row.slug}`}
                prefetch={false}
                className="hover:bg-muted/50 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 transition-colors"
              >
                <span className="text-sm font-medium">{row.title}</span>
                <Badge variant="secondary" className="text-xs font-normal">
                  {row.categoryName}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {formatPrice(row.pricePaise, row.currency)} · {row.sellerName}
                </span>

                <span className="ml-auto text-xs">
                  {row.verifiedAt ? (
                    <>
                      <span className="text-primary font-medium">{row.verifiedCount} checked</span>
                      {/* Deliberately not "n of m": a field un-marked verifiable after a
                          verification leaves more checked than checkable, and a
                          denominator would turn honest history into a rendering bug. */}
                      {row.verifiableCount > row.verifiedCount ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {row.verifiableCount - row.verifiedCount} left
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {row.verifiableCount === 0
                        ? "nothing marked verifiable"
                        : `${row.verifiableCount} to check`}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
