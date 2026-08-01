/**
 * Page-number pagination, for the two admin lists.
 *
 * Browse deliberately does **not** use this. A public feed has listings arriving while
 * someone reads it, and `OFFSET` silently duplicates and skips rows as the set shifts
 * underneath — so browse pages by keyset cursor instead, and cannot offer page numbers
 * because a cursor has no notion of "page 4". See `listings/read.ts`.
 *
 * The admin tables take the opposite trade. Their content changes rarely, an operator
 * wants a total ("22 fields") and the ability to jump, and a row appearing twice across
 * two pages of an internal table is a cosmetic nuisance rather than a correctness
 * problem. Different read pattern, different mechanism, both stated.
 */

export type Page = {
  /** 1-based, clamped to something that exists. */
  number: number
  size: number
  /** For `OFFSET`. */
  offset: number
  totalItems: number
  totalPages: number
  /** Where this page starts and ends, 1-based and inclusive, for "3–12 of 22". */
  from: number
  to: number
  hasPrevious: boolean
  hasNext: boolean
}

/**
 * Reads a page number from the URL and works out what to ask the database for.
 *
 * The parameter is untrusted, so anything that is not a positive integer is page one —
 * `?page=-1`, `?page=abc` and `?page=1e9` all land somewhere sensible rather than
 * producing a negative `OFFSET` or an empty screen with no way back.
 */
export function readPage(
  raw: string | string[] | undefined,
  size: number,
  totalItems: number,
): Page {
  const value = Array.isArray(raw) ? raw.at(-1) : raw
  const parsed = Number(value)

  const totalPages = Math.max(1, Math.ceil(totalItems / size))
  const requested = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
  // Clamped rather than 404: deleting the last row of page 3 should show page 2, not an
  // error page reached by a link that was correct a second ago.
  const number = Math.min(requested, totalPages)

  const offset = (number - 1) * size
  const from = totalItems === 0 ? 0 : offset + 1
  const to = Math.min(offset + size, totalItems)

  return {
    number,
    size,
    offset,
    totalItems,
    totalPages,
    from,
    to,
    hasPrevious: number > 1,
    hasNext: number < totalPages,
  }
}

export const PAGE_PARAM = "page"

/** The current URL with a different page number — page one drops the parameter. */
export function pageHref(query: string, page: number): string {
  const params = new URLSearchParams(query)
  if (page <= 1) params.delete(PAGE_PARAM)
  else params.set(PAGE_PARAM, String(page))

  const search = params.toString()
  return search ? `?${search}` : "?"
}
