import type { Metadata } from "next"
import { Geist } from "next/font/google"

import { SiteHeader } from "@/components/site-header"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"
import "./globals.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

export const metadata: Metadata = {
  title: {
    default: "Circle — buy and sell pre-owned",
    template: "%s · Circle",
  },
  description:
    "A category-driven marketplace where new product categories and their fields are configured, not coded.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans antialiased", geist.variable)}>
      {/* Browser extensions add their own attributes to `body` before React hydrates —
          ColorZilla's `cz-shortcut-listen`, password managers, and so on — and React
          reports the resulting mismatch as a hydration error, which in development is a
          full-screen overlay on first load. Nothing is wrong, and nothing we ship can
          stop an extension editing the document.

          This suppresses attribute mismatches on this one element only; it is not
          inherited, so a genuine mismatch anywhere inside the tree is still reported. */}
      <body
        suppressHydrationWarning
        className="bg-background text-foreground flex min-h-dvh flex-col"
      >
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <Toaster />
      </body>
    </html>
  )
}
