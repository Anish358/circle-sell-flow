"use client"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import type { FieldInputProps } from "./types"

/**
 * Booleans, rendered either as an explicit Yes/No pair or as a switch.
 *
 * Two very different-looking controls over one stored value — the clearest example
 * of why `renderAs` is not `type`. Yes/No radios suit a question of fact ("does it
 * come with the box?"); a switch suits a characteristic ("pet friendly").
 */
export function BooleanInput({
  field,
  value,
  onChange,
  id,
  describedBy,
  invalid,
  disabled,
}: FieldInputProps) {
  const checked = value === true

  if (field.renderAs === "switch") {
    return (
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(next) => onChange(next)}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        disabled={disabled}
      />
    )
  }

  // Radio values must be strings; the stored value stays a real boolean.
  return (
    <RadioGroup
      value={value === true ? "yes" : value === false ? "no" : null}
      onValueChange={(next) => onChange(next === "yes")}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={field.required || undefined}
      disabled={disabled}
      className="flex gap-6"
    >
      {[
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ].map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <RadioGroupItem
            value={option.value}
            // Only the first radio takes the shell's id, so the legend's
            // association and focus management both land somewhere sensible.
            id={option.value === "yes" ? id : undefined}
          />
          {option.label}
        </label>
      ))}
    </RadioGroup>
  )
}
