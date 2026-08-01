import type { Metadata } from "next"
import Link from "next/link"
import { sql } from "drizzle-orm"

import { db } from "@/db"
import { Pager } from "@/components/pager"
import { SearchBox } from "@/components/search-box"
import { Badge } from "@/components/ui/badge"
import { formatPrice } from "@/lib/form-schema/format"
import { PAGE_PARAM, pageHref, readPage } from "@/lib/pagination"
import { matchesAllTerms, searchTerms } from "@/lib/search"

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

/** Ten to a page, as everywhere else in the console. */
const PAGE_SIZE = 10

export default async function VerificationQueuePage(props: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const { q, page: rawPage } = await props.searchParams
  const terms = searchTerms(q)
  const matches = matchesAllTerms(terms, [sql`l.title`, sql`u.name`, sql`c.name`]) ?? sql`true`

  /**
   * The queue's totals, counted over everything the filter matches rather than over the
   * page being shown.
   *
   * This is the whole reason the counts moved into SQL. They used to be derived from the
   * fetched rows, which was correct only while every row was fetched — the moment a page
   * holds ten of forty, "3 waiting" silently becomes "3 waiting on this page", which is
   * a different and much less useful fact stated in the same words.
   */
  const [totals] = await db.execute<{ total: number; waiting: number }>(sql`
    SELECT count(*)::int                                         AS total,
           count(*) FILTER (WHERE l.verified_at IS NULL)::int     AS waiting
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      JOIN users u ON u.id = l.seller_id
     WHERE l.status IN ('active', 'sold') AND ${matches}
  `)

  const page = readPage(rawPage, PAGE_SIZE, totals?.total ?? 0)

  const query = new URLSearchParams()
  if (q) query.set("q", q)
  if (page.number > 1) query.set(PAGE_PARAM, String(page.number))

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
     WHERE l.status IN ('active', 'sold') AND ${matches}
     -- Unverified first: that is the queue. Then newest, because a hub works a backlog
     -- from the front. The slug breaks ties, so a row cannot drift between pages.
     ORDER BY (l.verified_at IS NOT NULL), l.created_at DESC, l.slug DESC
     LIMIT ${PAGE_SIZE} OFFSET ${page.offset}
  `)

  const waiting = totals?.waiting ?? 0
  const checked = (totals?.total ?? 0) - waiting

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Hub verification</h1>
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium tabular-nums">{waiting}</span> waiting ·{" "}
          <span className="text-foreground font-medium tabular-nums">{checked}</span> checked
        </p>
      </header>

      <SearchBox
        query={query.toString()}
        label="Search the queue by title, seller or category"
        placeholder="Search by title, seller or category…"
        resetParams={[PAGE_PARAM]}
        className="max-w-md"
      />

      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          {terms.length > 0 ? `Nothing in the queue matches “${q}”.` : "No live listings yet."}
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

      <Pager
        previousHref={page.hasPrevious ? pageHref(query.toString(), page.number - 1) : null}
        nextHref={page.hasNext ? pageHref(query.toString(), page.number + 1) : null}
        summary={`${page.from}–${page.to} of ${page.totalItems} listing${page.totalItems === 1 ? "" : "s"}`}
      />
    </div>
  )
}
