"use client"

import { useState } from "react"

import { DynamicForm } from "@/components/form/dynamic-form"
import type { AttributeValues, FormSchema } from "@/lib/form-schema/types"
import { initialValues } from "@/lib/form-schema/values"

/**
 * Owns the answers while the seller is filling them in.
 *
 * Deliberately thin: state and nothing else. Submission, draft persistence and
 * validation arrive in later steps, and none of them belong to the renderer.
 */
export function AttributeForm({ schema }: { schema: FormSchema }) {
  const [values, setValues] = useState<AttributeValues>(() => initialValues(schema))

  return (
    <DynamicForm
      schema={schema}
      values={values}
      onChange={(slug, value) => setValues((current) => ({ ...current, [slug]: value }))}
    />
  )
}
