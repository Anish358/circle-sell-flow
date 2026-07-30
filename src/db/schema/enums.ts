import { pgEnum } from "drizzle-orm/pg-core"

/**
 * How a value is stored and validated. This is the field's identity and can
 * never change in place — reinterpreting "eight GB" as a number is not a
 * migration anyone can write, so changing a type means creating a new field.
 */
export const fieldType = pgEnum("field_type", [
  "text",
  "textarea",
  "number",
  "boolean",
  "date",
  "single_select",
  "multi_select",
])

/**
 * How a value is presented. Deliberately separate from `field_type`: radio
 * versus dropdown is not a type, it is a rendering of "pick one of N". Keeping
 * them apart means one validator per type instead of one per widget, and
 * "make that a radio group" becomes a presentation toggle.
 *
 * Which pairings are legal is enforced by a check constraint on `fields`.
 */
export const fieldRenderAs = pgEnum("field_render_as", [
  "input", // text, number
  "textarea",
  "date",
  "switch", // boolean
  "radio", // boolean, single_select
  "dropdown", // single_select
  "chips", // single_select, multi_select
  "checkboxes", // multi_select
  "multiselect", // multi_select
])

export const listingStatus = pgEnum("listing_status", ["draft", "active", "sold", "removed"])

export const listingCondition = pgEnum("listing_condition", [
  "new",
  "like_new",
  "excellent",
  "good",
  "fair",
])

export const userRole = pgEnum("user_role", ["seller", "admin"])

export type FieldType = (typeof fieldType.enumValues)[number]
export type FieldRenderAs = (typeof fieldRenderAs.enumValues)[number]
export type ListingStatus = (typeof listingStatus.enumValues)[number]
export type ListingCondition = (typeof listingCondition.enumValues)[number]
export type UserRole = (typeof userRole.enumValues)[number]

/**
 * The legal `type → render_as` pairings, in one place. Used to build the check
 * constraint on `fields` and to validate admin input, so the matrix cannot drift
 * between the two.
 */
export const RENDER_OPTIONS: Record<FieldType, readonly FieldRenderAs[]> = {
  text: ["input"],
  textarea: ["textarea"],
  number: ["input"],
  boolean: ["radio", "switch"],
  date: ["date"],
  single_select: ["radio", "dropdown", "chips"],
  multi_select: ["checkboxes", "multiselect", "chips"],
}
