"use client"

import { useState, useTransition } from "react"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  attachField,
  detachField,
  moveAssignment,
  updateAssignment,
} from "@/lib/admin/actions/assignments"
import type { FormField } from "@/lib/form-schema/types"
import { isFacetableType } from "@/lib/listings/facets"

/**
 * The assignment screen: which fields this category collects, and on what terms.
 *
 * Inherited fields are shown, greyed, and labelled with where they came from. Hiding them
 * would make inheritance a claim the UI never backs up — an admin would see six fields
 * here and twelve in the seller flow and have no way to reconcile the two. Each inherited
 * row offers "Override here", which is just an assignment on this category: the resolver's
 * nearest-ancestor rule then makes the local row win.
 */

export type AssignmentRow = {
  field: FormField
  fieldId: number
  /** Null for inherited rows, which have no assignment on this category. */
  groupId: number | null
}

export function AssignmentList({
  categoryId,
  rows,
  groups,
  library,
}: {
  categoryId: number
  rows: AssignmentRow[]
  groups: Array<{ id: number; label: string }>
  /** Live fields not yet collected here. */
  library: Array<{ id: number; label: string; slug: string; type: string }>
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [adding, setAdding] = useState<string>("")

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) setError(result.error ?? "That did not work.")
    })
  }

  const own = rows.filter((row) => !row.field.origin.inherited)
  const inherited = rows.filter((row) => row.field.origin.inherited)

  return (
    <div className="grid gap-6">
      {error ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-xs"
        >
          {error}
        </p>
      ) : null}

      <section className="grid gap-2">
        <h2 className="text-sm font-semibold">
          Collected here <span className="text-muted-foreground font-normal">({own.length})</span>
        </h2>

        {own.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-xs">
            Nothing assigned directly. Add a field below, or rely on what this category inherits.
          </p>
        ) : (
          <ul className="grid gap-2">
            {own.map((row) => (
              <OwnRow
                key={row.fieldId}
                categoryId={categoryId}
                row={row}
                groups={groups}
                pending={pending}
                run={run}
              />
            ))}
          </ul>
        )}
      </section>

      {inherited.length > 0 ? (
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">
            Inherited{" "}
            <span className="text-muted-foreground font-normal">({inherited.length})</span>
          </h2>
          <p className="text-muted-foreground text-xs">
            Assigned further up the tree. Sellers see these too.
          </p>
          <ul className="grid gap-2">
            {inherited.map((row) => (
              <li
                key={row.fieldId}
                className="bg-muted/30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed px-3 py-2"
              >
                <span className="text-muted-foreground text-sm">{row.field.label}</span>
                <code className="text-muted-foreground/60 text-xs">{row.field.slug}</code>
                <Badge variant="secondary" className="text-xs font-normal">
                  from {row.field.origin.categoryName}
                </Badge>
                {row.field.required ? (
                  <span className="text-muted-foreground text-xs">required</span>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-xs"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      attachField({
                        categoryId,
                        fieldId: row.fieldId,
                        required: row.field.required,
                        groupId: row.groupId,
                        prominent: row.field.prominent,
                        filterable: row.field.filterable,
                        verifiable: row.field.verifiable,
                      }),
                    )
                  }
                >
                  Override here
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-2 border-t pt-4">
        <Label htmlFor="add-field" className="text-sm font-semibold">
          Add a field from the library
        </Label>
        {library.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Every live field is already collected here.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={adding || null}
              onValueChange={(value) => setAdding(String(value))}
              items={library.map((field) => ({
                value: String(field.id),
                label: `${field.label} · ${field.type}`,
              }))}
            >
              <SelectTrigger id="add-field" className="min-w-64 flex-1">
                <SelectValue placeholder="Choose a field…" />
              </SelectTrigger>
              <SelectContent>
                {library.map((field) => (
                  <SelectItem key={field.id} value={String(field.id)}>
                    {field.label} · {field.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={pending || !adding}
              onClick={() => {
                const fieldId = Number(adding)
                setAdding("")
                run(() => attachField({ categoryId, fieldId }))
              }}
            >
              Assign
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

const NO_GROUP = "__none__"

function OwnRow({
  categoryId,
  row,
  groups,
  pending,
  run,
}: {
  categoryId: number
  row: AssignmentRow
  groups: Array<{ id: number; label: string }>
  pending: boolean
  run: (action: () => Promise<{ ok: boolean; error?: string }>) => void
}) {
  const { field, fieldId } = row

  return (
    <li className="grid gap-3 rounded-lg border px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{field.label}</span>
        <code className="text-muted-foreground/70 text-xs">{field.slug}</code>
        <Badge variant="secondary" className="text-xs font-normal">
          {field.type} · {field.renderAs}
        </Badge>
        {field.visibleWhen ? (
          <Badge variant="secondary" className="text-xs font-normal">
            conditional
          </Badge>
        ) : null}

        <span className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${field.label} up`}
            disabled={pending}
            onClick={() => run(() => moveAssignment({ categoryId, fieldId, direction: "up" }))}
          >
            <ChevronUpIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${field.label} down`}
            disabled={pending}
            onClick={() => run(() => moveAssignment({ categoryId, fieldId, direction: "down" }))}
          >
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <Toggle
          id={`required-${fieldId}`}
          label="Required"
          checked={field.required}
          disabled={pending}
          onChange={(next) => run(() => updateAssignment({ categoryId, fieldId, required: next }))}
        />
        <Toggle
          id={`prominent-${fieldId}`}
          label="Headline spec"
          checked={field.prominent}
          disabled={pending}
          onChange={(next) => run(() => updateAssignment({ categoryId, fieldId, prominent: next }))}
        />
        {/* Ticking this puts a filter on the category's browse page — the same
            configuration driving a second surface. Free text is the one type that
            cannot become one, and saying so here beats an admin hunting for a filter
            that was never going to appear. */}
        <Toggle
          id={`filterable-${fieldId}`}
          label="Filterable"
          checked={field.filterable}
          disabled={pending}
          hint={
            isFacetableType(field.type)
              ? undefined
              : "Free-text fields are not faceted — buyers filter by options and ranges, not substrings."
          }
          onChange={(next) =>
            run(() => updateAssignment({ categoryId, fieldId, filterable: next }))
          }
        />
        {/* Marking a field verifiable is what puts it on the hub's form — the same
            configuration driving a third surface, without a line of new form code. */}
        <Toggle
          id={`verifiable-${fieldId}`}
          label="Hub verifies"
          checked={field.verifiable}
          disabled={pending}
          onChange={(next) =>
            run(() => updateAssignment({ categoryId, fieldId, verifiable: next }))
          }
        />

        <span className="flex items-center gap-2">
          <Label htmlFor={`group-${fieldId}`} className="text-muted-foreground text-xs">
            Group
          </Label>
          <Select
            value={row.groupId === null ? NO_GROUP : String(row.groupId)}
            onValueChange={(value) =>
              run(() =>
                updateAssignment({
                  categoryId,
                  fieldId,
                  groupId: value === NO_GROUP ? null : Number(value),
                }),
              )
            }
            items={[
              { value: NO_GROUP, label: "Ungrouped" },
              ...groups.map((group) => ({ value: String(group.id), label: group.label })),
            ]}
            disabled={pending}
          >
            <SelectTrigger id={`group-${fieldId}`} size="sm" className="min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GROUP}>Ungrouped</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={String(group.id)}>
                  {group.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>

        <Button
          variant="ghost"
          size="sm"
          className="text-destructive ml-auto text-xs"
          disabled={pending}
          onClick={() => {
            // Detaching is not archiving, and the wording has to make that unmistakable:
            // one affects this category, the other affects every category at once.
            if (
              !window.confirm(
                `Stop collecting "${field.label}" for this category?\n\n` +
                  `The field stays in the library and other categories keep using it. ` +
                  `Listings that already hold a value keep it — the product page shows it under ` +
                  `"Additional details".\n\n` +
                  `This is not the same as archiving the field, which retires it everywhere.`,
              )
            ) {
              return
            }
            run(() => detachField({ categoryId, fieldId }))
          }}
        >
          Detach
        </Button>
      </div>

      {field.helpText ? <p className="text-muted-foreground text-xs">{field.helpText}</p> : null}
    </li>
  )
}

function Toggle({
  id,
  label,
  checked,
  disabled,
  hint,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  disabled: boolean
  /** Shown beside the toggle when the flag will not do what its name suggests. */
  hint?: string
  onChange: (next: boolean) => void
}) {
  return (
    <span className="flex items-center gap-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onChange(Boolean(next))}
        />
        {label}
      </label>
      {/* Plain text rather than a tooltip: this is the kind of thing an admin needs to
          see without discovering it. */}
      {hint ? <span className="text-muted-foreground/80 italic">{hint}</span> : null}
    </span>
  )
}
