"use client"

/**
 * The last line of defence for a rendering failure.
 *
 * Without one, a page whose data never arrives sits on its loading skeleton indefinitely and
 * the person looking at it cannot tell "slow" from "broken". An error boundary turns an
 * invisible failure into a visible one with a way out, which matters more than what it says.
 *
 * The message is deliberately generic: `error.message` from a server component can carry a
 * connection string or a query, and neither belongs on a public page. The digest is the
 * handle for finding the real error in the logs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-20">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        This page could not be loaded. It is usually temporary — trying again often works.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="bg-primary text-primary-foreground hover:bg-primary/80 min-h-11 rounded-lg px-4 text-sm font-medium"
        >
          Try again
        </button>
        {/* A real anchor rather than next/link, on purpose: a soft navigation preserves the
            client router state that may itself be part of the failure. From an error
            boundary the safe move is a full page load. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="hover:bg-muted min-h-11 rounded-lg border px-4 text-sm leading-11 font-medium"
        >
          Back to listings
        </a>
      </div>
      {error.digest ? (
        <p className="text-muted-foreground/70 font-mono text-xs">Reference: {error.digest}</p>
      ) : null}
    </div>
  )
}
