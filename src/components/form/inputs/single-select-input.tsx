"use client"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
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
 * "Pick one of N", in three presentations: a dropdown, a vertical radio list, or
 * chips.
 *
 * Chips are radios with different styling, not a different control — so keyboard
 * navigation and screen-reader semantics come for free, and switching a field
 * between the two is a presentation change with no behavioural cost.
 */
export function SingleSelectInput({
  field,
  value,
  onChange,
  id,
  describedBy,
  invalid,
  disabled,
}: FieldInputProps) {
  const selected = typeof value === "string" ? value : null

  if (field.renderAs === "dropdown") {
    return (
      <Select
        value={selected}
        onValueChange={(next) => onChange(next)}
        // Lets the trigger show the option's label while the value stays its slug.
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
          <SelectValue placeholder={field.placeholder ?? "Select…"} />
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
    <RadioGroup
      value={selected}
      onValueChange={(next) => onChange(next)}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={field.required || undefined}
      disabled={disabled}
      className={asChips ? "flex flex-wrap gap-2" : "grid gap-2"}
    >
      {field.options.map((option, index) => (
        <label
          key={option.slug}
          className={cn(
            "text-sm",
            asChips
              ? // The radio itself is hidden; the label becomes the chip, and
                // `has-focus-visible` keeps the focus ring visible on it.
                "border-input hover:bg-muted has-data-checked:border-primary has-data-checked:bg-primary has-data-checked:text-primary-foreground has-focus-visible:ring-ring/50 cursor-pointer rounded-full border px-3 py-1.5 transition-colors has-focus-visible:ring-3"
              : "flex items-center gap-2",
          )}
        >
          <RadioGroupItem
            value={option.slug}
            id={index === 0 ? id : undefined}
            className={asChips ? "sr-only" : undefined}
          />
          {option.label}
        </label>
      ))}
    </RadioGroup>
  )
}
