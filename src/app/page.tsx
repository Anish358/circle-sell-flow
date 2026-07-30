import { ButtonLink } from "@/components/button-link"

// Placeholder homepage. Replaced by the real listing grid once listings exist.
export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Nothing listed yet</h1>
      <p className="text-muted-foreground mt-3 max-w-prose text-sm leading-relaxed">
        Categories and the fields they collect are configured in the admin console and stored in the
        database — adding a category takes no code and no deploy. Configure one, then sell something
        in it.
      </p>
      <div className="mt-8 flex gap-3">
        <ButtonLink href="/sell">Sell an item</ButtonLink>
        <ButtonLink variant="outline" href="/admin">
          Open admin console
        </ButtonLink>
      </div>
    </div>
  )
}
