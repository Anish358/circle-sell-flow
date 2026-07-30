import type { AttributeValues, FormSchema } from "./types"
import { allFields } from "./types"

/**
 * Seeds a form's values from the schema's configured defaults.
 *
 * Only fields that actually declare a default appear. Everything else stays absent
 * rather than being pre-filled with an empty string, so "not answered" and
 * "answered with nothing" remain distinguishable all the way to the database.
 *
 * Defaults for fields that turn out to be hidden are not a problem here: they are
 * removed on submit by `stripHiddenValues`, so a default can never quietly become
 * a stored answer to a question the seller was never asked.
 */
export function initialValues(schema: FormSchema): AttributeValues {
  const values: AttributeValues = {}

  for (const field of allFields(schema)) {
    if (field.defaultValue !== null && field.defaultValue !== undefined) {
      values[field.slug] = field.defaultValue
    }
  }

  return values
}

/**
 * Carries answers across a category change, keeping only what the new category
 * still asks for.
 *
 * This falls straight out of the shared field library: RAM survives a move between
 * two categories that both use the RAM field, because it is the same field, not two
 * coincidentally similar ones. Anything genuinely orphaned is returned separately so
 * the seller can be told what is about to be lost rather than having it vanish.
 */
export function carryOverValues(
  values: AttributeValues,
  target: FormSchema,
): { kept: AttributeValues; dropped: string[] } {
  const available = new Set(allFields(target).map((field) => field.slug))
  const kept: AttributeValues = {}
  const dropped: string[] = []

  for (const [slug, value] of Object.entries(values)) {
    if (available.has(slug)) kept[slug] = value
    else dropped.push(slug)
  }

  return { kept, dropped }
}
