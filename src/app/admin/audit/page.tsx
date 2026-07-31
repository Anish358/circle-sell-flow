import type { Metadata } from "next"

import { Badge } from "@/components/ui/badge"
import { getAuditLog } from "@/lib/admin/audit"

export const metadata: Metadata = { title: "Activity" }

/**
 * Every registry change, newest first.
 *
 * The registry decides what sellers are asked and what listings may contain, so editing it
 * is as consequential as a deploy — and a deploy has a commit history. This is that
 * history. Without it, "why did this category start requiring battery health last Tuesday?"
 * has no answer, and that is precisely the question asked once a config change turns out to
 * have cost listings.
 */
export default async function AuditPage() {
  const entries = await getAuditLog(150)

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Activity</h1>
        <p className="text-muted-foreground text-sm">
          Configuration changes, with what each one replaced.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          Nothing recorded yet. Changes made through this console appear here; the sample data was
          loaded by a script, which is why it is absent.
        </p>
      ) : (
        <ul className="grid gap-1">
          {entries.map((entry) => (
            <li key={entry.id} className="grid gap-1.5 border-b py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <Badge variant="secondary" className="font-mono text-xs font-normal">
                  {entry.action}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {entry.entityType} <code>{entry.entityId}</code>
                </span>
                <span className="text-muted-foreground ml-auto text-xs">
                  {entry.actorName ?? "a script"} ·{" "}
                  <time dateTime={entry.at.toISOString()}>{formatWhen(entry.at)}</time>
                </span>
              </div>

              {/* The change itself, not just that one happened. Truncated because a
                  before/after pair can be a whole row and this is a scannable list. */}
              <Change before={entry.before} after={entry.after} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * What actually changed.
 *
 * Only the differing keys, because a full row dump makes the one thing that changed
 * impossible to find — which defeats the purpose of keeping the log.
 */
function Change({ before, after }: { before: unknown; after: unknown }) {
  const changed = diff(before, after)

  if (changed.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        {before && !after ? "Removed." : after && !before ? "Created." : "No field values changed."}
      </p>
    )
  }

  return (
    <ul className="grid gap-0.5 text-xs">
      {changed.map(({ key, from, to }) => (
        <li key={key} className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-muted-foreground">{key}</span>
          <span className="text-muted-foreground/60 line-through">{from}</span>
          <span aria-hidden="true" className="text-muted-foreground/60">
            →
          </span>
          <span className="font-medium">{to}</span>
        </li>
      ))}
    </ul>
  )
}

function diff(before: unknown, after: unknown): Array<{ key: string; from: string; to: string }> {
  if (!isRecord(before) || !isRecord(after)) return []

  // Timestamps change on every write and say nothing about intent.
  const ignored = new Set(["createdAt", "updatedAt", "created_at", "updated_at", "configVersion"])

  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !ignored.has(key))
    .flatMap((key) => {
      const from = render(before[key])
      const to = render(after[key])
      return from === to ? [] : [{ key, from, to }]
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function render(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function formatWhen(at: Date): string {
  return at.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}
