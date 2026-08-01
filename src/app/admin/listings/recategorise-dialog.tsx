"use client"

import { useState, useTransition } from "react"
import { CheckIcon, TrashIcon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { previewRecategorise, recategoriseListing } from "@/lib/admin/actions/listings"
import type { RecategoriseImpact } from "@/lib/admin/blast-radius"

/**
 * Moving a listing to another category, with what it costs shown first.
 *
 * The same shape as the category move dialog, for the same reason: pick a destination,
 * see what would happen, change your mind freely, commit once. What differs is that this
 * one destroys something — answers the destination does not collect cannot come along —
 * so the confirming button says so, and the values are listed individually rather than
 * counted.
 */
export function RecategoriseDialog({
  listingSlug,
  title,
  currentCategorySlug,
  destinations,
}: {
  listingSlug: string
  title: string
  currentCategorySlug: string
  destinations: Array<{ slug: string; label: string }>
}) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(currentCategorySlug)
  const [impact, setImpact] = useState<RecategoriseImpact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const unchanged = target === currentCategorySlug

  function choose(categorySlug: string) {
    setTarget(categorySlug)
    setImpact(null)
    setError(null)
    if (categorySlug === currentCategorySlug) return

    startTransition(async () => {
      const result = await previewRecategorise({ listingSlug, categorySlug })
      if (result.ok) setImpact(result.data)
      else setError(result.error)
    })
  }

  function commit() {
    setError(null)
    startTransition(async () => {
      const result = await recategoriseListing({ listingSlug, categorySlug: target })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      setImpact(null)
    })
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs"
        onClick={() => {
          setTarget(currentCategorySlug)
          setImpact(null)
          setError(null)
          setOpen(true)
        }}
      >
        Move category
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Move &ldquo;{title}&rdquo;</DialogTitle>
            <DialogDescription>
              A category decides which questions a listing answers. Answers the destination also
              collects are kept; the rest are removed, because the database will not hold an
              attribute a category does not collect.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={`recategorise-${listingSlug}`} className="text-xs">
              New category
            </Label>
            <Select
              value={target}
              onValueChange={(value) => choose(String(value))}
              disabled={pending}
              items={destinations.map((destination) => ({
                value: destination.slug,
                label: destination.label,
              }))}
            >
              <SelectTrigger id={`recategorise-${listingSlug}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((destination) => (
                  <SelectItem key={destination.slug} value={destination.slug}>
                    {destination.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Impact impact={impact} unchanged={unchanged} pending={pending} />

          {error ? (
            <p
              role="alert"
              className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-xs"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={commit} disabled={pending || unchanged}>
              {pending
                ? "Working…"
                : impact && impact.dropped.length > 0
                  ? `Move and remove ${impact.dropped.length}`
                  : "Move it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Impact({
  impact,
  unchanged,
  pending,
}: {
  impact: RecategoriseImpact | null
  unchanged: boolean
  pending: boolean
}) {
  if (unchanged) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-xs">
        That is where it already sits. Choose another category to see what would change.
      </p>
    )
  }

  if (pending && !impact) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-xs">
        Working out what would change…
      </p>
    )
  }

  if (!impact) return null

  return (
    <div className="grid gap-3 rounded-lg border px-3 py-3 text-xs">
      {impact.dropped.length > 0 ? (
        <ValueList
          icon={<TrashIcon className="text-destructive size-3" aria-hidden="true" />}
          heading={`${impact.dropped.length} answer${impact.dropped.length === 1 ? "" : "s"} removed`}
          note={`${impact.toName} does not collect these. The audit log keeps a copy of what was removed.`}
          values={impact.dropped}
        />
      ) : null}

      {impact.kept.length > 0 ? (
        <ValueList
          icon={<CheckIcon className="size-3" aria-hidden="true" />}
          heading={`${impact.kept.length} kept`}
          // The shared field library doing its job, and the same mechanism that lets a
          // half-finished draft survive a change of category.
          note="Both categories collect these fields, so the answers carry over unchanged."
          values={impact.kept}
        />
      ) : null}

      {impact.missingRequired.length > 0 ? (
        <p className="flex items-start gap-1.5 border-t pt-2">
          <TriangleAlertIcon
            className="text-muted-foreground mt-0.5 size-3 shrink-0"
            aria-hidden="true"
          />
          <span>
            {impact.toName} requires{" "}
            <span className="font-medium">
              {impact.missingRequired.map((field) => field.label).join(", ")}
            </span>
            , which this listing does not answer. It stays live either way — existing listings are
            never re-validated — and its seller is shown what is now asked for.
          </span>
        </p>
      ) : null}
    </div>
  )
}

function ValueList({
  icon,
  heading,
  note,
  values,
}: {
  icon: React.ReactNode
  heading: string
  note: string
  values: Array<{ slug: string; label: string; display: string }>
}) {
  return (
    <div className="grid gap-1.5">
      <p className="flex items-center gap-1.5 font-medium">
        {icon}
        {heading}
      </p>
      <ul className="grid gap-0.5">
        {values.map((value) => (
          <li key={value.slug} className="flex flex-wrap gap-x-2">
            <span className="text-muted-foreground">{value.label}</span>
            <span>{value.display}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{note}</p>
    </div>
  )
}
