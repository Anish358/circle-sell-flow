import type { FieldType } from "@/db/schema"
import { formatAttributeValue } from "@/lib/form-schema/format"
import type { FormSchema } from "@/lib/form-schema/types"
import { allFields } from "@/lib/form-schema/types"

/**
 * Buyer-side facets, generated from the same registry rows as the seller's form.
 *
 * This is the configuration paying for itself twice. An admin ticks `filterable` on
 * an assignment and a filter appears on browse — same field library, same option
 * lists, same slugs, no second definition of what a category collects and no code.
 * The facet list for a category is *derived*, so a category created after this file
 * was written gets filters for free.
 *
 * Three things worth naming, because they are the decisions rather than the code:
 *
 *  1. **A facet is not a form input.** `render_as` says how a seller *answers* —
 *     one of N, as chips or a dropdown. A buyer filtering wants the opposite
 *     shape: "8 GB **or** 12 GB". So every option-bearing field becomes the same
 *     checkbox group here whatever its widget, and booleans become a two-option
 *     group rather than a switch, because "either" has to be expressible.
 *  2. **The URL is untrusted input, validated against the registry** — exactly like
 *     a write. A param naming a field that isn't filterable here, or an option that
 *     no longer exists, is dropped rather than passed to SQL.
 *  3. **Dropped, not rejected.** A write with an unknown key is a bug worth a 400; a
 *     shared link whose option was retired last week is an ordinary fact of a
 *     mutable registry. It should show the rest of the filter, not an error page.
 *
 * Pure and client-safe: the panel imports it too, so what the browser offers and
 * what the query enforces cannot drift apart.
 */

export type FacetOption = { value: string; label: string }

/**
 * How the facet is queried, which is a coarser question than the field's type:
 * `match` is containment against a set of allowed values, `range` is a bound.
 */
export type FacetKind = "match" | "range"

export type Facet = {
  /** The field slug — also the key inside `attributes`, and the URL parameter. */
  slug: string
  label: string
  kind: FacetKind
  /** The underlying field type, which decides how a URL token becomes a JSON value. */
  type: FieldType
  helpText: string | null
  /** `match` only. Empty for a range. */
  options: FacetOption[]
  /** `range` only: the field's own bounds and unit, so the inputs match the form's. */
  unit: string | null
  min: number | null
  max: number | null
}

/**
 * Facet params are namespaced. Nothing else on browse may collide with a field
 * slug — and since slugs are `^[a-z0-9]+(-[a-z0-9]+)*$`, neither the dot nor a
 * comma can ever appear inside one, which is what makes both delimiters safe.
 */
export const FACET_PREFIX = "f."

export const CATEGORY_PARAM = "category"
export const CURSOR_PARAM = "after"

export function matchParam(slug: string): string {
  return `${FACET_PREFIX}${slug}`
}

export function boundParam(slug: string, bound: "min" | "max"): string {
  return `${FACET_PREFIX}${slug}.${bound}`
}

/**
 * Whether a field of this type can be a facet at all.
 *
 * Free text cannot. Containment cannot express "contains the word", and a substring
 * match over jsonb is a sequential scan with no index to help it — that is a search
 * feature wearing a facet's clothes. The admin console asks this too, so marking such
 * a field filterable says plainly that nothing will come of it rather than leaving an
 * admin to wonder where their filter went.
 */
export function isFacetableType(type: FieldType): boolean {
  return type !== "text" && type !== "textarea"
}

/** The facets a category offers, in the order its form asks the questions. */
export function buildFacets(schema: FormSchema): Facet[] {
  const facets: Facet[] = []

  for (const field of allFields(schema)) {
    if (!field.filterable || !isFacetableType(field.type)) continue

    const base = {
      slug: field.slug,
      label: field.label,
      type: field.type,
      helpText: field.helpText,
      unit: field.config.unit ?? null,
      min: field.config.min ?? null,
      max: field.config.max ?? null,
    }

    switch (field.type) {
      case "single_select":
      case "multi_select": {
        // A select whose options were all archived offers nothing to tick.
        if (field.options.length === 0) continue
        facets.push({
          ...base,
          kind: "match",
          options: field.options.map((option) => ({ value: option.slug, label: option.label })),
        })
        break
      }

      case "boolean":
        facets.push({
          ...base,
          kind: "match",
          options: [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ],
        })
        break

      case "number":
      case "date":
        facets.push({ ...base, kind: "range", options: [] })
        break

      // Already excluded above; listed so a new field type cannot be added without
      // this switch failing to compile.
      case "text":
      case "textarea":
        break
    }
  }

  return facets
}

/** What one facet is currently narrowed to. Only facets with a selection appear. */
export type FacetSelection =
  | { kind: "match"; facet: Facet; tokens: string[] }
  | { kind: "range"; facet: Facet; min: string | null; max: string | null }

export type SearchParams = Record<string, string | string[] | undefined>

/**
 * Reads the URL into selections, keeping only what the registry recognises.
 *
 * Both encodings are accepted for a match: repeated params (`?f.ram=8gb&f.ram=12gb`,
 * what a plain HTML form would send) and comma-separated (`?f.ram=8gb,12gb`, what the
 * panel writes because it is shorter to read and to share).
 */
export function readSelections(
  facets: readonly Facet[],
  params: SearchParams | URLSearchParams,
): FacetSelection[] {
  const search = toParams(params)
  const selections: FacetSelection[] = []

  for (const facet of facets) {
    if (facet.kind === "match") {
      const allowed = new Set(facet.options.map((option) => option.value))
      const chosen = new Set(
        readTokens(search, matchParam(facet.slug)).filter((token) => allowed.has(token)),
      )
      if (chosen.size === 0) continue
      selections.push({
        kind: "match",
        facet,
        // De-duplicated, and in the registry's option order rather than the URL's, so
        // two links selecting the same things read as the same filter.
        tokens: facet.options.map((o) => o.value).filter((value) => chosen.has(value)),
      })
      continue
    }

    const min = readBound(facet, search, "min")
    const max = readBound(facet, search, "max")
    if (min === null && max === null) continue
    // A reversed range is the buyer's slip, not an error state: swapping it returns
    // what they meant instead of an empty page.
    const [low, high] = min !== null && max !== null && min > max ? [max, min] : [min, max]
    selections.push({ kind: "range", facet, min: low, max: high })
  }

  return selections
}

function readTokens(search: URLSearchParams, name: string): string[] {
  return search
    .getAll(name)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
}

/** A bound, validated against the field's own type. Anything else is not a bound. */
function readBound(facet: Facet, search: URLSearchParams, bound: "min" | "max"): string | null {
  const value = search.getAll(boundParam(facet.slug, bound)).at(-1)?.trim()
  if (!value) return null

  if (facet.type === "number") {
    const parsed = Number(value)
    // Not clamped to the field's configured min/max: those bound what a seller may
    // *enter*, and a listing stored before the config tightened is still real.
    return Number.isFinite(parsed) ? String(parsed) : null
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

/**
 * The filter shape the query layer consumes. Deliberately declared here beside the
 * parser rather than in the read layer: this is the whole vocabulary of what a URL
 * is allowed to ask the database for, and keeping it in one file is what makes that
 * surface reviewable.
 */
export type AttributeFilter =
  /** Any of `values` — jsonb containment, one alternative per value. */
  | { kind: "match"; slug: string; values: unknown[] }
  | { kind: "range"; slug: string; type: "number" | "date"; min: string | null; max: string | null }

export function toAttributeFilters(selections: readonly FacetSelection[]): AttributeFilter[] {
  return selections.map((selection) =>
    selection.kind === "match"
      ? {
          kind: "match" as const,
          slug: selection.facet.slug,
          values: selection.tokens.map((token) => matchValue(selection.facet, token)),
        }
      : {
          kind: "range" as const,
          slug: selection.facet.slug,
          type: selection.facet.type === "date" ? ("date" as const) : ("number" as const),
          min: selection.min,
          max: selection.max,
        },
  )
}

/**
 * A URL token as it is actually stored inside `attributes`.
 *
 * The multi-select case is the one that earns the design: a listing holds
 * `{"ports": ["usb-c", "hdmi"]}`, and `@> '{"ports": ["usb-c"]}'` is true of it —
 * containment reaches inside the array, so "has this option" needs no separate
 * operator, no unnesting and no second index.
 */
function matchValue(facet: Facet, token: string): unknown {
  switch (facet.type) {
    case "boolean":
      return token === "true"
    case "multi_select":
      return [token]
    default:
      return token
  }
}

/** One removable chip per selected value: what is on, and what turns it off. */
export type FacetChip = {
  key: string
  label: string
  /** The parameter to edit, and the single value to drop from it (null = drop it all). */
  param: string
  value: string | null
}

export function facetChips(selections: readonly FacetSelection[]): FacetChip[] {
  return selections.flatMap((selection): FacetChip[] => {
    if (selection.kind === "match") {
      const { facet } = selection
      return selection.tokens.map((token) => ({
        key: `${facet.slug}:${token}`,
        label: `${facet.label}: ${optionLabel(facet, token)}`,
        param: matchParam(facet.slug),
        value: token,
      }))
    }

    // One chip for the whole range: "at least 80%" and "at most 100%" as two
    // removable halves reads as two filters when it is one.
    const { facet, min, max } = selection
    return [
      {
        key: facet.slug,
        label: `${facet.label}: ${rangeLabel(facet, min, max)}`,
        param: boundParam(facet.slug, "min"),
        value: null,
      },
    ]
  })
}

function optionLabel(facet: Facet, token: string): string {
  return facet.options.find((option) => option.value === token)?.label ?? token
}

/** Reuses the display formatter, so a facet says "1 TB" and "15 January 2024" too. */
function rangeLabel(facet: Facet, min: string | null, max: string | null): string {
  const format = (value: string) =>
    formatAttributeValue(
      { type: facet.type, options: [], config: facet.unit ? { unit: facet.unit } : {} },
      facet.type === "number" ? Number(value) : value,
    ) ?? value

  if (min !== null && max !== null) return `${format(min)} – ${format(max)}`
  if (min !== null) return `${format(min)} and up`
  return `up to ${format(max!)}`
}

/**
 * URL building for browse, in one place so the server's links and the panel's
 * navigations produce identical URLs.
 *
 * Every one of these drops the cursor. A filter change re-orders the result set, and
 * a keyset cursor from the previous set points into a page that no longer exists —
 * carrying it over is how a buyer ticks a box and lands on an empty page.
 */
export function browseUrl(params: URLSearchParams): string {
  const query = params.toString()
  return query ? `/?${query}` : "/"
}

/** The same params, minus the cursor — the base every filter link is built from. */
export function firstPage(params: SearchParams | URLSearchParams): URLSearchParams {
  const next = toParams(params)
  next.delete(CURSOR_PARAM)
  return next
}

export function toParams(params: SearchParams | URLSearchParams): URLSearchParams {
  if (params instanceof URLSearchParams) return new URLSearchParams(params)

  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) next.append(key, item)
  }
  return next
}

/**
 * Drops one value from a repeated parameter, or the parameter entirely.
 *
 * Values may be comma-joined, so removing one means rewriting the list rather than
 * deleting a param — the reason the two encodings are read in one place.
 */
export function withoutValue(
  params: SearchParams | URLSearchParams,
  name: string,
  value: string | null,
): URLSearchParams {
  const next = firstPage(params)
  if (value === null) {
    next.delete(name)
    // A range writes two params; a chip removing it must clear both halves.
    if (name.endsWith(".min")) next.delete(`${name.slice(0, -4)}.max`)
    return next
  }

  const kept = next
    .getAll(name)
    .flatMap((entry) => entry.split(","))
    .filter((entry) => entry !== value)

  next.delete(name)
  if (kept.length > 0) next.set(name, kept.join(","))
  return next
}

/** Everything except the category: what "clear all filters" leaves behind. */
export function withoutFacets(params: SearchParams | URLSearchParams): URLSearchParams {
  const next = firstPage(params)
  for (const key of [...next.keys()]) {
    if (key.startsWith(FACET_PREFIX)) next.delete(key)
  }
  return next
}
