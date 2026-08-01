import { formatAttributeValue } from "@/lib/form-schema/format"
import type { AttributeValues, FormField, FormSchema } from "@/lib/form-schema/types"
import { allFields } from "@/lib/form-schema/types"
import { computeVisibleFields } from "@/lib/form-schema/visibility"

/**
 * The hub's verification form, derived from the same registry as the seller's.
 *
 * Circle takes possession of every item between listing and delivery, so a listing
 * spends part of its life holding two answers to the same question: what the seller
 * said, and what the hub measured. This module decides which questions the hub is
 * asked, and it is deliberately a *transformation of the seller's schema* rather than
 * a second schema of its own — one registry, three surfaces (sell, verify, display).
 *
 * Two filters decide the question set:
 *
 *   1. **Verifiable.** The assignment says the hub can measure this one. Battery
 *      health on a handset, yes; the seller's description of why they are selling, no.
 *   2. **Actually asked.** Visibility is evaluated against *the seller's answers*, not
 *      against the hub's. A warranty expiry the seller was never asked for is not a
 *      measurement the hub can take, and asking for it would invent an answer to a
 *      question that was never posed.
 *
 * Having decided (2) up front, the resulting fields carry no `visibleWhen` of their
 * own: their conditions may point at fields the hub is not asked about, and a
 * condition on an absent field evaluates to hidden. Visibility is resolved once, here,
 * where the seller's answers are in hand.
 */

/** The claim rendered as the hub reads it, and whether the measurement contradicts it. */
export type ClaimComparison = {
  slug: string
  label: string
  /** The seller's answer, formatted. Null when they left it blank. */
  claim: string | null
  /** The hub's measurement, formatted. Null when not yet recorded. */
  verified: string | null
  /** Both present and different. Not an accusation — the interesting case, and the one worth showing. */
  differs: boolean
}

/**
 * The subset of a category's fields the hub is asked to measure, in the same order
 * and grouping the seller met them in.
 *
 * `claimed` is the seller's stored attributes, used only to resolve visibility.
 */
export function verifiableFields(schema: FormSchema, claimed: AttributeValues): FormField[] {
  const fields = allFields(schema)
  const visible = computeVisibleFields(fields, claimed)

  return fields
    .filter((field) => field.verifiable && visible.has(field.slug))
    .map((field) => ({
      ...field,
      // Resolved above, against the answers that decide it.
      visibleWhen: null,
      // A partial verification is a normal outcome — a hub checks what it can check,
      // and an unmeasured field must stay unmeasured rather than block the record.
      required: false,
      // A default would be the platform asserting a measurement nobody took.
      defaultValue: null,
      // The seller's answer, shown under the input. The hub should see the claim it is
      // checking; hiding it would invite a second, blinder kind of mistake.
      helpText: claimHelpText(field, claimed[field.slug]),
    }))
}

/**
 * The same fields as a `FormSchema`, so `DynamicForm` renders the verification form
 * with no knowledge that it is one. Empty groups are dropped.
 */
export function verificationSchema(schema: FormSchema, claimed: AttributeValues): FormSchema {
  const included = new Map(verifiableFields(schema, claimed).map((field) => [field.slug, field]))

  const groups = schema.groups
    .map((group) => ({
      ...group,
      fields: group.fields.flatMap((field) => {
        const prepared = included.get(field.slug)
        return prepared ? [prepared] : []
      }),
    }))
    .filter((group) => group.fields.length > 0)

  return { ...schema, groups }
}

/**
 * The claim beside the measurement, for every field the hub was asked about.
 *
 * Drives the product page's "89% verified · seller stated 92%", and the hub's own
 * review of what it just recorded.
 */
export function compareToClaims(
  fields: readonly FormField[],
  claimed: AttributeValues,
  verified: AttributeValues,
): ClaimComparison[] {
  return fields.map((field) => {
    const claim = formatAttributeValue(field, claimed[field.slug])
    const measured = formatAttributeValue(field, verified[field.slug])

    return {
      slug: field.slug,
      label: field.label,
      claim,
      verified: measured,
      differs: claim !== null && measured !== null && claim !== measured,
    }
  })
}

function claimHelpText(field: FormField, claimed: unknown): string {
  const claim = formatAttributeValue(field, claimed)
  return claim === null ? "Seller left this blank." : `Seller stated: ${claim}`
}
