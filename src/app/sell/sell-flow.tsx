"use client"

import { useEffect, useRef, useState } from "react"
import { CheckIcon, ChevronLeftIcon } from "lucide-react"

import { ButtonLink } from "@/components/button-link"
import { DynamicForm } from "@/components/form/dynamic-form"
import { fieldIds } from "@/components/form/field-shell"
import { Button } from "@/components/ui/button"
import { allFields, type FormSchema } from "@/lib/form-schema/types"
import { validateAttributes } from "@/lib/form-schema/validation"
import { basicsStepSchema, priceStepSchema, type CommonDraft } from "@/lib/listings/input-schema"
import { cn } from "@/lib/utils"
import { BasicsStep } from "./steps/basics-step"
import { PriceStep } from "./steps/price-step"
import { ReviewStep } from "./steps/review-step"
import { useDraft } from "./use-draft"

/**
 * The seller flow.
 *
 * Four steps after the category gate. Each is validated on its own when the seller
 * moves forward — demanding answers they have not reached yet would be a worse
 * experience than letting them find out at the end — and the whole thing is validated
 * again on submit, by the same schemas, and once more by the API.
 *
 * Photos will slot in as a step between Basics and Details once uploads exist; the
 * steps are a list, so that costs one entry.
 */

const STEPS = [
  { id: "basics", label: "Basics" },
  { id: "details", label: "Details" },
  { id: "price", label: "Condition & price" },
  { id: "review", label: "Review" },
] as const

type StepId = (typeof STEPS)[number]["id"]

type Created = { slug: string; title: string }

function isStepId(value: unknown): value is StepId {
  return STEPS.some((entry) => entry.id === value)
}

export function SellFlow({ schema, initialStep }: { schema: FormSchema; initialStep: StepId }) {
  const { draft, setCommon, setAttribute, clear, acknowledgeNotice } = useDraft(schema)

  const [step, setStepState] = useState<StepId>(initialStep)
  const [commonErrors, setCommonErrors] = useState<Record<string, string>>({})
  const [attributeErrors, setAttributeErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)

  /**
   * A stable key for this attempt, so a retried submit cannot create two listings.
   * Generated on first use rather than during render: rendering must stay pure, and
   * `crypto.randomUUID()` is not.
   */
  const idempotencyKey = useRef<string | null>(null)
  const takeIdempotencyKey = () => (idempotencyKey.current ??= `sell-${crypto.randomUUID()}`)

  const errorSummary = useRef<HTMLDivElement>(null)
  const stepIndex = STEPS.findIndex((entry) => entry.id === step)

  /**
   * The step lives in the URL as well as in state.
   *
   * Without this, pressing Back on a mobile browser leaves the form entirely rather than
   * going back a step, which is the commonest way to lose a half-written listing.
   * `history.pushState` rather than a router navigation, so no server round trip and
   * no risk of remounting this component and discarding what has been typed.
   */
  function setStep(next: StepId) {
    setStepState(next)
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      url.searchParams.set("step", next)
      window.history.pushState(null, "", url)
    }
  }

  useEffect(() => {
    function onPopState() {
      const fromUrl = new URLSearchParams(window.location.search).get("step")
      setStepState(isStepId(fromUrl) ? fromUrl : "basics")
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  if (created) return <Created created={created} categorySlug={schema.category.slug} />

  /**
   * Moves focus to the first thing that is wrong, which is what a keyboard or screen
   * reader user needs and a sighted user on a long form appreciates too.
   */
  function focusFirstError(slugs: string[]) {
    const first = slugs[0]
    if (!first) return
    requestAnimationFrame(() => {
      const control = document.getElementById(fieldIds(first).control)
      if (control) control.focus({ preventScroll: false })
      else errorSummary.current?.focus()
    })
  }

  function validateStep(target: StepId): boolean {
    setFormError(null)

    if (target === "basics") {
      const result = basicsStepSchema.safeParse({
        title: draft.common.title,
        description: draft.common.description || undefined,
        city: draft.common.city,
      })
      const errors = result.success ? {} : issuesToErrors(result.error.issues)
      setCommonErrors(errors)
      if (!result.success) focusFirstError(Object.keys(errors))
      return result.success
    }

    if (target === "price") {
      const result = priceStepSchema.safeParse({
        condition: draft.common.condition,
        priceRupees: toNumber(draft.common.priceRupees),
      })
      const errors = result.success ? {} : issuesToErrors(result.error.issues)
      setCommonErrors(errors)
      if (!result.success) focusFirstError(Object.keys(errors))
      return result.success
    }

    if (target === "details") {
      // Publish rules, so the seller finds out here rather than at the very end.
      const result = validateAttributes(allFields(schema), draft.attributes, "publish")
      const errors = result.ok ? {} : withoutFormKey(result.errors)
      setAttributeErrors(errors)
      if (!result.ok) {
        setFormError(result.errors._form ?? null)
        focusFirstError(Object.keys(errors))
      }
      return result.ok
    }

    return true
  }

  function goNext() {
    if (!validateStep(step)) return
    const next = STEPS[stepIndex + 1]
    if (next) setStep(next.id)
  }

  async function submit() {
    // Re-check every step, in order, so the seller is sent back to the earliest
    // problem rather than the last one found.
    for (const target of ["basics", "details", "price"] as const) {
      if (!validateStep(target)) {
        setStep(target)
        return
      }
    }

    setSubmitting(true)
    setFormError(null)

    try {
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categorySlug: schema.category.slug,
          title: draft.common.title,
          description: draft.common.description || undefined,
          city: draft.common.city,
          condition: draft.common.condition,
          priceRupees: toNumber(draft.common.priceRupees),
          attributes: draft.attributes,
          publish: true,
          // Lets the API say the form moved while this was being filled in.
          configVersion: schema.configVersion,
          idempotencyKey: takeIdempotencyKey(),
        }),
      })

      const payload = await response.json()

      if (!response.ok) {
        const fieldErrors: Record<string, string> = payload.error?.fieldErrors ?? {}
        setFormError(payload.error?.message ?? "Could not publish this listing.")
        setAttributeErrors(withoutFormKey(fieldErrors))
        setCommonErrors(commonKeysOnly(fieldErrors))
        errorSummary.current?.focus()
        return
      }

      clear()
      setCreated({ slug: payload.listing.slug, title: draft.common.title })
    } catch {
      setFormError("Could not reach the server. Your answers are saved — try again.")
      errorSummary.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // Padding at the bottom clears the sticky action bar on a small screen.
    <div className="grid gap-6 pb-28">
      <Stepper current={stepIndex} />

      {draft.restoredAt ? (
        <Notice onDismiss={acknowledgeNotice}>
          Picked up where you left off.
          {draft.schemaMoved
            ? " This category's form has changed since — please check your answers."
            : null}
        </Notice>
      ) : null}

      {draft.carriedOver ? (
        <Notice onDismiss={acknowledgeNotice}>
          Kept {draft.carriedOver.kept.length} answer
          {draft.carriedOver.kept.length === 1 ? "" : "s"} from your {""}
          {draft.carriedOver.fromCategoryName} draft
          {draft.carriedOver.kept.length > 0
            ? ` (${draft.carriedOver.kept.slice(0, 4).join(", ")}${draft.carriedOver.kept.length > 4 ? "…" : ""})`
            : null}
          .
          {draft.carriedOver.dropped.length > 0
            ? ` ${draft.carriedOver.dropped.join(", ")} ${draft.carriedOver.dropped.length === 1 ? "does" : "do"} not apply here.`
            : null}
        </Notice>
      ) : null}

      {formError ? (
        <div
          ref={errorSummary}
          tabIndex={-1}
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm"
        >
          {formError}
        </div>
      ) : null}

      {step === "basics" ? (
        <BasicsStep common={draft.common} errors={commonErrors} onChange={setCommon} />
      ) : null}

      {step === "details" ? (
        <DynamicForm
          schema={schema}
          values={draft.attributes}
          onChange={setAttribute}
          errors={attributeErrors}
        />
      ) : null}

      {step === "price" ? (
        <PriceStep common={draft.common} errors={commonErrors} onChange={setCommon} />
      ) : null}

      {step === "review" ? (
        <ReviewStep
          schema={schema}
          common={draft.common}
          attributes={draft.attributes}
          onEdit={setStep}
        />
      ) : null}

      <ActionBar
        onBack={() => {
          const previous = STEPS[stepIndex - 1]
          if (previous) setStep(previous.id)
        }}
        showBack={stepIndex > 0}
        primary={
          step === "review" ? (
            <Button onClick={submit} disabled={submitting} className="min-h-11 flex-1 sm:flex-none">
              {submitting ? "Publishing…" : "Publish listing"}
            </Button>
          ) : (
            <Button onClick={goNext} className="min-h-11 flex-1 sm:flex-none">
              Continue
            </Button>
          )
        }
      />
    </div>
  )
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Progress">
      {STEPS.map((entry, index) => (
        <li key={entry.id} className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1.5",
              index === current
                ? "text-foreground font-medium"
                : index < current
                  ? "text-muted-foreground"
                  : "text-muted-foreground/50",
            )}
            aria-current={index === current ? "step" : undefined}
          >
            {index < current ? <CheckIcon className="size-3" aria-hidden="true" /> : null}
            {entry.label}
          </span>
          {index < STEPS.length - 1 ? (
            <span className="text-muted-foreground/30" aria-hidden="true">
              /
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

/**
 * Fixed to the bottom of the viewport, so the primary action is reachable with a thumb
 * on a long form rather than requiring a scroll to the end of it.
 */
function ActionBar({
  onBack,
  showBack,
  primary,
}: {
  onBack: () => void
  showBack: boolean
  primary: React.ReactNode
}) {
  return (
    <div className="bg-background/95 fixed inset-x-0 bottom-0 border-t backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        {showBack ? (
          <Button variant="ghost" onClick={onBack} className="min-h-11">
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
            Back
          </Button>
        ) : (
          <ButtonLink variant="ghost" className="min-h-11" href="/sell">
            Change category
          </ButtonLink>
        )}
        <div className="ml-auto flex flex-1 justify-end sm:flex-none">{primary}</div>
      </div>
    </div>
  )
}

function Notice({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div className="bg-muted/50 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm">
      <p className="flex-1 leading-relaxed">{children}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
      >
        Dismiss
      </button>
    </div>
  )
}

function Created({ created, categorySlug }: { created: Created; categorySlug: string }) {
  return (
    <div className="grid gap-6 py-8">
      <div className="grid gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Published</h2>
        <p className="text-muted-foreground text-sm">
          “{created.title}” is live. Its link is{" "}
          <code className="bg-muted rounded px-1.5 py-0.5 text-xs">/listings/{created.slug}</code>.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/">Back to browse</ButtonLink>
        <ButtonLink variant="outline" href={`/sell?category=${categorySlug}`}>
          Sell another
        </ButtonLink>
      </div>
    </div>
  )
}

/** Zod issues keyed by the field they belong to. */
function issuesToErrors(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const errors: Record<string, string> = {}
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "_form")
    errors[key] ??= issue.message
  }
  return errors
}

const COMMON_KEYS = new Set<keyof CommonDraft | string>([
  "title",
  "description",
  "city",
  "condition",
  "priceRupees",
])

function commonKeysOnly(errors: Record<string, string>) {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => COMMON_KEYS.has(key)))
}

/** `_form` is rendered as the summary, not against a field. */
function withoutFormKey(errors: Record<string, string>) {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key !== "_form"))
}

/** Accepts the digit grouping a seller types; leaves anything else for Zod to reject. */
function toNumber(raw: string): number | undefined {
  const cleaned = raw.replace(/[,\s₹]/g, "")
  if (cleaned === "") return undefined
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}
