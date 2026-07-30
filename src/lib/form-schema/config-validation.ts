import { RENDER_OPTIONS, type FieldRenderAs, type FieldType } from "@/db/schema"
import type { FieldConfig, FormField, VisibilityCondition } from "./types"
import { checkFieldValue } from "./validation"

/**
 * Validating the configuration itself.
 *
 * An admin editing the registry is editing a schema, and a schema can be
 * self-defeating in ways no individual value check would catch: a minimum above
 * its maximum, a default the field would reject, a required field behind a
 * condition that can never be true, or two fields whose visibility rules depend on
 * each other.
 *
 * Every one of those saves cleanly and produces a form no seller can submit. So
 * they are rejected at save time, when there is still someone around to fix it.
 */

export type ConfigIssue = {
  /** The field the problem belongs to, or null when it concerns the schema overall. */
  field: string | null
  code: string
  message: string
}

/** Just enough of a field to check its own definition, before it is assigned anywhere. */
export type FieldDefinition = {
  slug: string
  type: FieldType
  renderAs: FieldRenderAs
  config: FieldConfig
  options: Array<{ slug: string }>
}

const SELECT_TYPES: FieldType[] = ["single_select", "multi_select"]

/**
 * Checks a single field's own definition — the field editor's save path.
 * Nothing here needs to know which categories use the field.
 */
export function validateFieldDefinition(field: FieldDefinition): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const at = (code: string, message: string) => issues.push({ field: field.slug, code, message })
  const { min, max, minLength, maxLength, step } = field.config

  if (min !== undefined && max !== undefined && min > max) {
    at("min_above_max", `Minimum (${min}) is above maximum (${max}); nothing could satisfy both.`)
  }

  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    at(
      "min_length_above_max_length",
      `Minimum length (${minLength}) is above maximum length (${maxLength}).`,
    )
  }

  if (minLength !== undefined && minLength < 0) {
    at("negative_length", "Minimum length cannot be negative.")
  }

  if (step !== undefined && step <= 0) {
    at("non_positive_step", "Step must be greater than zero.")
  }

  // Also a database check constraint; repeated here to give a readable message
  // before the save is attempted rather than after it fails.
  if (!RENDER_OPTIONS[field.type].includes(field.renderAs)) {
    at(
      "render_as_not_permitted",
      `A ${field.type} field cannot render as "${field.renderAs}". Allowed: ${RENDER_OPTIONS[
        field.type
      ].join(", ")}.`,
    )
  }

  if (SELECT_TYPES.includes(field.type) && field.options.length === 0) {
    at("select_without_options", "A select field needs at least one option to choose from.")
  }

  if (!SELECT_TYPES.includes(field.type) && field.options.length > 0) {
    at("options_on_non_select", `A ${field.type} field cannot have options.`)
  }

  return issues
}

/**
 * Checks a category's whole resolved schema — the assignment screen's save path.
 *
 * Runs against the resolved set, inheritance included, because that is what a
 * seller will actually meet. A condition referring to a field the parent provides
 * is perfectly valid; the same condition on a category that does not inherit it is
 * broken, and only the resolved view can tell them apart.
 */
export function validateResolvedSchema(fields: readonly FormField[]): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const byslug = new Map(fields.map((field) => [field.slug, field]))

  for (const field of fields) {
    // A default the field itself would reject.
    if (field.defaultValue !== null && field.defaultValue !== undefined) {
      const problem = checkFieldValue(field, field.defaultValue)
      if (problem) {
        issues.push({
          field: field.slug,
          code: "invalid_default",
          message: `Default value is not valid for this field: ${problem}.`,
        })
      }
    }

    // Required, but nothing can be chosen.
    if (field.required && SELECT_TYPES.includes(field.type) && field.options.length === 0) {
      issues.push({
        field: field.slug,
        code: "required_without_options",
        message: "Required, but every option has been archived, so it cannot be answered.",
      })
    }

    // Conditions pointing at fields this category does not have.
    for (const condition of conditionsOf(field)) {
      if (!byslug.has(condition.field)) {
        issues.push({
          field: field.slug,
          code: "condition_on_unknown_field",
          message: `Visibility depends on "${condition.field}", which this category does not collect.`,
        })
      }
    }

    // Two conditions on the same field demanding different values.
    for (const contradiction of contradictionsIn(field)) {
      issues.push({
        field: field.slug,
        code: "contradictory_conditions",
        message: contradiction,
      })
    }
  }

  for (const cycle of findCycles(fields)) {
    issues.push({
      field: cycle[0] ?? null,
      code: "visibility_cycle",
      message: `Visibility rules form a loop: ${cycle.join(" → ")}. None of these fields could ever be shown.`,
    })
  }

  // Required fields behind conditions that can never hold, which makes the form
  // permanently unsubmittable — the failure mode hardest to diagnose from the
  // seller's side, because nothing appears wrong.
  const unsatisfiable = findUnsatisfiable(fields, byslug)
  for (const field of fields) {
    if (field.required && unsatisfiable.has(field.slug)) {
      issues.push({
        field: field.slug,
        code: "dead_required_field",
        message:
          "Required, but its visibility condition can never be true, so the form could never be submitted.",
      })
    }
  }

  return issues
}

function conditionsOf(field: FormField): VisibilityCondition[] {
  if (!field.visibleWhen) return []
  return "all" in field.visibleWhen ? field.visibleWhen.all : field.visibleWhen.any
}

/** Only meaningful for `all` groups: under `any`, differing values are not a conflict. */
function contradictionsIn(field: FormField): string[] {
  if (!field.visibleWhen || !("all" in field.visibleWhen)) return []

  const equalities = new Map<string, unknown>()
  const found: string[] = []

  for (const condition of field.visibleWhen.all) {
    if (condition.op !== "eq") continue
    if (equalities.has(condition.field)) {
      const existing = equalities.get(condition.field)
      if (existing !== condition.value) {
        found.push(
          `Requires "${condition.field}" to equal both ${JSON.stringify(existing)} and ${JSON.stringify(condition.value)}.`,
        )
      }
    } else {
      equalities.set(condition.field, condition.value)
    }
  }

  return found
}

/**
 * A condition that no answer could satisfy — for instance a select field compared
 * against a value that is not one of its options, which is what happens when an
 * option is archived while a rule still refers to it.
 */
function isImpossible(condition: VisibilityCondition, target: FormField | undefined): boolean {
  if (!target) return true

  if (SELECT_TYPES.includes(target.type) && (condition.op === "eq" || condition.op === "in")) {
    const available = new Set(target.options.map((option) => option.slug))
    const wanted = Array.isArray(condition.value) ? condition.value : [condition.value]
    return !wanted.some((value) => typeof value === "string" && available.has(value))
  }

  if (target.type === "boolean" && condition.op === "eq") {
    return typeof condition.value !== "boolean"
  }

  return false
}

/**
 * Fields that can never become visible, to a fixpoint: a field depending on an
 * unreachable field is itself unreachable, so the property propagates down chains.
 */
function findUnsatisfiable(
  fields: readonly FormField[],
  byslug: ReadonlyMap<string, FormField>,
): Set<string> {
  const dead = new Set<string>()

  let settled = false
  while (!settled) {
    settled = true

    for (const field of fields) {
      if (dead.has(field.slug) || !field.visibleWhen) continue

      const conditions = conditionsOf(field)
      const broken = conditions.map(
        (condition) =>
          isImpossible(condition, byslug.get(condition.field)) || dead.has(condition.field),
      )

      // Under `all` one broken condition is fatal; under `any` every one must be.
      const isDead =
        "all" in field.visibleWhen
          ? broken.some(Boolean)
          : broken.length > 0 && broken.every(Boolean)

      if (isDead) {
        dead.add(field.slug)
        settled = false
      }
    }
  }

  return dead
}

/**
 * Cycles in the visibility graph, found by depth-first search.
 *
 * A shows B shows A saves without complaint and hides both fields forever. The
 * evaluator is written not to hang on one, but the configuration is still wrong and
 * this is where it gets refused.
 */
function findCycles(fields: readonly FormField[]): string[][] {
  const dependencies = new Map<string, string[]>(
    fields.map((field) => [field.slug, conditionsOf(field).map((condition) => condition.field)]),
  )

  const cycles: string[][] = []
  const visited = new Set<string>()
  const onPath: string[] = []

  function walk(slug: string) {
    const loopStart = onPath.indexOf(slug)
    if (loopStart !== -1) {
      // Report the loop itself, closed back to its start so it reads as a cycle.
      cycles.push([...onPath.slice(loopStart), slug])
      return
    }
    if (visited.has(slug)) return

    onPath.push(slug)
    for (const next of dependencies.get(slug) ?? []) walk(next)
    onPath.pop()
    visited.add(slug)
  }

  for (const field of fields) walk(field.slug)

  return cycles
}
