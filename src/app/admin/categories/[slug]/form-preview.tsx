"use client"

import { useState } from "react"

import { DynamicForm } from "@/components/form/dynamic-form"
import type { AttributeValues, FormSchema } from "@/lib/form-schema/types"
import { initialValues } from "@/lib/form-schema/values"

/**
 * The seller's form, rendered live beside the editor.
 *
 * This is the cheapest useful thing in the whole console, because it is not a mock-up: it
 * is the same `DynamicForm` the seller flow renders, reading the same resolved contract.
 * That is what makes it trustworthy — a hand-drawn preview would be a second
 * implementation to keep in step, and it would eventually lie.
 *
 * It is interactive on purpose rather than a static picture. Conditional fields are the
 * one thing an admin cannot check by reading the configuration, so the preview has to let
 * them answer "yes" to a warranty question and watch the expiry date appear.
 */
export function FormPreview({ schema }: { schema: FormSchema }) {
  const [values, setValues] = useState<AttributeValues>(() => initialValues(schema))

  return (
    <div className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">What the seller sees</h2>
        <button
          type="button"
          onClick={() => setValues(initialValues(schema))}
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
        >
          Reset
        </button>
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        The real form, not a mock-up — same component, same contract. Answer a conditional question
        to watch the fields it controls appear.
      </p>

      <div className="rounded-xl border p-4">
        {schema.groups.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No fields yet. Assign one and it appears here.
          </p>
        ) : (
          <DynamicForm
            schema={schema}
            values={values}
            onChange={(slug, value) => setValues((current) => ({ ...current, [slug]: value }))}
          />
        )}
      </div>
    </div>
  )
}
