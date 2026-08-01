import type { Metadata } from "next"

import { getActivityLog } from "@/lib/admin/audit"
import type { ActivityItem } from "@/lib/admin/activity"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Activity" }

/**
 * Every configuration change, newest first, in plain language.
 *
 * The registry decides what sellers are asked and what listings may contain, so editing
 * it is as consequential as a deploy — and a deploy has a commit history. This is that
 * history. Without it, "why did this category start requiring battery health last
 * Tuesday?" has no answer, which is exactly the question asked once a config change
 * turns out to have cost listings.
 *
 * Written for the person who actually makes those changes, who is not an engineer. The
 * stored row is machine-shaped — an action key, an entity type, an id, two documents —
 * and every bit of that translation happens in `activity.ts`, so this file only lays
 * out sentences. The machine action is still there, on hover, for whoever is debugging.
 */
export default async function AuditPage() {
  const items = await getActivityLog(150)

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Activity</h1>
        <p className="text-muted-foreground text-sm">
          Who changed the configuration, what changed, and what it means for sellers and for
          listings that already exist.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          Nothing recorded yet. Changes made through this console appear here; the sample data was
          loaded by a script, which is why it is absent.
        </p>
      ) : (
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={item.id} className="grid gap-1.5 border-b py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <ToneDot tone={item.tone} />
                {/* `title` keeps the machine action reachable without putting
                    `category.create` in front of someone who does not need it. */}
                <p className="text-sm font-medium" title={item.action}>
                  {item.headline}
                </p>
                <p className="text-muted-foreground ml-auto text-xs whitespace-nowrap">
                  {item.actorName ?? "a script"} ·{" "}
                  <time dateTime={item.at.toISOString()}>{formatWhen(item.at)}</time>
                </p>
              </div>

              {/* The consequence, which is the part an admin was actually worried about
                  when they clicked. */}
              {item.detail ? (
                <p className="text-muted-foreground max-w-3xl pl-4 text-xs leading-relaxed">
                  {item.detail}
                </p>
              ) : null}

              {item.changes.length > 0 ? (
                <ul className="grid gap-0.5 pl-4 text-xs">
                  {item.changes.map((change) => (
                    <li key={change.label} className="flex flex-wrap items-baseline gap-1.5">
                      <span className="text-muted-foreground">{change.label}</span>
                      <span className="text-muted-foreground/60 line-through">{change.from}</span>
                      <span aria-hidden="true" className="text-muted-foreground/60">
                        →
                      </span>
                      <span className="font-medium">{change.to}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A colour for the kind of change, so the list can be scanned without reading it.
 *
 * Colour is never the only signal — every entry says what it did in words — so this is
 * decorative and hidden from assistive technology rather than being a label nobody can
 * hear.
 */
function ToneDot({ tone }: { tone: ActivityItem["tone"] }) {
  const colour: Record<ActivityItem["tone"], string> = {
    added: "bg-emerald-500",
    changed: "bg-sky-500",
    moved: "bg-amber-500",
    removed: "bg-rose-500",
    restored: "bg-emerald-500",
    checked: "bg-primary",
  }

  return (
    <span
      aria-hidden="true"
      className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", colour[tone])}
    />
  )
}

function formatWhen(at: Date): string {
  return at.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  })
}
