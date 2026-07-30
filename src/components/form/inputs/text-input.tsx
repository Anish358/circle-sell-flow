"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { FieldInputProps } from "./types"

/**
 * The four types whose value is a single scalar: text, textarea, number and date.
 *
 * They share a component because they share a value shape, not because they look
 * alike — which is the same reasoning that keeps `type` and `renderAs` separate in
 * the first place.
 */
export function TextInput({
  field,
  value,
  onChange,
  id,
  describedBy,
  invalid,
  disabled,
}: FieldInputProps) {
  const shared = {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
    "aria-required": field.required || undefined,
    disabled,
    placeholder: field.placeholder ?? undefined,
  }

  if (field.type === "textarea") {
    return (
      <Textarea
        {...shared}
        value={typeof value === "string" ? value : ""}
        maxLength={field.config.maxLength}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  if (field.type === "number") {
    return (
      <div className="relative">
        <Input
          {...shared}
          type="number"
          // Brings up the numeric keypad on mobile rather than the full keyboard.
          inputMode={field.config.step === 1 ? "numeric" : "decimal"}
          min={field.config.min}
          max={field.config.max}
          step={field.config.step}
          value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
          className={field.config.unit ? "pr-12" : undefined}
          onChange={(event) => {
            const raw = event.target.value
            // Empty means unanswered, not zero. Anything unparseable is kept as the
            // raw string so validation can report it instead of silently discarding
            // what the seller typed.
            if (raw === "") return onChange(null)
            const parsed = Number(raw)
            onChange(Number.isFinite(parsed) ? parsed : raw)
          }}
        />
        {field.config.unit ? (
          <span
            className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm"
            // The unit labels the input visually; it is never part of the value.
            aria-hidden="true"
          >
            {field.config.unit}
          </span>
        ) : null}
      </div>
    )
  }

  if (field.type === "date") {
    return (
      <Input
        {...shared}
        type="date"
        value={typeof value === "string" ? value : ""}
        // A purchase date cannot be in the future; the picker enforces it too.
        max={field.config.maxToday ? today() : undefined}
        onChange={(event) => onChange(event.target.value || null)}
      />
    )
  }

  return (
    <Input
      {...shared}
      type="text"
      value={typeof value === "string" ? value : ""}
      maxLength={field.config.maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/** Local date in YYYY-MM-DD, which is what a date input expects. */
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}
