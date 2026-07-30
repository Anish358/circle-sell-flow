import { cn } from "@/lib/utils"

/**
 * The label, help text and error message around every field, plus the `aria-*`
 * wiring that connects them.
 *
 * Generated forms are where accessibility fails systematically: nobody remembers
 * to link an error message to its input on the twentieth field type. Putting it in
 * one component means every field, including ones invented next year by an admin,
 * gets it for free.
 */

/** Deterministic ids, so the label, help text and error all agree. */
export function fieldIds(slug: string) {
  return {
    control: `field-${slug}`,
    help: `field-${slug}-help`,
    error: `field-${slug}-error`,
  }
}

/** The `aria-describedby` value for a field, or undefined when there is nothing to point at. */
export function describedBy(slug: string, hasHelp: boolean, hasError: boolean) {
  const ids = fieldIds(slug)
  const parts = [hasHelp ? ids.help : null, hasError ? ids.error : null].filter(Boolean)
  return parts.length > 0 ? parts.join(" ") : undefined
}

type FieldShellProps = {
  slug: string
  label: string
  required: boolean
  helpText: string | null
  error?: string
  /**
   * Groups of controls (radios, checkboxes) get a fieldset and a legend, because a
   * single `<label>` cannot describe several inputs at once.
   */
  grouped: boolean
  children: React.ReactNode
}

export function FieldShell({
  slug,
  label,
  required,
  helpText,
  error,
  grouped,
  children,
}: FieldShellProps) {
  const ids = fieldIds(slug)

  const labelContent = (
    <>
      {label}
      {required ? (
        <span className="text-destructive" aria-hidden="true">
          *
        </span>
      ) : null}
      {/* Announced instead of the bare asterisk, which screen readers may skip. */}
      {required ? <span className="sr-only"> (required)</span> : null}
    </>
  )

  const labelClass = "flex items-center gap-1 text-sm font-medium"

  return (
    <Wrapper grouped={grouped} className="grid gap-2">
      {grouped ? (
        <legend className={labelClass}>{labelContent}</legend>
      ) : (
        <label htmlFor={ids.control} className={labelClass}>
          {labelContent}
        </label>
      )}

      {children}

      {helpText ? (
        <p id={ids.help} className="text-muted-foreground text-xs leading-relaxed">
          {helpText}
        </p>
      ) : null}

      {error ? (
        // `role="alert"` so the message is announced when it appears, not only
        // when focus happens to reach the input.
        <p id={ids.error} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </Wrapper>
  )
}

function Wrapper({
  grouped,
  className,
  children,
}: {
  grouped: boolean
  className?: string
  children: React.ReactNode
}) {
  return grouped ? (
    <fieldset className={cn(className, "min-w-0")}>{children}</fieldset>
  ) : (
    <div className={className}>{children}</div>
  )
}
