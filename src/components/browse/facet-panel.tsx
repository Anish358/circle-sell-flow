"use client"

import { useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  boundParam,
  browseUrl,
  firstPage,
  matchParam,
  readSelections,
  type Facet,
} from "@/lib/listings/facets"
import { cn } from "@/lib/utils"

/**
 * The filter panel — one component for every category, for the same reason there is
 * one form renderer: it is handed facets and knows nothing about what they mean.
 *
 * **The URL is the state.** Nothing here holds a copy of what is selected; every
 * control reads from the query string and every change writes a new one. That is what
 * makes a filtered view shareable, bookmarkable and survivable across a reload, and it
 * means the server and the browser can never disagree about what is filtered — there
 * is only one answer, and it is in the address bar.
 *
 * `useOptimistic` is what keeps that honest *and* responsive: a tick applies to the
 * displayed query immediately and is reconciled when the server's render lands, so the
 * checkbox does not sit unmoved for a round trip while remaining, in the end, a
 * function of the URL.
 */
export function FacetPanel({ facets, query }: { facets: Facet[]; query: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [optimisticQuery, setOptimisticQuery] = useOptimistic(query)

  const params = new URLSearchParams(optimisticQuery)
  const selections = readSelections(facets, params)
  const selected = new Map(selections.map((selection) => [selection.facet.slug, selection]))

  function apply(next: URLSearchParams) {
    if (sortedQuery(next) === sortedQuery(params)) return
    startTransition(() => {
      setOptimisticQuery(next.toString())
      router.push(browseUrl(next), { scroll: false })
    })
  }

  function toggle(facet: Facet, token: string, checked: boolean) {
    const selection = selected.get(facet.slug)
    const current = new Set(selection?.kind === "match" ? selection.tokens : [])
    if (checked) current.add(token)
    else current.delete(token)

    const next = firstPage(params)
    const name = matchParam(facet.slug)
    next.delete(name)
    // Comma-joined in the registry's option order: shorter to share, and stable, so
    // the same selection always produces the same link.
    const tokens = facet.options.map((o) => o.value).filter((value) => current.has(value))
    if (tokens.length > 0) next.set(name, tokens.join(","))

    apply(next)
  }

  /** Ranges commit on blur and on Enter rather than per keystroke: typing "100" would
   *  otherwise navigate three times, the first two to a page nobody asked for. */
  function commitRange(facet: Facet, form: HTMLFormElement) {
    const data = new FormData(form)
    const next = firstPage(params)

    for (const bound of ["min", "max"] as const) {
      const name = boundParam(facet.slug, bound)
      const value = String(data.get(name) ?? "").trim()
      if (value) next.set(name, value)
      else next.delete(name)
    }

    apply(next)
  }

  if (facets.length === 0) return null

  return (
    <section className="grid gap-3" aria-busy={pending || undefined}>
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Filters</p>

      <div className={cn("grid gap-6 transition-opacity", pending && "opacity-60")}>
        {facets.map((facet) =>
          facet.kind === "match" ? (
            <MatchFacet key={facet.slug} facet={facet} selected={selected} onToggle={toggle} />
          ) : (
            <RangeFacet
              key={facet.slug}
              facet={facet}
              selected={selected}
              onCommit={(form) => commitRange(facet, form)}
            />
          ),
        )}
      </div>
    </section>
  )
}

type SelectionMap = Map<string, ReturnType<typeof readSelections>[number]>

function MatchFacet({
  facet,
  selected,
  onToggle,
}: {
  facet: Facet
  selected: SelectionMap
  onToggle: (facet: Facet, token: string, checked: boolean) => void
}) {
  const selection = selected.get(facet.slug)
  const tokens = new Set(selection?.kind === "match" ? selection.tokens : [])

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{facet.label}</legend>
      {facet.options.map((option) => (
        <Label key={option.value} className="text-muted-foreground gap-2 font-normal">
          <Checkbox
            checked={tokens.has(option.value)}
            onCheckedChange={(checked) => onToggle(facet, option.value, checked === true)}
          />
          {option.label}
        </Label>
      ))}
    </fieldset>
  )
}

/**
 * A range is two bounds, either of which may be left open — "80% and up" is the
 * common case and "between 80 and 90" is the rarer one, and both fall out of the same
 * pair of inputs.
 */
function RangeFacet({
  facet,
  selected,
  onCommit,
}: {
  facet: Facet
  selected: SelectionMap
  onCommit: (form: HTMLFormElement) => void
}) {
  const selection = selected.get(facet.slug)
  const range = selection?.kind === "range" ? selection : null
  const type = facet.type === "date" ? "date" : "number"

  return (
    <form
      className="grid gap-2"
      // Enter inside either input submits, which is the same commit as a blur.
      onSubmit={(event) => {
        event.preventDefault()
        onCommit(event.currentTarget)
      }}
    >
      <p className="text-sm font-medium">{facet.label}</p>
      <div className="flex items-center gap-2">
        {(["min", "max"] as const).map((bound) => (
          <Input
            key={`${bound}-${range?.[bound] ?? ""}`}
            type={type}
            name={boundParam(facet.slug, bound)}
            // The field's own configured bounds, so the filter cannot ask for a value
            // the form would have refused to store.
            min={facet.min ?? undefined}
            max={facet.max ?? undefined}
            defaultValue={range?.[bound] ?? ""}
            placeholder={bound === "min" ? "Min" : "Max"}
            aria-label={`${facet.label}, ${bound === "min" ? "minimum" : "maximum"}${
              facet.unit ? ` in ${facet.unit}` : ""
            }`}
            onBlur={(event) => onCommit(event.currentTarget.form!)}
            className="h-9"
          />
        ))}
        {facet.unit ? (
          <span className="text-muted-foreground shrink-0 text-sm">{facet.unit}</span>
        ) : null}
      </div>
    </form>
  )
}

/** Order-insensitive comparison, so re-writing the same filters is not a navigation. */
function sortedQuery(params: URLSearchParams): string {
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  return new URLSearchParams(entries).toString()
}
