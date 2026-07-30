"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { describedBy, FieldShell } from "@/components/form/field-shell"
import type { CommonDraft } from "@/lib/listings/input-schema"

/**
 * The common information every listing has, whatever it is.
 *
 * Hand-written rather than generated, and that is the point of the split: these are
 * typed columns the platform itself reasons about, so they change when the product
 * changes, not when an admin adds a category. The generated form covers everything
 * that does vary.
 *
 * Reuses `FieldShell` so the label, help and `aria-*` wiring is identical to the
 * configured fields beside it.
 */
export function BasicsStep({
  common,
  errors,
  onChange,
}: {
  common: CommonDraft
  errors: Record<string, string>
  onChange: <K extends keyof CommonDraft>(key: K, value: CommonDraft[K]) => void
}) {
  return (
    <div className="grid gap-5">
      <FieldShell
        slug="title"
        label="Title"
        required
        helpText="What it is, in the words a buyer would search for."
        error={errors.title}
        grouped={false}
      >
        <Input
          id="field-title"
          value={common.title}
          onChange={(event) => onChange("title", event.target.value)}
          placeholder="Brand, model and anything that identifies it"
          maxLength={140}
          aria-describedby={describedBy("title", true, Boolean(errors.title))}
          aria-invalid={Boolean(errors.title) || undefined}
          aria-required
        />
      </FieldShell>

      <FieldShell
        slug="description"
        label="Description"
        required={false}
        helpText="Anything a photo cannot show. Being upfront about wear sells faster."
        error={errors.description}
        grouped={false}
      >
        <Textarea
          id="field-description"
          value={common.description}
          onChange={(event) => onChange("description", event.target.value)}
          rows={5}
          maxLength={4000}
          aria-describedby={describedBy("description", true, Boolean(errors.description))}
          aria-invalid={Boolean(errors.description) || undefined}
        />
      </FieldShell>

      <FieldShell
        slug="city"
        label="City"
        required
        helpText="Where the item can be collected from."
        error={errors.city}
        grouped={false}
      >
        <Input
          id="field-city"
          value={common.city}
          onChange={(event) => onChange("city", event.target.value)}
          placeholder="e.g. Bengaluru"
          maxLength={80}
          autoComplete="address-level2"
          aria-describedby={describedBy("city", true, Boolean(errors.city))}
          aria-invalid={Boolean(errors.city) || undefined}
          aria-required
        />
      </FieldShell>
    </div>
  )
}
