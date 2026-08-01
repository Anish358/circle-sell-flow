"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { SearchIcon, XIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * One search box, used by browse, the admin listings table and the field library.
 *
 * **The URL is the state**, exactly as it is for the browse filters: the term lives in a
 * query parameter, so a search is shareable, survives a reload, and moves under the back
 * button — and the server and the browser cannot disagree about what is being searched,
 * because there is only one answer and it is in the address bar.
 *
 * It applies as you type, after a pause. Waiting for Enter makes a list feel inert when
 * the results are right there; navigating on every keystroke would be a server round trip
 * per character. The pause is the compromise, and Enter still commits immediately for
 * anyone who reaches for it.
 */

/**
 * 400ms. Long enough that an average typist finishes a word without a request going out
 * mid-word, short enough that the list feels like it is responding to typing rather than
 * to a decision — past roughly half a second it reads as lag, and a full two seconds
 * reads as broken.
 */
const DEBOUNCE_MS = 400

export function SearchBox({
  param = "q",
  query,
  label,
  placeholder,
  resetParams = [],
  className,
}: {
  /** The query parameter to write. */
  param?: string
  /** The current query string, passed from the server so this holds no copy of it. */
  query: string
  /** The accessible name. Visually hidden — the icon and placeholder carry it visually. */
  label: string
  placeholder: string
  /**
   * Parameters to drop when the term changes — a pagination cursor, above all: it points
   * into the previous result set, so carrying it over lands on an empty page.
   */
  resetParams?: readonly string[]
  className?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const params = new URLSearchParams(query)
  const committed = params.get(param) ?? ""

  const [text, setText] = useState(committed)
  /** The last term this box asked for, so its own navigation is not mistaken for an
   *  external one. */
  const applied = useRef(committed)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Adopt a term that changed elsewhere — the back button, or a link — without ever
  // clobbering what someone is in the middle of typing. Comparing against what this box
  // last applied is what tells the two apart.
  useEffect(() => {
    if (committed !== applied.current) {
      applied.current = committed
      setText(committed)
    }
  }, [committed])

  useEffect(() => () => clearTimer(), [])

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  function apply(next: string) {
    clearTimer()

    const trimmed = next.trim()
    if (trimmed === committed) return

    const updated = new URLSearchParams(query)
    if (trimmed) updated.set(param, trimmed)
    else updated.delete(param)
    for (const key of resetParams) updated.delete(key)

    applied.current = trimmed
    const search = updated.toString()
    const href = search ? `?${search}` : "?"

    startTransition(() => {
      // Refining an existing search replaces, so the back button does not walk through
      // "s", "so", "sof". Starting one, or clearing it, is a real step worth returning to.
      const isRefinement = committed !== "" && trimmed !== ""
      if (isRefinement) router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    })
  }

  function onChange(next: string) {
    setText(next)
    clearTimer()
    timer.current = setTimeout(() => apply(next), DEBOUNCE_MS)
  }

  return (
    <form
      role="search"
      className={cn("relative", className)}
      onSubmit={(event) => {
        event.preventDefault()
        apply(text)
      }}
    >
      <SearchIcon
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden="true"
      />

      <Input
        type="search"
        name={param}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        className={cn(
          "pl-9",
          text && "pr-9",
          pending && "opacity-70",
          // WebKit draws its own clear button inside a search input, which would sit
          // beside the one below and give the box two of them.
          "[&::-webkit-search-cancel-button]:hidden",
        )}
      />

      {text ? (
        <button
          type="button"
          onClick={() => {
            setText("")
            apply("")
          }}
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md outline-none focus-visible:ring-3"
        >
          <XIcon className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </form>
  )
}
