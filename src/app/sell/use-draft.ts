"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { allFields, type AttributeValues, type FormSchema } from "@/lib/form-schema/types"
import { carryOverValues, initialValues } from "@/lib/form-schema/values"
import { emptyCommonDraft, type CommonDraft } from "@/lib/listings/input-schema"

/**
 * Keeps a half-finished listing safe across a refresh, a closed tab, or a mobile
 * browser that decided to reload the page on its own.
 *
 * Stored in `localStorage`, not on the server. That is a deliberate limit rather than
 * an oversight: it needs no round trip per keystroke, works offline, and cannot leak
 * one seller's draft to another. What it gives up is drafts that follow you between
 * devices — the natural next step, and one the API already supports, since
 * `POST /api/listings` with `publish: false` stores a draft row today.
 *
 * The stored payload records the `config_version` it was written against, so a draft
 * saved before an admin changed the category's form can be recognised rather than
 * silently replayed into a schema that no longer matches.
 */

const STORAGE_PREFIX = "circle:sell-draft:"

type StoredDraft = {
  configVersion: number
  categoryName: string
  common: CommonDraft
  attributes: AttributeValues
  /** Field labels, so a draft from another category can explain itself. */
  labels: Record<string, string>
  savedAt: string
}

export type Draft = {
  common: CommonDraft
  attributes: AttributeValues
  /** Set when a draft was restored from a previous visit. */
  restoredAt: string | null
  /** True when the restored draft was written against an older version of the form. */
  schemaMoved: boolean
  /** Set when answers were carried across from a different category. */
  carriedOver: CarryOver | null
}

export type CarryOver = {
  fromCategoryName: string
  /** Labels of the answers that came across. */
  kept: string[]
  /** Labels of the answers the new category does not collect. */
  dropped: string[]
}

function storageKey(categorySlug: string): string {
  return `${STORAGE_PREFIX}${categorySlug}`
}

function readStored(categorySlug: string): StoredDraft | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(storageKey(categorySlug))
    return raw ? (JSON.parse(raw) as StoredDraft) : null
  } catch {
    // A corrupt or half-written entry should cost the seller an empty form, not an
    // error page.
    return null
  }
}

/**
 * The form as the server renders it: configured defaults and nothing else.
 *
 * Must not touch `localStorage`. The server cannot see it, so a draft read during the
 * first render would make the server's HTML and the client's differ — a hydration
 * mismatch, which React resolves by throwing away the client tree. Restoring happens
 * after mount instead.
 */
function pristine(schema: FormSchema): Draft {
  return {
    common: emptyCommonDraft,
    attributes: initialValues(schema),
    restoredAt: null,
    schemaMoved: false,
    carriedOver: null,
  }
}

/** The draft to restore after mount, or null when there is nothing to restore. */
function read(schema: FormSchema): Draft | null {
  const fields = allFields(schema)

  if (typeof window === "undefined") return null

  const stored = readStored(schema.category.slug)

  if (stored) {
    return {
      // Defaults first, so a field added since the draft was saved still gets its
      // configured default rather than being left blank.
      common: { ...emptyCommonDraft, ...stored.common },
      attributes: { ...initialValues(schema), ...stored.attributes },
      restoredAt: stored.savedAt ?? null,
      schemaMoved: stored.configVersion !== schema.configVersion,
      carriedOver: null,
    }
  }

  // No draft here yet, so this may be a category switch. Carry across whatever the
  // new category also collects.
  const source = mostRecentOtherDraft(schema.category.slug)
  if (!source) return null

  const { kept, dropped } = carryOverValues(source.attributes, schema)
  if (Object.keys(kept).length === 0) return null

  const labelFor = (slug: string) =>
    fields.find((field) => field.slug === slug)?.label ?? source.labels[slug] ?? slug

  return {
    common: { ...emptyCommonDraft, ...source.common },
    attributes: { ...initialValues(schema), ...kept },
    restoredAt: null,
    schemaMoved: false,
    carriedOver: {
      fromCategoryName: source.categoryName,
      kept: Object.keys(kept).map(labelFor),
      dropped: dropped.map((slug) => source.labels[slug] ?? slug),
    },
  }
}

/**
 * The most recently saved draft for any *other* category.
 *
 * This is what makes a category switch keep its answers: fields are a shared library,
 * so an answer to RAM is meaningful in every category that assigns RAM. It is one
 * field, not two coincidentally similar ones — which is why this falls out of the
 * data model rather than needing name matching.
 */
function mostRecentOtherDraft(exceptCategory: string): StoredDraft | null {
  if (typeof window === "undefined") return null

  let best: StoredDraft | null = null

  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index)
    if (!key?.startsWith(STORAGE_PREFIX) || key === storageKey(exceptCategory)) continue

    try {
      const candidate = JSON.parse(window.localStorage.getItem(key) ?? "") as StoredDraft
      if (!candidate?.savedAt) continue
      if (!best || candidate.savedAt > best.savedAt) best = candidate
    } catch {
      continue
    }
  }

  return best
}

export function useDraft(schema: FormSchema) {
  const [draft, setDraft] = useState<Draft>(() => pristine(schema))

  // Avoids writing an untouched draft back to storage on mount.
  const dirty = useRef(false)

  /**
   * Restore after hydration, for the reason given on `pristine`. Effects run
   * immediately after mount, so in practice this lands before anyone can type.
   *
   * `set-state-in-effect` is disabled deliberately rather than worked around. The rule
   * exists to catch state derived from props, which should be computed during render
   * instead. This is the opposite case: the source is `localStorage`, which the server
   * cannot read, so seeding during render is exactly what produces the hydration
   * mismatch this replaced. The alternative — rendering the form client-only — would
   * cost first paint on a slow connection to satisfy a lint rule.
   */
  useEffect(() => {
    const restored = read(schema)
    // Restoring is not an edit, so `dirty` stays false and this does not trigger a
    // pointless write straight back to storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (restored) setDraft(restored)
  }, [schema])

  useEffect(() => {
    if (!dirty.current || typeof window === "undefined") return

    const payload: StoredDraft = {
      configVersion: schema.configVersion,
      categoryName: schema.category.name,
      common: draft.common,
      attributes: draft.attributes,
      // Stored so a draft carried into another category can name what it is dropping.
      labels: Object.fromEntries(allFields(schema).map((field) => [field.slug, field.label])),
      savedAt: new Date().toISOString(),
    }

    try {
      window.localStorage.setItem(storageKey(schema.category.slug), JSON.stringify(payload))
    } catch {
      // Private browsing and full quotas both throw here. Losing autosave is
      // acceptable; breaking the form is not.
    }
    // `schema` in full, because the label map is derived from all of its fields.
  }, [draft, schema])

  const setCommon = useCallback(<K extends keyof CommonDraft>(key: K, value: CommonDraft[K]) => {
    dirty.current = true
    setDraft((current) => ({ ...current, common: { ...current.common, [key]: value } }))
  }, [])

  const setAttribute = useCallback((slug: string, value: unknown) => {
    dirty.current = true
    setDraft((current) => ({ ...current, attributes: { ...current.attributes, [slug]: value } }))
  }, [])

  const clear = useCallback(() => {
    dirty.current = false
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey(schema.category.slug))
    }
  }, [schema.category.slug])

  /** Dismisses the restore or carry-over notice without discarding the values. */
  const acknowledgeNotice = useCallback(() => {
    setDraft((current) => ({
      ...current,
      restoredAt: null,
      schemaMoved: false,
      carriedOver: null,
    }))
  }, [])

  return { draft, setCommon, setAttribute, clear, acknowledgeNotice }
}
