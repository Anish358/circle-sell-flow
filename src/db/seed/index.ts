import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "@/db/schema"
import { env } from "@/lib/env"
import { ASSIGNMENTS, CATEGORIES, FIELDS, FIELD_GROUPS } from "./registry"
import { ADMIN_EMAIL, LISTINGS, USERS } from "./sample-listings"

/**
 * Loads the sample registry and listings.
 *
 * **Destructive and re-runnable**: it truncates every table first, so the demo
 * database always ends in the same known state.
 *
 * Everything it does is an INSERT. There is no DDL, because adding a category or
 * a field is data — which is the entire claim the project is making.
 *
 * Owns its connection rather than sharing the app's: bulk administrative work
 * belongs on a session-mode connection, for the same reason migrations do.
 */
const client = postgres(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, { max: 1 })
const db = drizzle(client, { schema })

/** Turns rows returned with their slug into a slug → id lookup. */
function byslug<T>(rows: Array<{ slug: string; id: T }>): Map<string, T> {
  return new Map(rows.map((row) => [row.slug, row.id]))
}

/** Reads a required id out of a lookup, failing loudly on a typo in the data. */
function idFor<T>(map: Map<string, T>, slug: string, kind: string): T {
  const id = map.get(slug)
  if (id === undefined) throw new Error(`Seed references unknown ${kind}: "${slug}"`)
  return id
}

async function seed() {
  await db.transaction(async (tx) => {
    // Fail rather than queue.
    //
    // TRUNCATE takes an ACCESS EXCLUSIVE lock, and Postgres's lock queue is FIFO: while
    // this statement waits for a reader to finish, every *later* reader waits behind it.
    // Run against a database that is serving traffic, a seed that blocks for a minute
    // therefore takes the whole site down with it, which is a spectacular amount of
    // damage for a script whose job is to load sample data.
    //
    // Three seconds, then give up and say so. Re-running a seed is free; an outage is not.
    await tx.execute(sql`SET LOCAL lock_timeout = '3s'`)

    // Truncate rather than upsert: a demo database is disposable, and an
    // idempotent seed is one less thing to reason about.
    await tx.execute(sql`
      TRUNCATE TABLE
        audit_log, listing_images, listings,
        category_fields, field_options, fields, field_groups, categories, users
      RESTART IDENTITY CASCADE
    `)

    // ── Users ──────────────────────────────────────────────────────────────
    const insertedUsers = await tx
      .insert(schema.users)
      .values(USERS)
      .returning({ id: schema.users.id, slug: schema.users.email })
    const userIds = byslug(insertedUsers)

    // ── Categories ─────────────────────────────────────────────────────────
    // One at a time, because each row may reference one already inserted.
    // CATEGORIES is ordered parents-first for exactly this reason.
    const categoryIds = new Map<string, number>()
    for (const category of CATEGORIES) {
      const [row] = await tx
        .insert(schema.categories)
        .values({
          slug: category.slug,
          name: category.name,
          sort: category.sort,
          parentId: category.parent ? idFor(categoryIds, category.parent, "category") : null,
        })
        .returning({ id: schema.categories.id })
      if (!row) throw new Error(`Failed to insert category "${category.slug}"`)
      categoryIds.set(category.slug, row.id)
    }

    // ── Field groups ───────────────────────────────────────────────────────
    const groupIds = byslug(
      await tx
        .insert(schema.fieldGroups)
        .values(FIELD_GROUPS)
        .returning({ id: schema.fieldGroups.id, slug: schema.fieldGroups.slug }),
    )

    // ── Fields, then their options ─────────────────────────────────────────
    const fieldIds = byslug(
      await tx
        .insert(schema.fields)
        .values(
          FIELDS.map((field) => ({
            slug: field.slug,
            label: field.label,
            type: field.type,
            renderAs: field.renderAs,
            config: field.config ?? {},
            placeholder: field.placeholder,
            helpText: field.helpText,
          })),
        )
        .returning({ id: schema.fields.id, slug: schema.fields.slug }),
    )

    const options = FIELDS.flatMap((field) =>
      (field.options ?? []).map((option, index) => ({
        fieldId: idFor(fieldIds, field.slug, "field"),
        valueSlug: option.slug,
        label: option.label,
        sort: (index + 1) * 10,
      })),
    )
    if (options.length > 0) await tx.insert(schema.fieldOptions).values(options)

    // ── Assignments ────────────────────────────────────────────────────────
    // Inserting these bumps every affected category's config_version, and its
    // descendants' too, via the trigger from migration 0002.
    await tx.insert(schema.categoryFields).values(
      ASSIGNMENTS.map((assignment) => ({
        categoryId: idFor(categoryIds, assignment.category, "category"),
        fieldId: idFor(fieldIds, assignment.field, "field"),
        groupId: assignment.group ? idFor(groupIds, assignment.group, "field group") : null,
        required: assignment.required ?? false,
        sort: assignment.sort,
        filterable: assignment.filterable ?? false,
        prominent: assignment.prominent ?? false,
        verifiable: assignment.verifiable ?? false,
        defaultValue: assignment.defaultValue,
        visibleWhen: assignment.visibleWhen,
        helpText: assignment.helpText,
      })),
    )

    // ── Listings ───────────────────────────────────────────────────────────
    // Read config_version *now*, after the assignments settled, so each listing
    // records the schema version its seller actually answered.
    const versions = new Map(
      (
        await tx
          .select({ slug: schema.categories.slug, version: schema.categories.configVersion })
          .from(schema.categories)
      ).map((row) => [row.slug, row.version]),
    )

    // The hub inspector, for the sample verifications. Provenance is a foreign key,
    // not a label — the database refuses a verified value that cannot name who
    // recorded it.
    const verifierId = idFor(userIds, ADMIN_EMAIL, "user")

    await tx.insert(schema.listings).values(
      LISTINGS.map((listing) => ({
        slug: listing.slug,
        categoryId: idFor(categoryIds, listing.category, "category"),
        sellerId: idFor(userIds, listing.seller, "user"),
        title: listing.title,
        description: listing.description,
        // Rupees to paise: integer minor units, decided once, here.
        pricePaise: listing.priceRupees * 100,
        condition: listing.condition,
        city: listing.city,
        status: listing.status,
        attributes: listing.attributes,
        verifiedAttributes: listing.verifiedAttributes ?? {},
        verifiedAt: listing.verifiedAttributes
          ? new Date(`${listing.verifiedOn}T11:00:00+05:30`)
          : null,
        verifiedBy: listing.verifiedAttributes ? verifierId : null,
        schemaVersion: versions.get(listing.category) ?? 1,
      })),
    )
  })

  await report()
}

/**
 * Prints the two facts that make the design legible at a glance: how much of each
 * category's form is inherited rather than declared, and which fields are shared.
 */
async function report() {
  const shared = await db
    .select({
      slug: schema.fields.slug,
      label: schema.fields.label,
      categories: sql<number>`count(*)::int`,
    })
    .from(schema.categoryFields)
    .innerJoin(schema.fields, eq(schema.fields.id, schema.categoryFields.fieldId))
    .groupBy(schema.fields.slug, schema.fields.label)
    .having(sql`count(*) > 1`)
    .orderBy(sql`count(*) desc`, schema.fields.slug)

  const counts = await db
    .select({
      categories: sql<number>`(select count(*)::int from categories)`,
      fields: sql<number>`(select count(*)::int from fields)`,
      options: sql<number>`(select count(*)::int from field_options)`,
      assignments: sql<number>`(select count(*)::int from category_fields)`,
      listings: sql<number>`(select count(*)::int from listings)`,
    })
    .from(sql`(select 1) as _`)

  console.log("Seeded:", counts[0])
  console.log("\nFields reused across categories (one row each, not one per category):")
  for (const field of shared) {
    console.log(`  ${field.label.padEnd(22)} ${field.categories} categories`)
  }
}

seed()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => client.end())
