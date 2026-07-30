/**
 * Slug generation.
 *
 * Slugs are constrained by the database to `^[a-z0-9]+(-[a-z0-9]+)*$`, so anything
 * outside that — including the emoji, currency symbols and Devanagari that sellers
 * genuinely put in titles — has to be removed here rather than escaped downstream.
 */

/** Six base-36 characters: enough that a collision needs a retry, not a plan. */
export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    // Decompose accents so "café" becomes "cafe" rather than losing the vowel.
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    // Truncating above can leave a trailing hyphen, which the check constraint rejects.
    .replace(/-+$/g, "")

  // A title of nothing but emoji leaves an empty string, which is not a legal slug.
  return slug || `listing-${randomSuffix()}`
}
