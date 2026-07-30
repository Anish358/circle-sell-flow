"use client"

import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { describedBy, FieldShell } from "@/components/form/field-shell"
import { CONDITIONS, type CommonDraft, type ConditionValue } from "@/lib/listings/input-schema"

/**
 * Condition and price — the two answers a buyer decides on, so they get a step of
 * their own rather than being buried among the specifications.
 *
 * Condition is offered with a plain-language hint per option, because "Good" and
 * "Fair" mean whatever the seller hopes they mean otherwise, and a dispute over
 * condition is the most expensive kind for a marketplace that guarantees the
 * transaction.
 */
export function PriceStep({
  common,
  errors,
  onChange,
}: {
  common: CommonDraft
  errors: Record<string, string>
  onChange: <K extends keyof CommonDraft>(key: K, value: CommonDraft[K]) => void
}) {
  return (
    <div className="grid gap-6">
      <FieldShell
        slug="condition"
        label="Condition"
        required
        helpText={null}
        error={errors.condition}
        grouped
      >
        <RadioGroup
          value={common.condition}
          onValueChange={(value) => onChange("condition", value as ConditionValue)}
          aria-invalid={Boolean(errors.condition) || undefined}
          aria-describedby={describedBy("condition", false, Boolean(errors.condition))}
          aria-required
          className="grid gap-2"
        >
          {CONDITIONS.map((condition, index) => (
            <label
              key={condition.value}
              className="hover:bg-muted has-data-checked:border-primary flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
            >
              <RadioGroupItem
                value={condition.value}
                id={index === 0 ? "field-condition" : undefined}
              />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{condition.label}</span>
                <span className="text-muted-foreground text-xs">{condition.hint}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </FieldShell>

      <FieldShell
        slug="priceRupees"
        label="Asking price"
        required
        helpText="Buyers pay this. Circle's fees are shown before you confirm."
        error={errors.priceRupees}
        grouped={false}
      >
        <div className="relative">
          <span
            className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
            aria-hidden="true"
          >
            ₹
          </span>
          <Input
            id="field-priceRupees"
            // `inputMode` brings up the numeric keypad; `type="text"` keeps digit
            // grouping typeable, which `type="number"` rejects outright.
            type="text"
            inputMode="numeric"
            value={common.priceRupees}
            onChange={(event) => onChange("priceRupees", event.target.value)}
            placeholder="14500"
            className="pl-7"
            aria-describedby={describedBy("priceRupees", true, Boolean(errors.priceRupees))}
            aria-invalid={Boolean(errors.priceRupees) || undefined}
            aria-required
          />
        </div>
      </FieldShell>
    </div>
  )
}
