import type { FieldRenderAs, FieldType } from "@/db/schema"

/**
 * The form-schema contract: everything needed to render one category's form,
 * resolved in a single call.
 *
 * This is the only thing the renderer knows. It contains no category names, no
 * conditionals about product kinds, and nothing a component has to interpret —
 * which is what lets one form component serve every category that exists now or
 * later.
 *
 * Note what is *not* here: title, description, price, condition and city. Those
 * are typed columns on `listings` because the platform itself reasons about them,
 * so they are an ordinary hand-written form section. This contract covers only
 * what varies by category.
 */

/** Declarative validation rules. Which keys apply depends on the field's `type`. */
export type FieldConfig = {
  /** number */
  min?: number
  max?: number
  step?: number
  /** Display suffix, e.g. "%" or "cm". Never part of the stored value. */
  unit?: string
  /** text, textarea */
  minLength?: number
  maxLength?: number
  /** date — reject dates in the future, e.g. a purchase date. */
  maxToday?: boolean
}

export type ComparisonOperator = "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte"

export type VisibilityCondition = {
  /** Slug of another field in the same resolved schema. */
  field: string
  op: ComparisonOperator
  value: unknown
}

/**
 * A field is visible when *all* of its conditions hold, or when *any* does.
 * One rule, two readers: the client shows and hides with it, and the server uses
 * the same rule to decide required-ness and to strip values of fields that turned
 * out to be hidden.
 */
export type VisibilityRule = { all: VisibilityCondition[] } | { any: VisibilityCondition[] }

export type FieldOptionView = {
  /** Immutable; this is what gets stored. */
  slug: string
  label: string
}

export type FormField = {
  /** Immutable identity, and the key this field's value occupies in `attributes`. */
  slug: string
  label: string

  /** How the value is stored and validated. */
  type: FieldType
  /** How it is presented. Changing this never affects validation. */
  renderAs: FieldRenderAs

  required: boolean
  config: FieldConfig

  placeholder: string | null
  helpText: string | null

  /** Pre-filled value, already shaped to `type`. Never persisted while hidden. */
  defaultValue: unknown

  /** Null when the field is always visible. */
  visibleWhen: VisibilityRule | null

  /** Live options only — archived ones are excluded from new forms. */
  options: FieldOptionView[]

  filterable: boolean
  prominent: boolean

  /** The hub can measure this one, so it appears on the verification form. */
  verifiable: boolean

  /**
   * Which category's assignment won. Lets the admin console render inherited
   * fields differently from a category's own, which is the difference between
   * inheritance being real and being a claim.
   */
  origin: {
    categorySlug: string
    categoryName: string
    inherited: boolean
  }
}

export type FormGroup = {
  /** Null for fields left ungrouped; such a group renders without a heading. */
  slug: string | null
  label: string | null
  fields: FormField[]
}

export type FormSchema = {
  category: {
    id: number
    slug: string
    name: string
    /** Root first, this category last — ready to render as a breadcrumb. */
    path: Array<{ slug: string; name: string }>
  }

  /**
   * Bumped by the database whenever anything affecting this resolved schema
   * changes, ancestors included. Drives the endpoint's ETag, and lets a draft
   * notice that the schema moved while the seller was typing.
   */
  configVersion: number

  groups: FormGroup[]
}

/** Convenience: every field across all groups, in render order. */
export function allFields(schema: FormSchema): FormField[] {
  return schema.groups.flatMap((group) => group.fields)
}

/** A submitted or in-progress set of category-specific answers. */
export type AttributeValues = Record<string, unknown>
