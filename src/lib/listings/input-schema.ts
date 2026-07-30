import { z } from "zod"

/**
 * The shape of a listing submission — the common columns only; category-specific
 * answers are validated separately against the resolved registry schema.
 *
 * Kept free of any database import so the browser can use the identical schema.
 * That is the same "one definition, two enforcers" rule the category fields follow:
 * the seller flow validates each step against these, and the API route validates
 * the whole body against them again on arrival.
 */

/**
 * Condition values, with the wording a seller reads.
 *
 * Duplicated from the `listing_condition` Postgres enum on purpose — importing the
 * Drizzle schema would pull the query builder into the client bundle for the sake of
 * five strings. A unit test asserts the two lists stay identical, so the duplication
 * cannot drift.
 */
export const CONDITIONS = [
  { value: "new", label: "New", hint: "Unused, sealed" },
  { value: "like_new", label: "Like new", hint: "Barely used, no marks" },
  { value: "excellent", label: "Excellent", hint: "Light wear, works perfectly" },
  { value: "good", label: "Good", hint: "Visible wear, works well" },
  { value: "fair", label: "Fair", hint: "Heavy wear or minor faults" },
] as const

export type ConditionValue = (typeof CONDITIONS)[number]["value"]

const conditionValues = CONDITIONS.map((condition) => condition.value) as [
  ConditionValue,
  ...ConditionValue[],
]

/** Matches the `listings_title_length` check constraint. */
export const titleSchema = z
  .string()
  .trim()
  .min(3, "Give your listing a title of at least 3 characters")
  .max(140, "Keep the title under 140 characters")

export const descriptionSchema = z.string().trim().max(4000, "Description is too long")

export const citySchema = z
  .string()
  .trim()
  .min(1, "Where is the item?")
  .max(80, "City name is too long")

/** Rupees at the boundary, paise in the database. Converted once, server-side. */
export const priceSchema = z
  .number("Enter a price")
  .positive("Price must be more than zero")
  .max(1_000_000_000, "That price looks like a mistake")

export const conditionSchema = z.literal(conditionValues, "Choose a condition")

/**
 * The two steps of common information, as separate schemas so each step can be
 * validated on its own without demanding answers the seller has not reached yet.
 */
export const basicsStepSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
  city: citySchema,
})

export const priceStepSchema = z.object({
  condition: conditionSchema,
  priceRupees: priceSchema,
})

/** The full request body accepted by `POST /api/listings`. */
export const createListingSchema = z.strictObject({
  categorySlug: z.string().min(1),

  title: titleSchema,
  description: descriptionSchema.optional(),
  city: citySchema,
  condition: conditionSchema,
  priceRupees: priceSchema,

  attributes: z.record(z.string(), z.unknown()).default({}),

  /** Draft saves while incomplete; publishing demands a complete answer. */
  publish: z.boolean().default(false),

  /**
   * The `config_version` the form was rendered against. Never trusted for
   * validation — that always runs against the current schema — but it lets the
   * response explain that the form moved while it was being filled in.
   */
  configVersion: z.number().int().optional(),

  /** Makes a retried submit safe. */
  idempotencyKey: z.string().min(8).max(200).optional(),
})

export type CreateListingBody = z.input<typeof createListingSchema>

/** The common half of a draft, before it is complete enough to submit. */
export type CommonDraft = {
  title: string
  description: string
  city: string
  condition: ConditionValue | null
  /** Kept as a string while typing, so a half-typed number is not destroyed. */
  priceRupees: string
}

export const emptyCommonDraft: CommonDraft = {
  title: "",
  description: "",
  city: "",
  condition: null,
  priceRupees: "",
}
