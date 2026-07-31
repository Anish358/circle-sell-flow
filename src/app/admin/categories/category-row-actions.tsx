"use client"

import { useTransition } from "react"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { moveCategory, setCategoryActive } from "@/lib/admin/actions/categories"

/**
 * Reordering and activation, inline on each row.
 *
 * Up/down buttons rather than drag-and-drop. Two admins dragging at once is a lost-update
 * race needing fractional ranking or a full sibling rewrite, and a pair of buttons is
 * operable by keyboard and screen reader without any of that. The trade-off is worse for
 * reordering forty items at once, which is not a thing anyone does to a category tree.
 */
export function CategoryRowActions({
  id,
  name,
  isActive,
  hasChildren,
}: {
  id: number
  name: string
  isActive: boolean
  hasChildren: boolean
}) {
  const [pending, startTransition] = useTransition()

  return (
    <span className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${name} up`}
        disabled={pending}
        onClick={() => startTransition(() => void moveCategory({ id, direction: "up" }))}
      >
        <ChevronUpIcon className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${name} down`}
        disabled={pending}
        onClick={() => startTransition(() => void moveCategory({ id, direction: "down" }))}
      >
        <ChevronDownIcon className="size-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="text-xs"
        disabled={pending}
        onClick={() => {
          // Deactivating hides a category from sellers; its listings stay live and its
          // children keep inheriting from it. Worth saying out loud before it happens,
          // because "deactivate" sounds more destructive than it is.
          if (
            isActive &&
            !window.confirm(
              `Hide "${name}" from the sell flow?\n\nExisting listings stay live and nothing is deleted.${
                hasChildren ? " Categories inside it keep inheriting its fields." : ""
              }\n\nYou can turn it back on at any time.`,
            )
          ) {
            return
          }
          startTransition(() => void setCategoryActive({ id, isActive: !isActive }))
        }}
      >
        {isActive ? "Deactivate" : "Activate"}
      </Button>
    </span>
  )
}
