import type { AttributeValues, FormField, VisibilityCondition, VisibilityRule } from "./types"

/**
 * The single evaluator for conditional fields.
 *
 * The client calls it to decide what to show; the server calls it to decide what
 * is required and which values to discard. Two enforcers, one definition — a
 * second hand-written copy of this logic is how a form ends up disagreeing with
 * the API that receives it.
 */

/** `undefined`, `null` and `""` all mean "not answered". Decided once, here. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ""
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function evaluateCondition(condition: VisibilityCondition, value: unknown): boolean {
  const { op, value: expected } = condition

  switch (op) {
    case "eq":
      return value === expected
    case "neq":
      return value !== expected

    case "in": {
      // `expected` is the permitted set. A multi-select answer satisfies it if any
      // of its selections is permitted.
      const permitted = Array.isArray(expected) ? expected : [expected]
      if (Array.isArray(value)) return value.some((item) => permitted.includes(item))
      return permitted.includes(value)
    }

    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      // Ordering comparisons only make sense on numbers; anything else fails
      // rather than being coerced into a surprising answer.
      const left = asNumber(value)
      const right = asNumber(expected)
      if (left === null || right === null) return false
      if (op === "gt") return left > right
      if (op === "gte") return left >= right
      if (op === "lt") return left < right
      return left <= right
    }
  }
}

/**
 * Evaluates one rule. `visibleFields` matters: a condition on a field that is
 * itself hidden always fails, which is what makes hiding cascade down a chain
 * instead of leaving orphaned children on screen.
 */
export function evaluateVisibility(
  rule: VisibilityRule,
  values: AttributeValues,
  visibleFields?: ReadonlySet<string>,
): boolean {
  const conditions = "all" in rule ? rule.all : rule.any
  const requireAll = "all" in rule

  // A rule with no conditions constrains nothing.
  if (conditions.length === 0) return true

  const results = conditions.map((condition) => {
    if (visibleFields && !visibleFields.has(condition.field)) return false
    const value = values[condition.field]
    // An unanswered field satisfies only an explicit "is it empty" style check.
    if (isBlank(value) && condition.op !== "neq") return false
    return evaluateCondition(condition, value)
  })

  return requireAll ? results.every(Boolean) : results.some(Boolean)
}

/**
 * The set of fields currently visible, evaluated to a fixpoint so chains cascade:
 * if C is shown only when B is set, and B is shown only when A is set, then
 * clearing A hides both.
 *
 * Terminates because fields are only ever removed — at most one pass per field.
 * That also means a cycle (A shows B shows A) cannot hang this; cycles are
 * rejected when the configuration is saved.
 */
export function computeVisibleFields(
  fields: readonly FormField[],
  values: AttributeValues,
): Set<string> {
  const visible = new Set(fields.map((field) => field.slug))

  let settled = false
  while (!settled) {
    settled = true
    for (const field of fields) {
      if (!field.visibleWhen || !visible.has(field.slug)) continue
      if (!evaluateVisibility(field.visibleWhen, values, visible)) {
        visible.delete(field.slug)
        settled = false
      }
    }
  }

  return visible
}

/**
 * Drops values belonging to fields that ended up hidden.
 *
 * Answer "yes" to a warranty question, fill in the expiry date, then change your
 * answer to "no": without this the row claims both that there is no warranty and
 * that it expires next March. Runs on the server because the client is bypassable.
 */
export function stripHiddenValues(
  fields: readonly FormField[],
  values: AttributeValues,
): AttributeValues {
  const visible = computeVisibleFields(fields, values)

  // Only known-but-hidden fields are removed. Keys that belong to no field at all
  // are left alone deliberately: rejecting those is validation's job, and silently
  // swallowing them here would hide a client bug.
  const hidden = new Set(
    fields.filter((field) => !visible.has(field.slug)).map((field) => field.slug),
  )

  return Object.fromEntries(Object.entries(values).filter(([slug]) => !hidden.has(slug)))
}

/** A hidden field is never required, however its assignment is configured. */
export function isEffectivelyRequired(
  field: FormField,
  visibleFields: ReadonlySet<string>,
): boolean {
  return field.required && visibleFields.has(field.slug)
}
