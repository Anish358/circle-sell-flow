"use client"

import { useState, useTransition } from "react"
import { CornerDownRightIcon, MinusIcon, PlusIcon } from "lucide-react"

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
import { previewReparent, reparentCategory } from "@/lib/admin/actions/categories"
import type { ReparentImpact } from "@/lib/admin/blast-radius"

/**
 * Moving a category to a different parent.
 *
 * This is the most consequential single edit in the console, and the only one whose
 * effect is invisible from the row being edited: the category's own assignments do not
 * change, and yet the form a seller meets can gain or lose most of its questions,
 * because the whole inherited set is swapped at once.
 *
 * So the move is not a dropdown that applies on change. Pick a destination, see exactly
 * which fields would arrive and which would leave, see how many live listings hold a
 * value for a departing field, and only then commit. The preview runs on every change of
 * the destination, because the point is to let someone explore a move and change their
 * mind — a warning shown only at submit time arrives after the decision is made.
 *
 * Cycles are rejected server-side; the options list simply never offers a descendant, so
 * the ordinary path never reaches that error.
 */

const ROOT = "__root__"

export function MoveCategoryDialog({
  id,
  name,
  currentParentId,
  candidates,
}: {
  id: number
  name: string
  currentParentId: number | null
  /** Every category except this one and its descendants — a cycle is not offerable. */
  candidates: Array<{ id: number; label: string }>
}) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<string>(
    currentParentId === null ? ROOT : String(currentParentId),
  )
  const [impact, setImpact] = useState<ReparentImpact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const targetId = target === ROOT ? null : Number(target)
  const unchanged = targetId === currentParentId

  function choose(value: string) {
    setTarget(value)
    setImpact(null)
    setError(null)

    const parentId = value === ROOT ? null : Number(value)
    if (parentId === currentParentId) return

    startTransition(async () => {
      const result = await previewReparent({ id, parentId })
      if (result.ok) setImpact(result.data)
      else setError(result.error)
    })
  }

  function commit() {
    setError(null)
    startTransition(async () => {
      const result = await reparentCategory({ id, parentId: targetId })
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
          setTarget(currentParentId === null ? ROOT : String(currentParentId))
          setImpact(null)
          setError(null)
          setOpen(true)
        }}
      >
        Move
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Move &ldquo;{name}&rdquo;</DialogTitle>
            <DialogDescription>
              A category collects everything assigned to it and to every category above it. Moving
              it swaps that inherited set — its own fields are untouched.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={`move-${id}`} className="text-xs">
              New parent
            </Label>
            <Select
              value={target}
              onValueChange={(value) => choose(String(value))}
              disabled={pending}
              items={[
                { value: ROOT, label: "No parent (top level)" },
                ...candidates.map((candidate) => ({
                  value: String(candidate.id),
                  label: candidate.label,
                })),
              ]}
            >
              <SelectTrigger id={`move-${id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT}>No parent (top level)</SelectItem>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.id} value={String(candidate.id)}>
                    {candidate.label}
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
              {pending ? "Working…" : "Move it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * The blast radius.
 *
 * Losing a field is the half that matters: the listings already holding a value for it
 * keep that value — nothing is deleted — but the category stops collecting it, so the
 * product page moves it under "Additional details". Saying that plainly is the difference
 * between an informed decision and a surprise next week.
 */
function Impact({
  impact,
  unchanged,
  pending,
}: {
  impact: ReparentImpact | null
  unchanged: boolean
  pending: boolean
}) {
  if (unchanged) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-xs">
        That is where it already sits. Choose a different parent to see what would change.
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

  const nothingChanges = impact.gained.length === 0 && impact.lost.length === 0

  return (
    <div className="grid gap-3 rounded-lg border px-3 py-3 text-xs">
      {nothingChanges ? (
        <p className="text-muted-foreground">
          No change to the fields collected. Both parents contribute the same set.
        </p>
      ) : null}

      {impact.gained.length > 0 ? (
        <FieldList
          icon={<PlusIcon className="size-3" aria-hidden="true" />}
          heading={`Starts collecting ${impact.gained.length}`}
          note="Sellers will be asked these. Existing listings are not asked retrospectively."
          fields={impact.gained}
        />
      ) : null}

      {impact.lost.length > 0 ? (
        <FieldList
          icon={<MinusIcon className="size-3" aria-hidden="true" />}
          heading={`Stops collecting ${impact.lost.length}`}
          note="Nothing is deleted. Listings keep the values they hold; the product page shows them under “Additional details”."
          fields={impact.lost}
        />
      ) : null}

      {impact.affectedListingCount > 0 ? (
        <p className="border-t pt-2">
          <CornerDownRightIcon
            className="text-muted-foreground mr-1 inline size-3"
            aria-hidden="true"
          />
          <span className="font-medium tabular-nums">{impact.affectedListingCount}</span> live{" "}
          {impact.affectedListingCount === 1 ? "listing holds" : "listings hold"} a value for one of
          the departing fields.
        </p>
      ) : null}
    </div>
  )
}

function FieldList({
  icon,
  heading,
  note,
  fields,
}: {
  icon: React.ReactNode
  heading: string
  note: string
  fields: Array<{ slug: string; label: string }>
}) {
  return (
    <div className="grid gap-1.5">
      <p className="flex items-center gap-1.5 font-medium">
        {icon}
        {heading}
      </p>
      <ul className="flex flex-wrap gap-1">
        {fields.map((field) => (
          <li key={field.slug} className="bg-muted rounded-md px-1.5 py-0.5">
            {field.label}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{note}</p>
    </div>
  )
}
