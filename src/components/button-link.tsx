import Link from "next/link"

import { Button } from "@/components/ui/button"

/**
 * A link that looks like a button.
 *
 * Exists so `nativeButton={false}` is passed exactly once. Base UI's Button assumes it
 * renders a real `<button>`, and silently loses native button semantics — and warns —
 * when handed an anchor instead. That is easy to forget at each call site and
 * impossible to forget here.
 *
 * Deliberately a link, not a button with an onClick: navigation should be
 * middle-clickable, openable in a new tab, and visible to a screen reader as a link.
 */
export function ButtonLink({
  href,
  children,
  ...props
}: { href: string } & Omit<React.ComponentProps<typeof Button>, "render" | "nativeButton">) {
  return <Button {...props} nativeButton={false} render={<Link href={href}>{children}</Link>} />
}
