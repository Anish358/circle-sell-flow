"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RENDER_OPTIONS, type FieldRenderAs, type FieldType } from "@/db/schema"
import { createField } from "@/lib/admin/actions/fields"
import { slugify } from "@/lib/slug"

/**
 * Creating a field.
 *
 * Three things this form deliberately does:
 *
 *  - **shows the derived key** as you type the label, because that key is permanent and is
 *    what every listing will store. Making it visible before creation is the only moment
 *    it can be reconsidered;
 *  - **offers only the presentations the chosen type permits**, from the same
 *    `RENDER_OPTIONS` table the database check constraint is built from — so an illegal
 *    pairing is unreachable rather than merely rejected;
 *  - **asks for options only for select types**, and for min/max only where they mean
 *    something.
 */

const TYPES: Array<{ value: FieldType; label: string; hint: string }> = [
  { value: "text", label: "Text", hint: "One line, e.g. a model name" },
  { value: "textarea", label: "Long text", hint: "Several lines" },
  { value: "number", label: "Number", hint: "With optional range and unit" },
  { value: "boolean", label: "Yes / no", hint: "A single fact" },
  { value: "date", label: "Date", hint: "A calendar date" },
  { value: "single_select", label: "Pick one", hint: "From a list you define" },
  { value: "multi_select", label: "Pick any", hint: "From a list you define" },
]

const RENDER_LABELS: Record<FieldRenderAs, string> = {
  input: "Input box",
  textarea: "Text area",
  date: "Date picker",
  switch: "Switch",
  radio: "Radio buttons",
  dropdown: "Dropdown",
  chips: "Chips",
  checkboxes: "Checkboxes",
  multiselect: "Multi-select",
}

const SELECT_TYPES: FieldType[] = ["single_select", "multi_select"]

export function CreateFieldForm() {
  const router = useRouter()

  const [label, setLabel] = useState("")
  const [type, setType] = useState<FieldType>("text")
  const [renderAs, setRenderAs] = useState<FieldRenderAs>("input")
  const [unit, setUnit] = useState("")
  const [min, setMin] = useState("")
  const [max, setMax] = useState("")
  const [helpText, setHelpText] = useState("")
  const [options, setOptions] = useState<string[]>([])
  const [optionDraft, setOptionDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const allowed = RENDER_OPTIONS[type]
  const needsOptions = SELECT_TYPES.includes(type)

  function chooseType(next: FieldType) {
    setType(next)
    // Keep the presentation only if the new type permits it; otherwise take its first.
    const permitted = RENDER_OPTIONS[next]
    setRenderAs(permitted.includes(renderAs) ? renderAs : (permitted[0] as FieldRenderAs))
    if (!SELECT_TYPES.includes(next)) setOptions([])
  }

  function addOption() {
    const value = optionDraft.trim()
    if (!value) return
    setOptions((current) => [...current, value])
    setOptionDraft("")
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await createField({
        label,
        type,
        renderAs,
        config: {
          ...(unit.trim() ? { unit: unit.trim() } : {}),
          ...(min.trim() ? { min: Number(min) } : {}),
          ...(max.trim() ? { max: Number(max) } : {}),
        },
        helpText,
        options: options.map((optionLabel) => ({ label: optionLabel })),
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      setLabel("")
      setOptions([])
      setUnit("")
      setMin("")
      setMax("")
      setHelpText("")
      router.refresh()
    })
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="field-label" className="text-xs">
          Label
        </Label>
        <Input
          id="field-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. Screen Size"
        />
        {label.trim().length >= 2 ? (
          <p className="text-muted-foreground text-xs">
            Stored permanently as <code className="text-foreground">{slugify(label)}</code>. The
            label can change later; this cannot.
          </p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="field-type" className="text-xs">
          Type
        </Label>
        <Select
          value={type}
          onValueChange={(value) => chooseType(value as FieldType)}
          items={TYPES.map((option) => ({ value: option.value, label: option.label }))}
        >
          <SelectTrigger id="field-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          {TYPES.find((option) => option.value === type)?.hint} · fixed once created
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="field-render" className="text-xs">
          Looks like
        </Label>
        <Select
          value={renderAs}
          onValueChange={(value) => setRenderAs(value as FieldRenderAs)}
          items={allowed.map((option) => ({ value: option, label: RENDER_LABELS[option] }))}
          disabled={allowed.length === 1}
        >
          <SelectTrigger id="field-render" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowed.map((option) => (
              <SelectItem key={option} value={option}>
                {RENDER_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {allowed.length > 1 ? (
          <p className="text-muted-foreground text-xs">
            Presentation only — changing it later never affects stored values.
          </p>
        ) : null}
      </div>

      {type === "number" ? (
        <div className="grid grid-cols-3 gap-2">
          <Field id="field-min" label="Min" value={min} onChange={setMin} placeholder="0" />
          <Field id="field-max" label="Max" value={max} onChange={setMax} placeholder="100" />
          <Field id="field-unit" label="Unit" value={unit} onChange={setUnit} placeholder="%" />
        </div>
      ) : null}

      {needsOptions ? (
        <div className="grid gap-2">
          <Label htmlFor="field-option" className="text-xs">
            Options
          </Label>
          <div className="flex gap-2">
            <Input
              id="field-option"
              value={optionDraft}
              onChange={(event) => setOptionDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  addOption()
                }
              }}
              placeholder="e.g. 128 GB"
            />
            <Button type="button" variant="outline" size="sm" onClick={addOption}>
              Add
            </Button>
          </div>
          {options.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {options.map((option, index) => (
                <li
                  key={`${option}-${index}`}
                  className="bg-muted flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                >
                  {option}
                  <button
                    type="button"
                    aria-label={`Remove ${option}`}
                    onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">
              A select field needs at least two options to be worth asking.
            </p>
          )}
        </div>
      ) : null}

      <Field
        id="field-help"
        label="Help text"
        value={helpText}
        onChange={setHelpText}
        placeholder="Shown under the field"
      />

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="sm"
        disabled={pending || label.trim().length < 2 || (needsOptions && options.length === 0)}
      >
        {pending ? "Creating…" : "Create field"}
      </Button>
    </form>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}
