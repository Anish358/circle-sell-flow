"use client"

import { useTransition } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { actAs } from "@/lib/actions/actor"

/**
 * Demo affordance: switch which seeded account is acting.
 *
 * It lives in the global header rather than inside the admin console, because the most
 * useful thing it demonstrates is what happens *outside* it: switch to a seller and the
 * Admin link disappears; switch back and it returns. A control that only existed behind
 * the role check could never show the check working.
 *
 * Labelled "(demo)" on purpose. Without it this reads as an account menu, and a reviewer
 * reasonably wonders why a marketplace lets you become someone else.
 */
export function ActorSwitcher({
  actors,
  currentEmail,
}: {
  actors: Array<{ email: string; name: string; role: string }>
  currentEmail: string | null
}) {
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor="acting-as" className="text-muted-foreground whitespace-nowrap">
        Acting as <span className="opacity-60">(demo)</span>
      </label>
      <Select
        value={currentEmail}
        onValueChange={(email) => startTransition(() => actAs(String(email)))}
        items={actors.map((actor) => ({
          value: actor.email,
          label: `${actor.name} · ${actor.role}`,
        }))}
        disabled={pending}
      >
        <SelectTrigger id="acting-as" size="sm" className="min-w-44">
          <SelectValue placeholder="Choose an account" />
        </SelectTrigger>
        <SelectContent>
          {actors.map((actor) => (
            <SelectItem key={actor.email} value={actor.email}>
              {actor.name} · {actor.role}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
