import { computeVisibleFields, isEffectivelyRequired } from "@/lib/form-schema/visibility"
import type { AttributeValues, FormField } from "@/lib/form-schema/types"

/**
 * What a listing would be asked for if it were written today.
 *
 * The counterpart to the rule that a configuration change never reaches backwards: when
 * an admin makes a field required, existing listings are **not** re-validated and do not
 * become invalid. Nothing about them changes.
 *
 * But something about the *world* changed, and the seller is the person who can act on
 * it. So completeness is derived on read and purely informational — never stored, never
 * a status, never a reason to hide a listing. The listing stays live; its owner is simply
 * told what the category now asks for.
 *
 * Deriving it rather than storing it is what keeps it honest. A stored `is_complete`
 * would be a copy of a judgement made against a schema version that has since moved, and
 * would need updating every time any assignment changed anywhere up the tree — which is
 * the same class of bug as caching a resolved form.
 */

/**
 * Required, visible, and unanswered.
 *
 * Visibility matters: a field behind an unmet condition was never asked and is not
 * missing. That is the same `isEffectivelyRequired` rule the write path uses, so the page
 * cannot claim something is missing that submitting would not have demanded.
 */
export function missingRequiredFields(
  fields: readonly FormField[],
  values: AttributeValues,
): FormField[] {
  const visible = computeVisibleFields(fields, values)

  return fields.filter((field) => {
    if (!isEffectivelyRequired(field, visible)) return false
    const value = values[field.slug]
    // `[]` from a multi-select is an answer — "none of these" — exactly as on write.
    return value === undefined || value === null || value === ""
  })
}
