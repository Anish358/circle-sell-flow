import { z } from "zod"

import type { AttributeValues, FormField } from "./types"
import { computeVisibleFields, stripHiddenValues } from "./visibility"

/**
 * Builds a Zod schema for a category's attributes, from the registry.
 *
 * This is the "one definition, two enforcers" invariant. The generator is imported
 * by the API route and by the browser form, so there is never a second
 * hand-written validator to drift out of step with the first. A third enforcer —
 * the database trigger — validates the same registry rows independently, in SQL, so
 * that a writer bypassing this code path still cannot store nonsense.
 *
 * Coercion lives inside the schema rather than beside it, so "what counts as empty"
 * and "is '8,000' a number" are answered in exactly one place.
 */

/** Every type treats these as "not answered". Decided once. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ""
}

/**
 * Digits may arrive as strings from a form post, and Indian grouping ("1,20,000")
 * is what a seller actually types. Anything still unparseable is passed through
 * untouched so Zod reports a type error rather than silently becoming NaN.
 */
function coerceNumber(value: unknown): unknown {
  if (typeof value !== "string") return value
  const cleaned = value.replace(/[,\s]/g, "")
  if (cleaned === "") return undefined
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : value
}

function coerceBoolean(value: unknown): unknown {
  if (value === "true") return true
  if (value === "false") return false
  return value
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Today in local time as YYYY-MM-DD, matching what a date input submits. */
function todayIso(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-")
}

/**
 * Normalises a raw submitted value before validation: type coercion, and the one
 * decision about what counts as "not answered".
 *
 * Runs *outside* the optionality wrapper on purpose. Zod's `.optional()` inspects
 * the raw input, so a `null` mapped to `undefined` inside the inner schema would
 * still be treated as present and fail its type check.
 */
function coerceValue(field: FormField, raw: unknown): unknown {
  switch (field.type) {
    case "text":
    case "textarea": {
      // Trim before the blank test, so a field holding only spaces is unanswered
      // rather than an empty answer that satisfies "required".
      if (typeof raw === "string") {
        const trimmed = raw.trim()
        return trimmed === "" ? undefined : trimmed
      }
      return raw === null ? undefined : raw
    }

    case "number":
      return isBlank(raw) ? undefined : coerceNumber(raw)

    case "boolean":
      return isBlank(raw) ? undefined : coerceBoolean(raw)

    case "date":
    case "single_select":
      return isBlank(raw) ? undefined : raw

    case "multi_select":
      // `[]` is a real answer — "none of these" — so only null and undefined mean
      // unanswered.
      return raw === null ? undefined : raw
  }
}

/** Validates one already-coerced value. Says nothing about whether it is required. */
function valueSchema(field: FormField): z.ZodType {
  const { config } = field

  switch (field.type) {
    case "text":
    case "textarea": {
      let schema = z.string()
      if (config.minLength !== undefined) schema = schema.min(config.minLength)
      if (config.maxLength !== undefined) schema = schema.max(config.maxLength)
      return schema
    }

    case "number": {
      // `z.number()` alone admits NaN and Infinity, both of which round-trip
      // through JSON as null and would corrupt the stored value.
      let schema = (config.step === 1 ? z.number().int() : z.number()).refine(
        (value) => Number.isFinite(value),
        "Must be a finite number",
      )
      if (config.min !== undefined) {
        schema = schema.refine((value) => value >= config.min!, `Must be at least ${config.min}`)
      }
      if (config.max !== undefined) {
        schema = schema.refine((value) => value <= config.max!, `Must be at most ${config.max}`)
      }
      return schema
    }

    case "boolean":
      return z.boolean()

    case "date": {
      let schema = z
        .string()
        .regex(ISO_DATE, "Must be a date")
        .refine(isRealDate, "Not a real date")
      if (config.maxToday) {
        schema = schema.refine((value) => value <= todayIso(), "Cannot be in the future")
      }
      return schema
    }

    case "single_select": {
      const slugs = field.options.map((option) => option.slug)
      // Config validation rejects an optionless select at save time; if one reaches
      // here, fail loudly rather than accepting an arbitrary string.
      if (slugs.length === 0) return z.never({ error: "This field has no options" })
      return z.literal(slugs, "Not one of the available options")
    }

    case "multi_select": {
      const slugs = field.options.map((option) => option.slug)
      if (slugs.length === 0) return z.never({ error: "This field has no options" })
      return z
        .array(z.literal(slugs, "Not one of the available options"))
        .refine((items) => new Set(items).size === items.length, "Contains duplicates")
    }
  }
}

function isRealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/**
 * The schema for a whole set of attributes.
 *
 * `visible` decides which fields are required: a hidden field is never required,
 * however its assignment is configured. Unknown keys are rejected rather than
 * ignored — silently dropping them would hide client bugs and, worse, make a
 * mass-assignment attempt look successful.
 */
export function buildAttributesSchema(
  fields: readonly FormField[],
  visible: ReadonlySet<string>,
  options: { requireAll?: boolean } = {},
): z.ZodType<AttributeValues> {
  const shape: Record<string, z.ZodType> = {}

  // Hidden fields are stripped before validation, so including them here would
  // only produce confusing "required" errors for questions never asked.
  const included = fields.filter((field) => visible.has(field.slug))

  // Every entry is optional at the shape level, and required-ness is applied below.
  // Otherwise a missing required field reports the inner type's error ("expected
  // number, received undefined") instead of simply "Required".
  for (const field of included) {
    shape[field.slug] = z.preprocess(
      (raw) => coerceValue(field, raw),
      valueSchema(field).optional(),
    )
  }

  const object = z.strictObject(shape)

  if (options.requireAll === false) return object as unknown as z.ZodType<AttributeValues>

  const requiredSlugs = included.filter((field) => field.required).map((field) => field.slug)

  return object.superRefine((values, ctx) => {
    for (const slug of requiredSlugs) {
      const value = (values as AttributeValues)[slug]
      // `[]` from a multi-select counts as answered; only absence does not.
      if (value === undefined) {
        ctx.addIssue({ code: "custom", path: [slug], message: "Required" })
      }
    }
  }) as unknown as z.ZodType<AttributeValues>
}

export type ValidationResult =
  { ok: true; attributes: AttributeValues } | { ok: false; errors: FieldErrors }

/** Errors keyed by field slug, plus anything that belongs to no field. */
export type FieldErrors = Record<string, string> & { _form?: string }

/**
 * The whole write path for attributes, in the order that matters:
 *
 *   1. strip values of fields that ended up hidden — otherwise a listing can claim
 *      both that there is no warranty and that it expires next March;
 *   2. validate, which coerces, range-checks and rejects unknown keys.
 *
 * Stripping first is deliberate: required-ness is judged against the state actually
 * submitted, not against the configuration in the abstract.
 *
 * `mode: "draft"` skips required-field checks. Drafts save while incomplete;
 * publishing is what demands a complete answer. Two modes, one schema.
 */
export function validateAttributes(
  fields: readonly FormField[],
  raw: AttributeValues,
  mode: "draft" | "publish" = "publish",
): ValidationResult {
  const visible = computeVisibleFields(fields, raw)
  const stripped = stripHiddenValues(fields, raw)

  const schema = buildAttributesSchema(fields, visible, { requireAll: mode === "publish" })
  const result = schema.safeParse(stripped)

  if (!result.success) return { ok: false, errors: toFieldErrors(result.error) }

  // Drop keys Zod resolved to undefined so "absent" stays absent in jsonb rather
  // than becoming an explicit null.
  const attributes = Object.fromEntries(
    Object.entries(result.data).filter(([, value]) => value !== undefined),
  )

  return { ok: true, attributes }
}

/**
 * Checks one value against one field's rules, ignoring visibility and
 * required-ness. Used to validate a configured default at save time — a default
 * that violates its own field's rules is a form nobody can submit.
 */
export function checkFieldValue(field: FormField, value: unknown): string | null {
  const schema = z.preprocess((raw) => coerceValue(field, raw), valueSchema(field).optional())
  const result = schema.safeParse(value)
  return result.success ? null : (result.error.issues[0]?.message ?? "Invalid value")
}

/** Flattens Zod issues into one message per field, which is what a form renders. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {}

  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      // Not attributable to a field, because these fields do not exist here.
      errors._form = `Unknown field${issue.keys.length > 1 ? "s" : ""}: ${issue.keys.join(", ")}`
      continue
    }

    const slug = issue.path[0]
    if (typeof slug === "string") {
      errors[slug] ??= issue.message
    } else {
      errors._form ??= issue.message
    }
  }

  return errors
}
