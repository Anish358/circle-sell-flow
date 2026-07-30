import type { Metadata } from "next"

import { getCategoryTree } from "@/lib/categories"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import { allFields } from "@/lib/form-schema/types"
import { CategoryPicker } from "./category-picker"
import { SellFlow } from "./sell-flow"

export const metadata: Metadata = { title: "Sell an item" }

/**
 * The seller flow.
 *
 * The category is a gate rather than a field: the form cannot exist before it is
 * known, so it lives in the URL and the schema is resolved on the server from it.
 * Everything after that is one renderer reading one contract.
 */
export default async function SellPage(props: {
  searchParams: Promise<{ category?: string; step?: string }>
}) {
  const { category, step } = await props.searchParams

  if (!category) {
    return (
      <Shell title="What are you selling?" subtitle="Pick a category to get started.">
        <CategoryPicker tree={await getCategoryTree()} />
      </Shell>
    )
  }

  const schema = await resolveFormSchema(category)

  if (!schema) {
    return (
      <Shell
        title="That category is not available"
        subtitle="It may have been renamed or deactivated. Pick another to continue."
      >
        <CategoryPicker tree={await getCategoryTree()} />
      </Shell>
    )
  }

  const fields = allFields(schema)
  const inherited = fields.filter((field) => field.origin.inherited).length

  return (
    <Shell
      title={schema.category.name}
      subtitle={schema.category.path.map((ancestor) => ancestor.name).join(" › ")}
      note={`${fields.length} category fields, ${inherited} inherited. Configured in the admin console, not in code.`}
    >
      <SellFlow schema={schema} initialStep={parseStep(step)} />
    </Shell>
  )
}

/** The step is mirrored in the URL so Back works; anything unrecognised starts over. */
const STEP_IDS = ["basics", "details", "price", "review"] as const

function parseStep(value: string | undefined) {
  return STEP_IDS.find((id) => id === value) ?? "basics"
}

function Shell({
  title,
  subtitle,
  note,
  children,
}: {
  title: string
  subtitle: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <header className="mb-6 grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{subtitle}</p>
        {note ? (
          <p className="text-muted-foreground mt-2 border-l-2 pl-3 text-xs leading-relaxed">
            {note}
          </p>
        ) : null}
      </header>
      {children}
    </div>
  )
}
