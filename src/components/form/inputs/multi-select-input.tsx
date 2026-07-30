"use client"

import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { FieldInputProps } from "./types"

/**
 * "Pick any of N". The value is always an array of option slugs, whichever of the
 * three presentations is configured.
 *
 * An empty selection is stored as `[]` rather than omitted, so "I checked nothing"
 * is distinguishable from "I never saw this field".
 */
export function MultiSelectInput({
  field,
  value,
  onChange,
  id,
  describedBy,
  invalid,
  disabled,
}: FieldInputProps) {
  const selected = Array.isArray(value) ? value.filter((item) => typeof item === "string") : []

  const toggle = (slug: string) => {
    const next = selected.includes(slug)
      ? selected.filter((item) => item !== slug)
      : // Kept in the registry's option order, not click order, so two listings
        // with the same answers store the same array.
        field.options.filter((o) => o.slug === slug || selected.includes(o.slug)).map((o) => o.slug)
    onChange(next)
  }

  if (field.renderAs === "multiselect") {
    return (
      <Select
        multiple
        value={selected}
        onValueChange={(next) => onChange(next)}
        items={field.options.map((option) => ({ value: option.slug, label: option.label }))}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={field.required || undefined}
        >
          <SelectValue placeholder={field.placeholder ?? "Select any that apply…"} />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((option) => (
            <SelectItem key={option.slug} value={option.slug}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  const asChips = field.renderAs === "chips"

  return (
    <div className={asChips ? "flex flex-wrap gap-2" : "grid gap-2"} aria-describedby={describedBy}>
      {field.options.map((option, index) => (
        <label
          key={option.slug}
          className={cn(
            "text-sm",
            asChips
              ? "border-input hover:bg-muted has-data-checked:border-primary has-data-checked:bg-primary has-data-checked:text-primary-foreground has-focus-visible:ring-ring/50 cursor-pointer rounded-full border px-3 py-1.5 transition-colors has-focus-visible:ring-3"
              : "flex items-center gap-2",
          )}
        >
          <Checkbox
            id={index === 0 ? id : undefined}
            checked={selected.includes(option.slug)}
            onCheckedChange={() => toggle(option.slug)}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={asChips ? "sr-only" : undefined}
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}
