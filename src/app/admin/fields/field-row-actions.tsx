"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { setFieldArchived } from "@/lib/admin/actions/fields"

/**
 * Archiving a field, with its blast radius stated first.
 *
 * "Are you sure?" is unanswerable without the numbers. So the confirmation says how many
 * categories stop collecting it and how many listings keep their value — and says plainly
 * that nothing is deleted, because that is the part people fear and the part that is not
 * true here.
 */
export function FieldRowActions({
  id,
  label,
  archived,
  categoryCount,
  listingCount,
}: {
  id: number
  label: string
  archived: boolean
  categoryCount: number
  listingCount: number
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function archive() {
    const message =
      `Archive "${label}"?\n\n` +
      `· It leaves every new listing form immediately` +
      (categoryCount > 0
        ? `, across ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}`
        : "") +
      `.\n` +
      `· ${listingCount} existing listing${listingCount === 1 ? "" : "s"} keep their value and ` +
      `keep showing it, under "Additional details".\n` +
      `· Nothing is deleted. You can restore it at any time.`

    if (!window.confirm(message)) return

    setError(null)
    startTransition(async () => {
      const result = await setFieldArchived({ id, archived: true })
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <span className="ml-auto flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      ) : null}

      {archived ? (
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setFieldArchived({ id, archived: false })
              if (!result.ok) setError(result.error)
            })
          }
        >
          Restore
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive text-xs"
          disabled={pending}
          onClick={archive}
        >
          Archive
        </Button>
      )}
    </span>
  )
}
