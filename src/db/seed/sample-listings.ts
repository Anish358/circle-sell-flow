import type { ListingCondition, ListingStatus } from "@/db/schema"

/**
 * Illustrative listings, so the homepage and product pages have something honest
 * to render. Nothing here is a real item or a real seller.
 *
 * Note what `attributes` looks like: keys are field slugs, values are natively
 * typed JSON, and a listing only carries the fields its category resolved. The
 * handset rows have no `processor` key and the sofas have no `battery-health`
 * key — not null, absent.
 */

type SeedUser = { email: string; name: string; role: "seller" | "admin" }

type SeedListing = {
  slug: string
  category: string
  /** Email of the owning seller. */
  seller: string
  title: string
  description: string
  /** Rupees. Converted to paise on insert — money is never stored as a float. */
  priceRupees: number
  condition: ListingCondition
  city: string
  status: ListingStatus
  attributes: Record<string, unknown>
}

export const USERS: SeedUser[] = [
  { email: "admin@circle.example", name: "Circle Admin", role: "admin" },
  { email: "priya@example.com", name: "Priya Nair", role: "seller" },
  { email: "rahul@example.com", name: "Rahul Menon", role: "seller" },
]

/** The admin account the demo logs in as. */
export const ADMIN_EMAIL = "admin@circle.example"

export const LISTINGS: SeedListing[] = [
  {
    slug: "apple-iphone-13-128gb-midnight",
    category: "mobile-phone",
    seller: "priya@example.com",
    title: "iPhone 13 128GB, battery at 89%",
    description:
      "Used as a primary phone for two years. Screen has no scratches; there is a small scuff on the bottom-left corner from a drop.\n\nSelling because I upgraded.",
    priceRupees: 32_999,
    condition: "good",
    city: "Bengaluru",
    status: "active",
    attributes: {
      brand: "apple",
      model: "iPhone 13",
      colour: "Midnight",
      storage: "128gb",
      ram: "4gb",
      "battery-health": 89,
      "original-box": true,
      accessories: ["charger", "cable"],
      "purchase-date": "2023-09-15",
      "under-warranty": false,
      "known-issues": "Small scuff on the bottom-left corner. Does not affect the screen.",
    },
  },
  {
    slug: "samsung-galaxy-s22-256gb-green",
    category: "mobile-phone",
    seller: "rahul@example.com",
    title: "Samsung Galaxy S22 256GB, still under warranty",
    description: "Bought last year, barely used as I switched to a work-issued phone.",
    priceRupees: 41_500,
    condition: "like_new",
    city: "Bengaluru",
    status: "active",
    attributes: {
      brand: "samsung",
      model: "Galaxy S22",
      colour: "Green",
      storage: "256gb",
      ram: "8gb",
      "battery-health": 96,
      "original-box": true,
      accessories: ["charger", "cable", "case", "bill"],
      "purchase-date": "2025-02-10",
      // The conditional pair: warranty is on, so an expiry date exists.
      "under-warranty": true,
      "warranty-expiry": "2027-02-10",
    },
  },
  {
    slug: "oneplus-11r-128gb-black",
    category: "mobile-phone",
    seller: "priya@example.com",
    title: "OnePlus 11R 128GB",
    description: "Reliable daily driver. Battery has held up well.",
    priceRupees: 24_000,
    condition: "good",
    city: "Pune",
    status: "active",
    attributes: {
      brand: "oneplus",
      model: "11R",
      colour: "Sierra Black",
      storage: "128gb",
      ram: "8gb",
      "battery-health": 91,
      "original-box": false,
      accessories: ["charger"],
      "purchase-date": "2024-04-02",
      "under-warranty": false,
    },
  },
  {
    slug: "apple-macbook-air-m2-16gb-512gb",
    category: "laptop",
    seller: "rahul@example.com",
    title: "MacBook Air M2, 16GB / 512GB",
    description: "Development machine for 18 months. Cared for, always in a sleeve.",
    priceRupees: 86_000,
    condition: "excellent",
    city: "Bengaluru",
    status: "active",
    attributes: {
      brand: "apple",
      model: "MacBook Air M2",
      colour: "Space Grey",
      processor: "apple-m2",
      ram: "16gb",
      storage: "512gb",
      "graphics-card": "integrated",
      // Optional for this category, and supplied anyway.
      "battery-health": 92,
      ports: ["usb-c", "thunderbolt", "headphone-jack"],
      "purchase-date": "2024-01-20",
      "under-warranty": false,
    },
  },
  {
    slug: "dell-xps-13-i7-16gb",
    category: "laptop",
    seller: "priya@example.com",
    title: "Dell XPS 13, i7 / 16GB",
    description: "Light and quick. Keyboard shows a little shine on the most-used keys.",
    priceRupees: 58_000,
    condition: "good",
    city: "Hyderabad",
    status: "active",
    attributes: {
      brand: "dell",
      model: "XPS 13 9310",
      processor: "intel-core-i7",
      ram: "16gb",
      storage: "512gb",
      "graphics-card": "integrated",
      ports: ["usb-c", "thunderbolt", "headphone-jack"],
      "purchase-date": "2022-11-05",
      "under-warranty": false,
      "known-issues": "Keyboard shine on the most-used keys. Everything works.",
    },
  },
  {
    slug: "asus-tuf-gaming-rtx-4060",
    category: "laptop",
    seller: "rahul@example.com",
    title: "ASUS TUF Gaming with RTX 4060",
    description: "Bought for a project that ended. Under warranty until 2027.",
    priceRupees: 94_000,
    condition: "like_new",
    city: "Bengaluru",
    status: "active",
    attributes: {
      brand: "asus",
      model: "TUF Gaming F15",
      processor: "intel-core-i7",
      ram: "32gb",
      storage: "1tb",
      "graphics-card": "nvidia-rtx-4060",
      ports: ["usb-a", "usb-c", "hdmi", "ethernet", "headphone-jack"],
      "purchase-date": "2025-03-18",
      "under-warranty": true,
      "warranty-expiry": "2027-03-18",
    },
  },
  {
    slug: "three-seater-fabric-sofa-grey",
    category: "sofa",
    seller: "priya@example.com",
    title: "Three-seater fabric sofa, grey",
    description: "Comfortable and firm, from a smoke-free home. Moving cities, so it has to go.",
    priceRupees: 14_500,
    condition: "good",
    city: "Bengaluru",
    status: "active",
    attributes: {
      material: "fabric",
      "seating-capacity": 3,
      "cushion-firmness": "firm",
      "pet-friendly": false,
      // Three independent numbers in one group, not a single composite value.
      "length-cm": 198,
      "width-cm": 88,
      "height-cm": 84,
      "purchase-date": "2022-06-12",
      "known-issues": "Slight fading on the arm that faced the window.",
    },
  },
  {
    slug: "two-seater-leather-recliner",
    category: "sofa",
    seller: "rahul@example.com",
    title: "Two-seater leather recliner",
    description: "Both recliners work smoothly. Genuine leather, easy to wipe clean.",
    priceRupees: 22_000,
    condition: "excellent",
    city: "Mumbai",
    status: "active",
    attributes: {
      material: "leather",
      "seating-capacity": 2,
      "cushion-firmness": "medium",
      "pet-friendly": true,
      "length-cm": 150,
      "width-cm": 95,
      "height-cm": 102,
      "purchase-date": "2023-08-01",
    },
  },
  {
    slug: "xiaomi-redmi-note-13-draft",
    category: "mobile-phone",
    seller: "priya@example.com",
    title: "Redmi Note 13 — still writing this up",
    description: "Draft listing, not yet published.",
    priceRupees: 11_000,
    condition: "fair",
    city: "Pune",
    // A draft: it exists, it stays off the homepage, and it is deliberately
    // incomplete — `model` is required for this category and has not been filled
    // in yet. Drafts save without passing full validation; only publishing
    // demands it.
    status: "draft",
    attributes: {
      brand: "xiaomi",
      storage: "128gb",
      ram: "6gb",
      "battery-health": 84,
      "purchase-date": "2024-08-30",
      "under-warranty": false,
    },
  },
]
