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
  /**
   * What the hub measured, keyed by the same slugs. Present only on listings that
   * have been through a hub, and deliberately disagreeing with the seller on a couple
   * of fields — an agreeing verification proves nothing about the interface.
   */
  verifiedAttributes?: Record<string, unknown>
  /** ISO date the hub checked it. Ignored unless `verifiedAttributes` is set. */
  verifiedOn?: string
  /**
   * Photos, in display order — the first is the primary one.
   *
   * Line-art SVGs served from `public/sample`, not photographs. There is no upload path
   * (a stated gap), and inventing product photography would dress the demo up as
   * something it is not. Most listings deliberately have none, because the designed
   * "no photo yet" state is a real state on a marketplace and worth seeing.
   */
  images?: Array<{ url: string; alt: string }>
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
    // The only listing with more than one photo, so the gallery's thumbnail row is
    // exercised by the sample data rather than only by a code path nobody runs.
    images: [
      { url: "/handset.svg", alt: "Front of the handset, screen on" },
      { url: "/handset-back.svg", alt: "Back of the handset, showing the cameras" },
    ],
    // Checked at a hub, and the hub disagreed: the seller read 89% off the phone at
    // some point and the battery has aged since, and the charger in the box is
    // third-party. Both numbers are kept and the product page shows the difference.
    verifiedAttributes: {
      storage: "128gb",
      ram: "4gb",
      "battery-health": 86,
      "original-box": true,
      accessories: ["cable"],
    },
    verifiedOn: "2026-07-24",
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
    // A verification that agrees with the seller on everything it checked, and left
    // the accessories unchecked. Partial is normal: the badge means "we looked", not
    // "we looked at all of it".
    verifiedAttributes: {
      storage: "256gb",
      ram: "8gb",
      "battery-health": 96,
      "original-box": true,
    },
    verifiedOn: "2026-07-28",
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
    images: [{ url: "/laptop.svg", alt: "Laptop open on a desk" }],
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
    // Measured with a tape rather than remembered: 6 cm longer than the seller thought,
    // which is the difference between fitting through a doorway and not.
    verifiedAttributes: {
      material: "fabric",
      "length-cm": 204,
    },
    verifiedOn: "2026-07-30",
    images: [{ url: "/sofa.svg", alt: "Three-seater sofa, viewed from the front" }],
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
  // ── Enough of a catalogue that browse and the filters have something to do ──
  // Spread across every leaf, every condition and several cities, and chosen so each
  // facet actually partitions the set: three storage tiers, four RAM sizes, battery
  // health from 78 to 100, both sofa materials, and pet-friendly on both sides.
  {
    slug: "google-pixel-7a-128gb-charcoal",
    category: "mobile-phone",
    seller: "rahul@example.com",
    title: "Pixel 7a 128GB, charcoal",
    description: "Great camera, stock Android. Screen protector on since day one.",
    priceRupees: 19_500,
    condition: "excellent",
    city: "Chennai",
    status: "active",
    attributes: {
      brand: "google",
      model: "Pixel 7a",
      colour: "Charcoal",
      storage: "128gb",
      ram: "8gb",
      "battery-health": 94,
      "original-box": true,
      accessories: ["cable", "case"],
      "purchase-date": "2024-11-11",
      "under-warranty": false,
    },
    images: [{ url: "/handset.svg", alt: "Front of the handset" }],
  },
  {
    slug: "nothing-phone-2-256gb-white",
    category: "mobile-phone",
    seller: "priya@example.com",
    title: "Nothing Phone (2) 256GB, white",
    description: "Bought on release. Everything works; the glass back has a hairline mark.",
    priceRupees: 27_000,
    condition: "good",
    city: "Bengaluru",
    status: "active",
    attributes: {
      brand: "nothing",
      model: "Phone (2)",
      colour: "White",
      storage: "256gb",
      ram: "12gb",
      "battery-health": 88,
      "original-box": true,
      accessories: ["charger", "cable"],
      "purchase-date": "2023-12-02",
      "under-warranty": false,
      "known-issues": "Hairline mark on the glass back, not visible in a case.",
    },
  },
  {
    slug: "apple-iphone-15-256gb-blue",
    category: "mobile-phone",
    seller: "rahul@example.com",
    title: "iPhone 15 256GB, blue — sealed spare",
    description: "Won it in a company raffle and already have a phone. Never opened.",
    priceRupees: 61_000,
    condition: "new",
    city: "Mumbai",
    status: "active",
    attributes: {
      brand: "apple",
      model: "iPhone 15",
      colour: "Blue",
      storage: "256gb",
      ram: "6gb",
      "battery-health": 100,
      "original-box": true,
      accessories: ["cable", "bill"],
      "purchase-date": "2025-06-20",
      "under-warranty": true,
      "warranty-expiry": "2026-06-20",
    },
    // A hub can open a "sealed" box; that is rather the point of the hub. It matched.
    verifiedAttributes: {
      storage: "256gb",
      "battery-health": 100,
      "original-box": true,
      accessories: ["cable", "bill"],
    },
    verifiedOn: "2026-07-31",
  },
  {
    slug: "lenovo-thinkpad-t14-i5-16gb",
    category: "laptop",
    seller: "priya@example.com",
    title: "ThinkPad T14, i5 / 16GB",
    description: "Ex-work machine, wiped and reinstalled. The keyboard is the reason to buy it.",
    priceRupees: 39_000,
    condition: "fair",
    city: "Pune",
    status: "active",
    attributes: {
      brand: "lenovo",
      model: "ThinkPad T14 Gen 2",
      processor: "intel-core-i5",
      ram: "16gb",
      storage: "512gb",
      "graphics-card": "integrated",
      "battery-health": 78,
      ports: ["usb-a", "usb-c", "hdmi", "ethernet", "headphone-jack"],
      "purchase-date": "2021-07-19",
      "under-warranty": false,
      "known-issues": "Battery holds about three hours now. Lid has workplace asset stickers.",
    },
  },
  {
    slug: "hp-pavilion-14-ryzen-8gb",
    category: "laptop",
    seller: "rahul@example.com",
    title: "HP Pavilion 14, Ryzen 5 / 8GB",
    description: "First laptop, used for coursework. Upgrading for a new job.",
    priceRupees: 27_500,
    condition: "good",
    city: "Hyderabad",
    status: "active",
    attributes: {
      brand: "hp",
      model: "Pavilion 14-ec1",
      processor: "amd-ryzen-5",
      ram: "8gb",
      storage: "512gb",
      "graphics-card": "integrated",
      ports: ["usb-a", "usb-c", "hdmi", "sd-card", "headphone-jack"],
      "purchase-date": "2022-08-14",
      "under-warranty": false,
    },
  },
  {
    slug: "cane-two-seater-with-cushions",
    category: "sofa",
    seller: "priya@example.com",
    title: "Cane two-seater with cushions",
    description: "Light enough to move alone. Cushion covers are washable and go with it.",
    priceRupees: 9_800,
    condition: "good",
    city: "Chennai",
    status: "active",
    attributes: {
      material: "cane",
      "seating-capacity": 2,
      "cushion-firmness": "soft",
      "pet-friendly": true,
      "length-cm": 142,
      "width-cm": 74,
      "height-cm": 86,
      "purchase-date": "2021-11-30",
    },
    images: [{ url: "/sofa.svg", alt: "Two-seater cane sofa with cushions" }],
  },
  {
    slug: "velvet-four-seater-emerald",
    category: "sofa",
    seller: "rahul@example.com",
    title: "Velvet four-seater, emerald",
    description: "Bought for a flat we have now left. Deep and very comfortable.",
    priceRupees: 34_000,
    condition: "like_new",
    city: "Mumbai",
    status: "active",
    attributes: {
      material: "velvet",
      "seating-capacity": 4,
      "cushion-firmness": "soft",
      "pet-friendly": false,
      "length-cm": 246,
      "width-cm": 96,
      "height-cm": 88,
      "purchase-date": "2024-05-05",
      "known-issues": "One cushion cover has a small pull in the pile.",
    },
    // Measured because "will it fit" is the question a photo cannot answer, and the
    // seller's memory was two centimetres out.
    verifiedAttributes: {
      material: "velvet",
      "length-cm": 248,
    },
    verifiedOn: "2026-07-29",
  },
  {
    slug: "leather-recliner-single-tan",
    category: "sofa",
    seller: "priya@example.com",
    title: "Single leather recliner, tan",
    description: "The reading chair. Reclines smoothly, leather has softened nicely.",
    priceRupees: 12_500,
    condition: "excellent",
    city: "Bengaluru",
    // Sold, so it stays off browse but its page still resolves — the state a shared
    // link lands on most often.
    status: "sold",
    attributes: {
      material: "leather",
      "seating-capacity": 1,
      "cushion-firmness": "medium",
      "pet-friendly": true,
      "length-cm": 88,
      "width-cm": 92,
      "height-cm": 104,
      "purchase-date": "2022-02-18",
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
