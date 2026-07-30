"use client"

import type { AttributeValues, FormSchema } from "@/lib/form-schema/types"
import { computeVisibleFields } from "@/lib/form-schema/visibility"
import { CONDITIONS, type CommonDraft } from "@/lib/listings/input-schema"

/**
 * Everything the seller is about to publish, in one place.
 *
 * Shows only the fields that are actually visible, using the same evaluator the form
 * uses — so what is reviewed is exactly what will be stored. A warranty expiry the
 * seller filled in and then hid does not appear here, because it will not be saved.
 */
export function ReviewStep({
  schema,
  common,
  attributes,
  onEdit,
}: {
  schema: FormSchema
  common: CommonDraft
  attributes: AttributeValues
  onEdit: (step: "basics" | "details" | "price") => void
}) {
  const fields = schema.groups.flatMap((group) => group.fields)
  const visible = computeVisibleFields(fields, attributes)
  const condition = CONDITIONS.find((option) => option.value === common.condition)

  return (
    <div className="grid gap-6">
      <Section title="Listing" onEdit={() => onEdit("basics")}>
        <Row label="Title" value={common.title} />
        <Row label="Description" value={common.description || null} />
        <Row label="City" value={common.city} />
        <Row label="Category" value={schema.category.path.map((step) => step.name).join(" › ")} />
      </Section>

      <Section title="Condition & price" onEdit={() => onEdit("price")}>
        <Row label="Condition" value={condition?.label ?? null} />
        <Row
          label="Asking price"
          value={common.priceRupees ? formatRupees(common.priceRupees) : null}
        />
      </Section>

      <Section title={schema.category.name} onEdit={() => onEdit("details")}>
        {fields
          .filter((field) => visible.has(field.slug))
          .map((field) => (
            <Row
              key={field.slug}
              label={field.label}
              value={displayValue(field, attributes[field.slug])}
            />
          ))}
      </Section>
    </div>
  )
}

function Section({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-xs font-semibold tracking-wide uppercase">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
        >
          Edit
        </button>
      </header>
      <dl className="divide-y">{children}</dl>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-xs sm:text-sm">{label}</dt>
      <dd className="text-sm">
        {value === null || value === "" ? (
          <span className="text-muted-foreground italic">Not provided</span>
        ) : (
          // `whitespace-pre-line` keeps the paragraphs a seller typed.
          <span className="whitespace-pre-line">{value}</span>
        )}
      </dd>
    </div>
  )
}

/**
 * Renders a stored value the way a person reads it: option *labels* rather than the
 * slugs stored underneath, Yes/No for booleans, and the configured unit appended.
 */
function displayValue(
  field: FormSchema["groups"][number]["fields"][number],
  value: unknown,
): string | null {
  if (value === undefined || value === null || value === "") return null

  switch (field.type) {
    case "boolean":
      return value === true ? "Yes" : "No"

    case "single_select":
      return field.options.find((option) => option.slug === value)?.label ?? String(value)

    case "multi_select": {
      if (!Array.isArray(value) || value.length === 0) return "None"
      return value
        .map((slug) => field.options.find((option) => option.slug === slug)?.label ?? String(slug))
        .join(", ")
    }

    case "number":
      return field.config.unit ? `${value} ${field.config.unit}` : String(value)

    default:
      return String(value)
  }
}

/** Indian digit grouping, which is what the price is shown in everywhere else. */
function formatRupees(raw: string): string {
  const amount = Number(raw.replace(/[,\s]/g, ""))
  if (!Number.isFinite(amount)) return raw
  return `₹${amount.toLocaleString("en-IN")}`
}
