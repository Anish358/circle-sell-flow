import { eq } from "drizzle-orm"

import { db } from "@/db"
import { users, type User } from "@/db/schema"

/**
 * Who is making this request.
 *
 * Authentication itself is out of scope for this assignment, so this resolves a
 * seeded account rather than reading a session. What matters is that it has the
 * *shape* of the real thing: identity is established server-side and is never read
 * from a request body. `seller_id`, `role` and `status` are therefore not settable
 * by a client, which is the property the rest of the code depends on — swapping this
 * for a real session lookup changes nothing else.
 */

/** Stand-in for the signed-in seller. Replaced by a session lookup. */
const DEMO_SELLER_EMAIL = "priya@example.com"

export async function getCurrentUser(): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.email, DEMO_SELLER_EMAIL)).limit(1)
  return user ?? null
}

/** Throws rather than returning null, for routes that cannot proceed anonymously. */
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
