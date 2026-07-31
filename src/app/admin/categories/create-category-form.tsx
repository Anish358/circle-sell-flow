"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

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
import { createCategory } from "@/lib/admin/actions/categories"

const NO_PARENT = "__root__"

export function CreateCategoryForm({ parents }: { parents: Array<{ id: number; label: string }> }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [parent, setParent] = useState<string>(NO_PARENT)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await createCategory({
        name,
        parentId: parent === NO_PARENT ? null : Number(parent),
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      setName("")
      // Straight into the new category's editor: creating one is never the goal, and
      // assigning its fields is the next thing anyone wants to do.
      router.push(`/admin/categories/${result.data.slug}`)
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
        <Label htmlFor="new-category-name" className="text-xs">
          Name
        </Label>
        <Input
          id="new-category-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name sellers will see"
          aria-invalid={Boolean(error) || undefined}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="new-category-parent" className="text-xs">
          Inside
        </Label>
        <Select
          value={parent}
          onValueChange={(value) => setParent(String(value))}
          items={[
            { value: NO_PARENT, label: "Nothing — a new top level" },
            ...parents.map((option) => ({ value: String(option.id), label: option.label })),
          ]}
        >
          <SelectTrigger id="new-category-parent" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PARENT}>Nothing — a new top level</SelectItem>
            {parents.map((option) => (
              <SelectItem key={option.id} value={String(option.id)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="sm" disabled={pending || name.trim().length < 2}>
        {pending ? "Creating…" : "Create category"}
      </Button>
    </form>
  )
}
