import type { FieldRenderAs, FieldType } from "@/db/schema"

/**
 * Sample registry — the data an admin would enter through the console.
 *
 * Written to demonstrate the three things the design is actually claiming:
 *
 *   1. **Fields are a shared library.** RAM, Storage and Battery Health are each
 *      one row assigned to several categories, not one row per category.
 *   2. **Assignments own context, fields own identity.** Battery Health is
 *      required for a handset and optional for a laptop — same field, two rules.
 *   3. **Assignments inherit downward.** Purchase Date sits on a root category and
 *      reaches a grandchild three levels down without being assigned there.
 *
 * Everything here is ordinary INSERTs. Adding a category is exactly this and
 * nothing more — no migration, no deploy.
 */

type SeedCategory = {
  slug: string
  name: string
  /** Slug of the parent, or null for a root. */
  parent: string | null
  sort: number
}

type SeedGroup = { slug: string; label: string; sort: number }

type SeedField = {
  slug: string
  label: string
  type: FieldType
  renderAs: FieldRenderAs
  /** Declarative validation rules, shaped by `type`. */
  config?: Record<string, unknown>
  placeholder?: string
  helpText?: string
  /** Select fields only. Listings store `slug`, never `label`. */
  options?: Array<{ slug: string; label: string }>
}

type SeedAssignment = {
  category: string
  field: string
  group?: string
  required?: boolean
  sort: number
  filterable?: boolean
  /** Show as a headline spec on the product page rather than in the details table. */
  prominent?: boolean
  /**
   * The hub can measure this one on arrival, so it appears on the verification form
   * and the product page can show a measured value beside the seller's claim.
   */
  verifiable?: boolean
  defaultValue?: unknown
  /**
   * Shape: { all | any: [{ field, op, value }] }, where `field` is another
   * field's slug. One rule, read by both the client (show/hide) and the server
   * (required-ness, and stripping values of fields that ended up hidden).
   */
  visibleWhen?: Record<string, unknown>
  /** Overrides the field's own help text for this category. */
  helpText?: string
}

/**
 * Two roots, and a middle tier that exists purely to hold what every device
 * shares. Depth is the point: Mobile Phone resolves fields from itself, from
 * Devices, and from Electronics.
 */
export const CATEGORIES: SeedCategory[] = [
  { slug: "electronics", name: "Electronics", parent: null, sort: 10 },
  { slug: "devices", name: "Devices", parent: "electronics", sort: 10 },
  { slug: "mobile-phone", name: "Mobile Phone", parent: "devices", sort: 10 },
  { slug: "laptop", name: "Laptop", parent: "devices", sort: 20 },

  { slug: "furniture", name: "Furniture", parent: null, sort: 20 },
  { slug: "sofa", name: "Sofa", parent: "furniture", sort: 10 },
]

export const FIELD_GROUPS: SeedGroup[] = [
  { slug: "basics", label: "Basics", sort: 10 },
  { slug: "specifications", label: "Specifications", sort: 20 },
  { slug: "comfort", label: "Comfort & Care", sort: 20 },
  // Three independent number fields, not one composite value — so "sofas under
  // 200cm wide" stays an ordinary filter on an ordinary number.
  { slug: "dimensions", label: "Dimensions", sort: 30 },
  { slug: "history", label: "Condition & History", sort: 40 },
]

/**
 * The field library. Note that `type` and `renderAs` are separate: Storage and
 * RAM are both "pick one of N" but one renders as chips and the other as a
 * dropdown, and Original Box and Pet Friendly are both booleans rendered
 * differently. Switching a widget never touches validation.
 */
export const FIELDS: SeedField[] = [
  {
    slug: "brand",
    label: "Brand",
    type: "single_select",
    renderAs: "dropdown",
    // One shared vocabulary is the cost of one shared field — see DECISIONS.md.
    options: [
      { slug: "apple", label: "Apple" },
      { slug: "samsung", label: "Samsung" },
      { slug: "oneplus", label: "OnePlus" },
      { slug: "xiaomi", label: "Xiaomi" },
      { slug: "google", label: "Google" },
      { slug: "nothing", label: "Nothing" },
      { slug: "dell", label: "Dell" },
      { slug: "hp", label: "HP" },
      { slug: "lenovo", label: "Lenovo" },
      { slug: "asus", label: "ASUS" },
    ],
  },
  {
    slug: "model",
    label: "Model",
    type: "text",
    renderAs: "input",
    config: { minLength: 2, maxLength: 60 },
    placeholder: "e.g. Galaxy S22 Ultra",
  },
  {
    slug: "colour",
    label: "Colour",
    type: "text",
    renderAs: "input",
    config: { maxLength: 30 },
    placeholder: "e.g. Midnight Black",
  },

  {
    slug: "storage",
    label: "Storage",
    type: "single_select",
    renderAs: "chips",
    options: [
      { slug: "64gb", label: "64 GB" },
      { slug: "128gb", label: "128 GB" },
      { slug: "256gb", label: "256 GB" },
      { slug: "512gb", label: "512 GB" },
      { slug: "1tb", label: "1 TB" },
      { slug: "2tb", label: "2 TB" },
    ],
  },
  {
    slug: "ram",
    label: "RAM",
    type: "single_select",
    renderAs: "dropdown",
    options: [
      { slug: "4gb", label: "4 GB" },
      { slug: "6gb", label: "6 GB" },
      { slug: "8gb", label: "8 GB" },
      { slug: "12gb", label: "12 GB" },
      { slug: "16gb", label: "16 GB" },
      { slug: "32gb", label: "32 GB" },
      { slug: "64gb", label: "64 GB" },
    ],
  },
  {
    slug: "processor",
    label: "Processor",
    type: "single_select",
    renderAs: "dropdown",
    options: [
      { slug: "intel-core-i3", label: "Intel Core i3" },
      { slug: "intel-core-i5", label: "Intel Core i5" },
      { slug: "intel-core-i7", label: "Intel Core i7" },
      { slug: "intel-core-i9", label: "Intel Core i9" },
      { slug: "amd-ryzen-5", label: "AMD Ryzen 5" },
      { slug: "amd-ryzen-7", label: "AMD Ryzen 7" },
      { slug: "apple-m2", label: "Apple M2" },
      { slug: "apple-m3", label: "Apple M3" },
    ],
  },
  {
    slug: "graphics-card",
    label: "Graphics Card",
    type: "single_select",
    renderAs: "dropdown",
    options: [
      { slug: "integrated", label: "Integrated" },
      { slug: "nvidia-rtx-3050", label: "NVIDIA RTX 3050" },
      { slug: "nvidia-rtx-4050", label: "NVIDIA RTX 4050" },
      { slug: "nvidia-rtx-4060", label: "NVIDIA RTX 4060" },
      { slug: "amd-radeon", label: "AMD Radeon" },
    ],
  },
  {
    slug: "ports",
    label: "Ports",
    type: "multi_select",
    renderAs: "multiselect",
    options: [
      { slug: "usb-a", label: "USB-A" },
      { slug: "usb-c", label: "USB-C" },
      { slug: "hdmi", label: "HDMI" },
      { slug: "thunderbolt", label: "Thunderbolt" },
      { slug: "sd-card", label: "SD card reader" },
      { slug: "ethernet", label: "Ethernet" },
      { slug: "headphone-jack", label: "Headphone jack" },
    ],
  },
  {
    slug: "battery-health",
    label: "Battery Health",
    type: "number",
    renderAs: "input",
    // Clamped per field, not by a global rule — 0–100 is true of a percentage,
    // not of every number in the system.
    config: { min: 0, max: 100, step: 1, unit: "%" },
    helpText: "Shown in Settings → Battery on most devices.",
  },

  {
    slug: "original-box",
    label: "Original Box",
    type: "boolean",
    renderAs: "radio",
  },
  {
    slug: "accessories",
    label: "Accessories Included",
    type: "multi_select",
    renderAs: "checkboxes",
    options: [
      { slug: "charger", label: "Charger" },
      { slug: "cable", label: "Cable" },
      { slug: "earphones", label: "Earphones" },
      { slug: "case", label: "Case" },
      { slug: "bill", label: "Original bill" },
    ],
  },

  {
    slug: "purchase-date",
    label: "Purchase Date",
    type: "date",
    renderAs: "date",
    config: { maxToday: true },
    helpText: "Roughly when you bought it. Used to show the item's age.",
  },
  {
    slug: "under-warranty",
    label: "Under Warranty",
    type: "boolean",
    renderAs: "radio",
  },
  {
    slug: "warranty-expiry",
    label: "Warranty Expiry Date",
    type: "date",
    renderAs: "date",
  },
  {
    slug: "known-issues",
    label: "Known Issues",
    type: "textarea",
    renderAs: "textarea",
    config: { maxLength: 500 },
    placeholder: "Scratches, dents, anything that does not work as it should",
    helpText: "Being upfront here gets items sold faster, not slower.",
  },

  {
    slug: "material",
    label: "Material",
    type: "single_select",
    renderAs: "dropdown",
    options: [
      { slug: "fabric", label: "Fabric" },
      { slug: "leather", label: "Leather" },
      { slug: "faux-leather", label: "Faux Leather" },
      { slug: "velvet", label: "Velvet" },
      { slug: "wood", label: "Wood" },
      { slug: "cane", label: "Cane" },
    ],
  },
  {
    slug: "seating-capacity",
    label: "Seating Capacity",
    type: "number",
    renderAs: "input",
    config: { min: 1, max: 12, step: 1, unit: "seats" },
  },
  {
    slug: "cushion-firmness",
    label: "Cushion Firmness",
    type: "single_select",
    renderAs: "radio",
    options: [
      { slug: "soft", label: "Soft" },
      { slug: "medium", label: "Medium" },
      { slug: "firm", label: "Firm" },
    ],
  },
  {
    slug: "pet-friendly",
    label: "Pet Friendly",
    type: "boolean",
    renderAs: "switch",
    helpText: "Scratch-resistant and easy to clean.",
  },

  {
    slug: "length-cm",
    label: "Length",
    type: "number",
    renderAs: "input",
    config: { min: 10, max: 500, step: 1, unit: "cm" },
  },
  {
    slug: "width-cm",
    label: "Width",
    type: "number",
    renderAs: "input",
    config: { min: 10, max: 300, step: 1, unit: "cm" },
  },
  {
    slug: "height-cm",
    label: "Height",
    type: "number",
    renderAs: "input",
    config: { min: 10, max: 300, step: 1, unit: "cm" },
  },
]

/**
 * Assignments. Read the `category` column: most rows point at an ancestor, not a
 * leaf, which is what makes adding a sibling category nearly free.
 *
 * `verifiable` is the same idea applied to the hub: what an inspector can put a number
 * on differs by category — storage and battery health are measurable on a device, the
 * seller's account of why they are selling is not — so it is a property of the
 * assignment, and the verification form is generated from it.
 */
export const ASSIGNMENTS: SeedAssignment[] = [
  // ── Electronics (root) — reaches Mobile Phone and Laptop, two levels down ──
  { category: "electronics", field: "purchase-date", group: "history", sort: 10 },
  { category: "electronics", field: "known-issues", group: "history", sort: 90 },

  // ── Devices — everything with a battery and a brand shares these ──
  { category: "devices", field: "brand", group: "basics", required: true, sort: 10 },
  { category: "devices", field: "model", group: "basics", required: true, sort: 20 },
  { category: "devices", field: "colour", group: "basics", sort: 30 },
  { category: "devices", field: "under-warranty", group: "history", sort: 20, defaultValue: false },
  {
    category: "devices",
    field: "warranty-expiry",
    group: "history",
    sort: 30,
    // The conditional pair from the brief: only asked when the answer above is yes.
    visibleWhen: { all: [{ field: "under-warranty", op: "eq", value: true }] },
  },

  // ── Mobile Phone — five of its own; everything else is inherited ──
  {
    category: "mobile-phone",
    field: "storage",
    group: "specifications",
    required: true,
    prominent: true,
    filterable: true,
    verifiable: true,
    sort: 10,
  },
  {
    category: "mobile-phone",
    field: "ram",
    group: "specifications",
    required: true,
    filterable: true,
    verifiable: true,
    sort: 20,
  },
  {
    category: "mobile-phone",
    field: "battery-health",
    group: "specifications",
    // Required here...
    required: true,
    prominent: true,
    filterable: true,
    // ...and the hub measures it on arrival, which is the number a buyer most wants
    // somebody other than the seller to have checked.
    verifiable: true,
    sort: 30,
  },
  { category: "mobile-phone", field: "original-box", group: "history", verifiable: true, sort: 50 },
  {
    category: "mobile-phone",
    field: "accessories",
    group: "history",
    // The hub can see what is in the box, which is exactly the claim buyers dispute.
    verifiable: true,
    sort: 60,
  },
  // Nearest ancestor wins: Electronics assigns Purchase Date as optional, and
  // this row overrides it for handsets specifically.
  {
    category: "mobile-phone",
    field: "purchase-date",
    group: "history",
    required: true,
    sort: 10,
  },

  // ── Laptop — reuses RAM, Storage and Battery Health as the *same* fields ──
  {
    category: "laptop",
    field: "processor",
    group: "specifications",
    required: true,
    prominent: true,
    verifiable: true,
    sort: 10,
  },
  {
    category: "laptop",
    field: "ram",
    group: "specifications",
    required: true,
    prominent: true,
    filterable: true,
    verifiable: true,
    sort: 20,
  },
  {
    category: "laptop",
    field: "storage",
    group: "specifications",
    required: true,
    filterable: true,
    verifiable: true,
    sort: 30,
  },
  { category: "laptop", field: "graphics-card", group: "specifications", sort: 40 },
  {
    category: "laptop",
    field: "battery-health",
    group: "specifications",
    // ...and optional here. One field, two policies — the whole point of the join.
    required: false,
    sort: 50,
    helpText: "Optional for laptops, where it is harder to read accurately.",
  },
  { category: "laptop", field: "ports", group: "specifications", sort: 60 },

  // ── Furniture (root) ──
  { category: "furniture", field: "purchase-date", group: "history", sort: 10 },
  { category: "furniture", field: "known-issues", group: "history", sort: 90 },

  // ── Sofa ──
  {
    category: "sofa",
    field: "material",
    group: "comfort",
    required: true,
    prominent: true,
    filterable: true,
    // Leather or faux is the claim a buyer cannot check from a photograph, and the one
    // an inspector can settle in a second.
    verifiable: true,
    sort: 10,
  },
  {
    category: "sofa",
    field: "seating-capacity",
    group: "comfort",
    required: true,
    prominent: true,
    filterable: true,
    sort: 20,
  },
  { category: "sofa", field: "cushion-firmness", group: "comfort", sort: 30 },
  { category: "sofa", field: "pet-friendly", group: "comfort", filterable: true, sort: 40 },
  {
    category: "sofa",
    field: "length-cm",
    group: "dimensions",
    required: true,
    // Measured with a tape at the hub. "Will it fit through my door" is not a question
    // to answer from the seller's memory.
    verifiable: true,
    sort: 10,
  },
  { category: "sofa", field: "width-cm", group: "dimensions", required: true, sort: 20 },
  { category: "sofa", field: "height-cm", group: "dimensions", required: true, sort: 30 },
]
