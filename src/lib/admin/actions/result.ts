import { AdminRequiredError, requireAdmin } from "@/lib/auth"
import type { User } from "@/db/schema"

/**
 * What every admin action returns.
 *
 * A result rather than a thrown error, so a form can show "that name is taken" next to
 * the input instead of replacing the page with an error boundary. Genuine faults still
 * throw — the distinction is between a user's mistake and the system's.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export function success<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

export function failure<T = never>(error: string): ActionResult<T> {
  return { ok: false, error }
}

/**
 * Wraps an action in the admin check.
 *
 * Present so that forgetting the check is a visible omission rather than an invisible
 * one: every action in this directory is a `withAdmin` call, and one that is not stands
 * out on sight.
 */
export async function withAdmin<T>(
  run: (admin: User) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    const admin = await requireAdmin()
    return await run(admin)
  } catch (error) {
    if (error instanceof AdminRequiredError) {
      return failure("You need to be signed in as an administrator to do that.")
    }
    throw error
  }
}
