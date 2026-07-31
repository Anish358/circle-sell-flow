import { eq } from "drizzle-orm"
import { cookies } from "next/headers"
import { cache } from "react"

import { db } from "@/db"
import { users, type User } from "@/db/schema"

/**
 * Who is making this request.
 *
 * Authentication is out of scope for this assignment, so this resolves a seeded
 * account rather than verifying a password. What matters is that it has the *shape* of
 * the real thing: identity is established server-side, from a cookie the client cannot
 * forge into a different role, and is never read from a request body. `seller_id`,
 * `role` and `status` are therefore not settable by a client — the property the rest of
 * the code depends on. Replacing this with a session lookup changes nothing else.
 *
 * The cookie holds an email so the demo can act as either a seller or an admin and show
 * that the role check is real rather than decorative. In a production version it would
 * hold a signed session id, and the lookup below would be the same.
 */

/** Who you are before choosing otherwise. */
const DEFAULT_ACTOR = "priya@example.com"

const ACTOR_COOKIE = "circle_acting_as"

/**
 * Wrapped in React's `cache` so it runs **once per request**, however many times it is
 * asked.
 *
 * It is asked a lot: the admin layout, every `requireAdmin` inside an action, and the
 * product page's draft-visibility check all call it. Without deduplication a single admin
 * page render made three identical round trips for the same row — which on a serverless
 * function holding one connection means three serialised waits, and three more chances to
 * be the request that cannot get a connection.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const store = await cookies()
  const email = store.get(ACTOR_COOKIE)?.value ?? DEFAULT_ACTOR

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  // An unknown or stale cookie falls back rather than failing: it can only ever name a
  // seeded account, and the role comes from the row, never from the cookie.
  if (user) return user
  if (email === DEFAULT_ACTOR) return null

  const [fallback] = await db.select().from(users).where(eq(users.email, DEFAULT_ACTOR)).limit(1)
  return fallback ?? null
})

/** For routes that cannot proceed anonymously. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("No signed-in user. Run `npm run db:seed` to create the demo accounts.")
  }
  return user
}

export function isAdmin(user: User | null): boolean {
  return user?.role === "admin"
}

/**
 * The gate on every admin surface.
 *
 * Called by the admin layout *and* independently by every mutation. Layouts are not a
 * security boundary — a server action is its own callable endpoint and does not run the
 * layout that renders its form — so checking in one place only would leave every
 * mutation open.
 */
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser()
  if (!isAdmin(user)) throw new AdminRequiredError()
  return user as User
}

export class AdminRequiredError extends Error {
  constructor() {
    super("This action requires an administrator.")
    this.name = "AdminRequiredError"
  }
}

export const actingAsCookie = ACTOR_COOKIE
export const defaultActor = DEFAULT_ACTOR

/** Everyone the demo can act as, so the role check can be seen working. */
export const listActors = cache(async (): Promise<User[]> => {
  return db.select().from(users).orderBy(users.role, users.name)
})
