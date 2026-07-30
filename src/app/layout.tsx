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
      <body className="bg-background text-foreground flex min-h-dvh flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <Toaster />
      </body>
    </html>
  )
}
