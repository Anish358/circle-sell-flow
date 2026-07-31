"use client"

import { useTransition } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { actAs } from "@/lib/admin/actions/actor"

/** Demo affordance: switch which seeded account is acting, to show the role check working. */
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
      <label htmlFor="acting-as" className="text-muted-foreground">
        Acting as
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
        <SelectTrigger id="acting-as" size="sm" className="min-w-52">
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
