"use client"

import type { FormField } from "@/lib/form-schema/types"
import { describedBy, FieldShell, fieldIds } from "./field-shell"
import { BooleanInput } from "./inputs/boolean-input"
import { MultiSelectInput } from "./inputs/multi-select-input"
import { SingleSelectInput } from "./inputs/single-select-input"
import { TextInput } from "./inputs/text-input"
import type { FieldInputProps } from "./inputs/types"

/**
 * Renders one field of any kind. A switch on `type`, and nothing else.
 *
 * This is the file that would grow a branch per category if the design were wrong.
 * It has no idea what a category is: it is handed a field description and picks an
 * input by the field's declared type. A field invented by an admin next year
 * renders here without a line changing.
 */

/** Presentations that are several controls at once, and so need a fieldset. */
const GROUPED_RENDERINGS = new Set(["radio", "chips", "checkboxes"])

const INPUTS: Record<FormField["type"], (props: FieldInputProps) => React.ReactNode> = {
  text: TextInput,
  textarea: TextInput,
  number: TextInput,
  date: TextInput,
  boolean: BooleanInput,
  single_select: SingleSelectInput,
  multi_select: MultiSelectInput,
}

type FieldRendererProps = {
  field: FormField
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  disabled?: boolean
}

export function FieldRenderer({ field, value, onChange, error, disabled }: FieldRendererProps) {
  const Input = INPUTS[field.type]
  const ids = fieldIds(field.slug)

  return (
    <FieldShell
      slug={field.slug}
      label={field.label}
      required={field.required}
      helpText={field.helpText}
      error={error}
      grouped={GROUPED_RENDERINGS.has(field.renderAs)}
    >
      <Input
        field={field}
        value={value}
        onChange={onChange}
        id={ids.control}
        describedBy={describedBy(field.slug, Boolean(field.helpText), Boolean(error))}
        invalid={Boolean(error)}
        disabled={disabled}
      />
    </FieldShell>
  )
}
