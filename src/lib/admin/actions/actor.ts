"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { actingAsCookie } from "@/lib/auth"

/**
 * Switching which seeded account the demo is acting as.
 *
 * Purely a demo affordance, and labelled as one in the UI. It exists so the role check
 * can be *seen* working rather than taken on trust: act as a seller and the admin console
 * refuses you; act as the admin and it opens.
 *
 * Note what it does not do — it sets an *email*, not a role. The role is always read from
 * the user row, so this cookie cannot grant a privilege that the account does not have.
 * That is the same property a real session id would need.
 */
export async function actAs(email: string): Promise<void> {
  const store = await cookies()

  store.set(actingAsCookie, email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  })

  revalidatePath("/", "layout")
}
