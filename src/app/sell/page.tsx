import Link from "next/link"
import type { Metadata } from "next"

import { Button } from "@/components/ui/button"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import { allFields } from "@/lib/form-schema/types"
import { AttributeForm } from "./attribute-form"
import { CategoryPicker } from "./category-picker"

export const metadata: Metadata = { title: "Sell an item" }

/**
 * The sell flow's category-specific step.
 *
 * The schema is resolved on the server and rendered by one component. Two different
 * categories produce two different forms here, and the only difference between them
 * anywhere is rows in Postgres.
 */
export default async function SellPage(props: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await props.searchParams

  if (!category) {
    return (
      <Shell title="What are you selling?" subtitle="Pick a category to get started.">
        <CategoryPicker />
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
        <CategoryPicker />
      </Shell>
    )
  }

  const fields = allFields(schema)
  const inherited = fields.filter((field) => field.origin.inherited).length

  return (
    <Shell
      title={schema.category.name}
      subtitle={schema.category.path.map((step) => step.name).join(" › ")}
    >
      <div className="grid gap-6">
        {/* Makes the design's central claim legible while filling the form in. */}
        <p className="text-muted-foreground border-l-2 pl-3 text-xs leading-relaxed">
          {fields.length} fields, {inherited} inherited from parent categories. Configured in the
          admin console, not in code.
        </p>

        <AttributeForm schema={schema} />

        <div className="flex items-center gap-3 border-t pt-6">
          <Button disabled>Continue</Button>
          <Button variant="ghost" size="sm" render={<Link href="/sell">Change category</Link>} />
        </div>
      </div>
    </Shell>
  )
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
      </header>
      {children}
    </div>
  )
}
