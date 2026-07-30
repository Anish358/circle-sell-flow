import type { FieldType } from "@/db/schema"
import type { FieldConfig, FieldOptionView } from "./types"

/**
 * Turning a stored value into something a person reads.
 *
 * Pure and client-safe, because both the seller's review step and the server-rendered
 * product page need it and they must not disagree — a review that says "8 GB" over a
 * page that says "8gb" is a small thing that reads as carelessness.
 *
 * The important case is options: listings store the option's **slug**, so rendering
 * without this lookup shows `faux-leather` where "Faux Leather" belongs. Archived
 * options are looked up too, so a listing keeps displaying the answer it was given even
 * after nobody new can choose it.
 */

/** The minimum needed to render a value, so both the form contract and the display
 *  query can satisfy it. */
export type Formattable = {
  type: FieldType
  options: readonly FieldOptionView[]
  config: FieldConfig
}

export function formatAttributeValue(field: Formattable, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null

  switch (field.type) {
    case "boolean":
      return value === true ? "Yes" : "No"

    case "single_select":
      return labelFor(field, value)

    case "multi_select": {
      if (!Array.isArray(value)) return String(value)
      // An explicit empty selection is an answer, and reads better than a blank cell.
      if (value.length === 0) return "None"
      return value.map((item) => labelFor(field, item)).join(", ")
    }

    case "number":
      return field.config.unit ? `${value} ${field.config.unit}` : String(value)

    case "date":
      return formatDate(String(value))

    default:
      return String(value)
  }
}

/** Falls back to the raw slug rather than hiding a value whose option row is gone. */
function labelFor(field: Formattable, value: unknown): string {
  return field.options.find((option) => option.slug === value)?.label ?? String(value)
}

/**
 * `2024-01-15` as "15 January 2024". Parsed as UTC and formatted without a timezone,
 * because a purchase date is a calendar date — shifting it into a timezone is how a
 * date drifts by a day.
 */
function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Paise to a displayable amount, with Indian digit grouping. */
export function formatPrice(pricePaise: number, currency = "INR"): string {
  const major = pricePaise / 100
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    // Second-hand prices are whole rupees; trailing ".00" is noise.
    maximumFractionDigits: major % 1 === 0 ? 0 : 2,
  }).format(major)
}
