/**
 * Reading Postgres error details through Drizzle.
 *
 * Drizzle wraps driver errors in a plain `Error`, so the fields that identify *which*
 * constraint was violated sit on `.cause` rather than on the error itself. Checking
 * the top-level object silently never matches, which turns a recoverable conflict
 * into a 500 — so the chain is walked here, once, instead of at each call site.
 */

/** Postgres' SQLSTATE for a unique constraint violation. */
const UNIQUE_VIOLATION = "23505"

/**
 * The name of the unique constraint this error violated, or null if it is not a
 * unique violation. Naming the constraint matters: "the slug is taken" is
 * recoverable by retrying with a different one, while "this idempotency key exists"
 * means the work is already done.
 */
export function uniqueViolation(error: unknown): string | null {
  let current: unknown = error

  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown }

    if (candidate.code === UNIQUE_VIOLATION && typeof candidate.constraint_name === "string") {
      return candidate.constraint_name
    }

    current = candidate.cause
  }

  return null
}
