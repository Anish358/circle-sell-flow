"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { DynamicForm } from "@/components/form/dynamic-form"
import { Button } from "@/components/ui/button"
import { recordVerification } from "@/lib/admin/actions/verification"
import type { AttributeValues, FormSchema } from "@/lib/form-schema/types"

/**
 * Recording what the hub measured.
 *
 * The form is `DynamicForm` — the same component the seller fills in and the same one the
 * category editor previews. The seller's claim for each field is already in the schema as
 * that field's help text, so the person holding the device sees the number they are
 * checking directly beneath the box they type into.
 *
 * The inputs start empty rather than pre-filled with the seller's answers. Pre-filling
 * would turn verification into a click-through, and a measurement nobody took is worse
 * than no measurement at all: it is the seller's claim wearing the platform's badge.
 */
export function VerifyForm({
  listingId,
  listingSlug,
  schema,
  recorded,
}: {
  listingId: string
  listingSlug: string
  schema: FormSchema
  /** What was recorded on a previous visit, so a correction starts from it. */
  recorded: AttributeValues
}) {
  const router = useRouter()
  const [values, setValues] = useState<AttributeValues>(recorded)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const measured = Object.values(values).filter(
    (value) => value !== undefined && value !== null && value !== "",
  ).length

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await recordVerification({ listingId, values })

      if (!result.ok) {
        setError(result.error)
        return
      }

      toast.success(
        result.data.cleared
          ? "Verification cleared. The listing shows the seller's claims again."
          : "Verification recorded. The product page now shows it.",
      )
      router.refresh()
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem] lg:items-start">
      <div className="grid gap-6 rounded-xl border p-4 sm:p-6">
        <DynamicForm
          schema={schema}
          values={values}
          onChange={(slug, value) => setValues((current) => ({ ...current, [slug]: value }))}
          disabled={pending}
        />

        {error ? (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Record verification"}
          </Button>
          <Button
            variant="ghost"
            disabled={pending || measured === 0}
            onClick={() => {
              // Clearing is a real outcome — an item that failed QC, or a measurement
              // taken on the wrong unit. It returns the row to wholly unverified rather
              // than leaving a badge over an empty record.
              if (
                !window.confirm(
                  "Clear this verification?\n\nThe product page goes back to showing only the seller's own claims. Their answers are untouched — they were never overwritten.",
                )
              ) {
                return
              }
              setValues({})
              startTransition(async () => {
                const result = await recordVerification({ listingId, values: {} })
                if (!result.ok) setError(result.error)
                else {
                  toast.success("Verification cleared.")
                  router.refresh()
                }
              })
            }}
          >
            Clear
          </Button>
          <span className="text-muted-foreground ml-auto text-xs">
            {measured} of {countFields(schema)} measured
          </span>
        </div>
      </div>

      <aside className="text-muted-foreground grid gap-3 rounded-xl border border-dashed p-4 text-xs leading-relaxed">
        <p>
          <span className="text-foreground font-medium">
            The seller&rsquo;s answers are never overwritten.
          </span>{" "}
          What you record is stored beside them, and the product page shows both wherever they
          disagree.
        </p>
        <p>
          Leave a field blank if you did not check it. A partial verification is normal and honest;
          a guessed one is not.
        </p>
        <p>
          These questions come from the fields marked{" "}
          <span className="text-foreground">Hub verifies</span> for{" "}
          <a
            href={`/admin/categories/${schema.category.slug}`}
            className="underline underline-offset-2"
          >
            {schema.category.name}
          </a>
          . Changing that list changes this form, with no deploy.
        </p>
        <p>
          <a
            href={`/listings/${listingSlug}`}
            className="hover:text-foreground underline underline-offset-2"
          >
            See how it renders for a buyer →
          </a>
        </p>
      </aside>
    </div>
  )
}

function countFields(schema: FormSchema): number {
  return schema.groups.reduce((total, group) => total + group.fields.length, 0)
}
