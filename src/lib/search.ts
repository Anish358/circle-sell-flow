import { and, or, sql, type SQL } from "drizzle-orm"

/**
 * Substring search, shared by the three lists that need it: browse, the admin listings
 * table, and the field library.
 *
 * One helper rather than three, because the interesting parts are the same everywhere
 * and are easy to get subtly wrong in isolation — splitting a query into words so
 * "13 iphone" finds "Apple iPhone 13", escaping the wildcards a user can type, and
 * bounding what a pathological query can build.
 *
 * **What this is not.** It is `ILIKE '%term%'`, so there is no stemming, no relevance
 * ranking, no typo tolerance, and no index behind it. At this catalogue's size that is a
 * sequential scan over a few hundred rows and instant; at a real one it is the wrong
 * tool, and the replacement is a `pg_trgm` GIN index for substring matching or a
 * `tsvector` column for word matching. That is a swap inside this file — every caller
 * passes columns and terms and would not change.
 */

/** Enough to be useful; few enough that one query cannot become a hundred predicates. */
const MAX_TERMS = 6
const MAX_TERM_LENGTH = 40

/**
 * A query string as the words a row has to contain.
 *
 * Splitting on whitespace and requiring all of them makes word order irrelevant, which
 * is what people expect from a search box and what a single `ILIKE '%whole query%'`
 * would not give: "13 iphone" finds "Apple iPhone 13 128GB".
 */
export function searchTerms(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return []

  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .map((term) => term.slice(0, MAX_TERM_LENGTH))
}

/**
 * `%` and `_` are wildcards inside `LIKE`, and a backslash escapes them — so a seller
 * searching for "50%" would otherwise match every row, and "iphone_13" would match
 * "iphone 13" by accident. Escaping is not paranoia here: `%` in a search box is
 * ordinary user input, not an attack.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/**
 * "Every term appears in at least one of these columns."
 *
 * Terms are ANDed and columns are ORed, which is the combination that behaves sensibly
 * as a search box: adding a word narrows, and a word may match any of the searched
 * fields. Returns undefined when there is nothing to search for, so callers can drop it
 * straight into a `where(and(...))` without a conditional.
 */
export function matchesAllTerms(
  terms: readonly string[],
  columns: readonly SQL[],
): SQL | undefined {
  if (terms.length === 0 || columns.length === 0) return undefined

  return and(
    ...terms.map((term) => {
      const pattern = `%${escapeLike(term)}%`
      // The escape character has to be declared, or Postgres treats the backslash as an
      // ordinary character in some configurations and the escaping silently does nothing.
      return or(...columns.map((column) => sql`${column} ILIKE ${pattern} ESCAPE '\\'`))
    }),
  )
}
