import { ImageIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A listing's image, or a stand-in when it has none.
 *
 * Photo *uploads* are not built — see the README's known gaps — so in practice this
 * renders the fallback. It is deliberately a designed empty state rather than a broken
 * image or a grey box: a grid of missing images reads as a broken page, while a grid of
 * consistent placeholders reads as a marketplace waiting for photos.
 *
 * The tint is derived from the listing's slug, so a given listing always looks the same
 * and a grid of them looks varied rather than striped.
 */
export function ListingImage({
  image,
  seed,
  className,
}: {
  image: { url: string; alt: string | null } | null
  /** Anything stable per listing; the slug is ideal. */
  seed: string
  className?: string
}) {
  if (image) {
    return (
      // A plain <img> rather than next/image: these URLs are seller-supplied and of
      // unknown origin, and next/image requires every host to be allow-listed in the
      // config up front — which cannot be done for arbitrary user input. Once uploads
      // land and images are served from one known bucket, this should become
      // next/image for the optimisation the warning is pointing at.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image.url}
        alt={image.alt ?? ""}
        loading="lazy"
        className={cn("bg-muted h-full w-full object-cover", className)}
      />
    )
  }

  return (
    <div
      className={cn("text-muted-foreground/40 flex items-center justify-center border", className)}
      style={{ backgroundColor: `oklch(0.95 0.03 ${hueFrom(seed)})` }}
      // Decorative: the listing's title is already the accessible name of the link
      // this sits inside, so announcing "no image" adds noise for a screen reader.
      aria-hidden="true"
    >
      <ImageIcon className="size-6" />
    </div>
  )
}

/** A stable hue in [0, 360) from a string. */
function hueFrom(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360
  }
  return hash
}
