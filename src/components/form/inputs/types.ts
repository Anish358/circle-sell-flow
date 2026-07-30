import type { FormField } from "@/lib/form-schema/types"

/**
 * What every input component receives. Uniform on purpose: `FieldRenderer` picks a
 * component by `type` and `renderAs` and hands over the same props regardless, so
 * adding an input kind never means touching the caller.
 */
export type FieldInputProps = {
  field: FormField
  value: unknown
  onChange: (value: unknown) => void
  /** Must match the label's `htmlFor`. Supplied by the renderer. */
  id: string
  describedBy: string | undefined
  invalid: boolean
  disabled?: boolean
}
