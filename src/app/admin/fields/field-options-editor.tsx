"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { addFieldOption, setOptionArchived, updateFieldOption } from "@/lib/admin/actions/fields"
import { slugify } from "@/lib/slug"

export type EditableOption = {
  id: number
  valueSlug: string
  label: string
  archived: boolean
  listingCount: number
}

/**
 * Editing the options of an existing select field.
 *
 * Without this the field library could only ever describe the choices a field was born
 * with, which is not what "edit a field" means to the person asking for it — the real
 * request is almost always "we started selling a 512 GB model".
 *
 * Three properties of the registry become visible here rather than merely being true:
 *
 *  - **the stored value is immutable and the label is not.** Each option shows the slug it
 *    writes into `listings.attributes` next to an editable label, so it is obvious that
 *    fixing a typo in "128 Gb" costs nothing and renames it everywhere at once;
 *  - **retiring is not deleting.** Archiving removes an option from every new form while
 *    every listing that already chose it keeps and keeps displaying it;
 *  - **a change has a blast radius, stated before it happens.** Each option carries the
 *    number of listings holding that exact value, so archiving is a decision made with
 *    the number in view instead of a confirmation dialog nobody can answer.
 */
export function FieldOptionsEditor({
  fieldId,
  fieldLabel,
  options,
}: {
  fieldId: number
  fieldLabel: string
  options: EditableOption[]
}) {
  const [open, setOpen] = useState(false)
  const live = options.filter((option) => !option.archived).length
  const archived = options.length - live

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-xs"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {live} option{live === 1 ? "" : "s"}
        {archived > 0 ? ` · ${archived} archived` : ""}
      </button>

      {open ? (
        <div className="border-muted grid gap-3 border-l-2 py-1 pl-3">
          <ul className="grid gap-1.5">
            {options.map((option) => (
              <OptionRow key={option.id} option={option} />
            ))}
          </ul>

          <AddOption fieldId={fieldId} fieldLabel={fieldLabel} existing={options} />
        </div>
      ) : null}
    </div>
  )
}

function OptionRow({ option }: { option: EditableOption }) {
  const router = useRouter()
  const [label, setLabel] = useState(option.label)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const dirty = label.trim() !== option.label && label.trim().length > 0

  function rename() {
    if (!dirty) return
    setError(null)
    startTransition(async () => {
      const result = await updateFieldOption({ id: option.id, label: label.trim() })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  function toggleArchived() {
    // Only archiving needs the warning. Restoring an option is not destructive: it
    // reappears in new forms and the listings that already hold it were never affected.
    if (!option.archived) {
      const message =
        `Archive "${option.label}"?\n\n` +
        `· It disappears from every new listing form immediately.\n` +
        `· ${option.listingCount} existing listing${option.listingCount === 1 ? "" : "s"} ` +
        `chose it and keep it, displayed exactly as now.\n` +
        `· Nothing is deleted, and you can restore it at any time.`
      if (!window.confirm(message)) return
    }

    setError(null)
    startTransition(async () => {
      const result = await setOptionArchived({ id: option.id, archived: !option.archived })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <li className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              rename()
            }
          }}
          disabled={pending}
          aria-label={`Label for option ${option.valueSlug}`}
          className={`h-8 max-w-48 text-xs ${option.archived ? "text-muted-foreground" : ""}`}
        />

        {/* The permanent half of the pair, shown beside the editable half. */}
        <code className="text-muted-foreground/70 text-xs">{option.valueSlug}</code>

        <span className="text-muted-foreground/70 text-xs">
          {option.listingCount} listing{option.listingCount === 1 ? "" : "s"}
        </span>

        <span className="ml-auto flex items-center gap-1">
          {dirty ? (
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={pending}
              onClick={rename}
            >
              Save
            </Button>
          ) : null}

          {/* Muted until hover. Archiving one option is a routine edit, not a red-alert
              action, and a column of red on every row reads as damage rather than as a
              control — the field-level Archive above it is the consequential one. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={`h-7 text-xs ${
              option.archived ? "" : "text-muted-foreground hover:text-destructive"
            }`}
            disabled={pending}
            onClick={toggleArchived}
          >
            {option.archived ? "Restore" : "Archive"}
          </Button>
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </li>
  )
}

function AddOption({
  fieldId,
  fieldLabel,
  existing,
}: {
  fieldId: number
  fieldLabel: string
  existing: EditableOption[]
}) {
  const router = useRouter()
  const [label, setLabel] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const slug = label.trim() ? slugify(label) : ""

  // Checked here as well as in the action, because the useful moment to say "that already
  // exists" is while typing. Archived options count: their slugs are retired, not freed —
  // reusing one would make old and new listings indistinguishable.
  const clash = slug ? existing.find((option) => option.valueSlug === slug) : undefined

  function submit() {
    const value = label.trim()
    if (!value || clash) return

    setError(null)
    startTransition(async () => {
      const result = await addFieldOption({ fieldId, label: value })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setLabel("")
      router.refresh()
    })
  }

  return (
    <form
      className="grid gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Label htmlFor={`add-option-${fieldId}`} className="text-xs">
        Add an option to {fieldLabel}
      </Label>

      <div className="flex gap-2">
        <Input
          id={`add-option-${fieldId}`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          // Deliberately not an example. Any concrete one ("512 GB") belongs to a
          // particular field, and this component is rendered for every field there is.
          placeholder="New choice"
          disabled={pending}
          className="h-8 max-w-48 text-xs"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={pending || !label.trim() || Boolean(clash)}
        >
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>

      {clash ? (
        <p role="alert" className="text-destructive text-xs">
          {clash.archived
            ? `"${clash.label}" is archived and still owns ${slug}. Restore it instead — reusing a
               retired value would make old and new listings indistinguishable.`
            : `Already an option, stored as ${slug}.`}
        </p>
      ) : slug ? (
        <p className="text-muted-foreground text-xs">
          Stored permanently as <code className="text-foreground">{slug}</code>.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </form>
  )
}
