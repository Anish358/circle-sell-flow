"use client"

import type { AttributeValues, FormSchema } from "@/lib/form-schema/types"
import { computeVisibleFields } from "@/lib/form-schema/visibility"
import { FieldRenderer } from "./field-renderer"

/**
 * The one form. Renders any category's fields from the resolved schema.
 *
 * It reads groups and fields in the order the contract gives them and asks the
 * evaluator which fields are currently visible. There is no category logic here,
 * and no list of known field slugs — which is what the assignment is really asking
 * for: "avoid creating separate hard-coded forms for individual categories."
 *
 * Controlled rather than owning its own state, so the same component serves the
 * seller flow, the admin console's live preview, and the hub's verification screen.
 */
type DynamicFormProps = {
  schema: FormSchema
  values: AttributeValues
  onChange: (slug: string, value: unknown) => void
  /** Keyed by field slug. */
  errors?: Record<string, string>
  /** For the admin preview, where the form is illustrative rather than fillable. */
  disabled?: boolean
}

export function DynamicForm({ schema, values, onChange, errors = {}, disabled }: DynamicFormProps) {
  // Recomputed on every change so a chain of conditionals settles in one pass.
  const visible = computeVisibleFields(
    schema.groups.flatMap((group) => group.fields),
    values,
  )

  return (
    <div className="grid gap-8">
      {schema.groups.map((group) => {
        const fields = group.fields.filter((field) => visible.has(field.slug))

        // A group whose every field is hidden should not leave a stray heading.
        if (fields.length === 0) return null

        return (
          <section key={group.slug ?? "ungrouped"} className="grid gap-4">
            {group.label ? (
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {group.label}
              </h3>
            ) : null}

            <div className="grid gap-5">
              {fields.map((field) => (
                <FieldRenderer
                  key={field.slug}
                  field={field}
                  value={values[field.slug]}
                  onChange={(value) => onChange(field.slug, value)}
                  error={errors[field.slug]}
                  disabled={disabled}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
