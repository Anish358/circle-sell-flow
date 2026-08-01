import { sql } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"

import { db } from "@/db"
import { countActivityLog, getActivityLog, getAuditLog } from "./audit"
import { searchTerms } from "@/lib/search"

/**
 * The activity feed against a real database.
 *
 * One of these exists because of a bug the unit tests could not have caught: the query
 * was rewritten as raw SQL, which returns `at` as a string where the query builder
 * returns a `Date`, and the page then crashed on `at.toISOString()`. Nothing about the
 * describer was wrong, so nothing in `activity.test.ts` failed — the shape of a row came
 * out of the driver, and only a real driver can be asked about that.
 *
 * Run with `npm run test:db`.
 */

const MARKER = "Zzz Activity Fixture"

async function seedEntries(count: number) {
  await db.execute(sql`
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before, after, at)
    SELECT (SELECT id FROM users WHERE role = 'admin'),
           'category.create', 'category', '99' || i,
           NULL,
           jsonb_build_object('id', 9900 + i, 'name', ${MARKER} || ' ' || i, 'parentId', NULL),
           now() - (i || ' seconds')::interval
      FROM generate_series(1, ${count}) i
  `)
}

afterAll(async () => {
  await db.execute(sql`DELETE FROM audit_log WHERE after->>'name' LIKE ${`${MARKER}%`}`)
})

describe("the activity feed", () => {
  it("returns a Date for the timestamp, which the page renders with", async () => {
    await seedEntries(1)
    const [entry] = await getAuditLog({ limit: 1 })

    // The regression this file exists for. `toISOString` is what the page calls.
    expect(entry?.at).toBeInstanceOf(Date)
    expect(() => entry!.at.toISOString()).not.toThrow()
  })

  it("finds an entry by a name that only exists inside its document", async () => {
    await seedEntries(3)

    // "Zzz Activity Fixture 2" is in the `after` json and nowhere else — no column holds
    // it, and the sentence the admin reads is generated at display time.
    const terms = searchTerms(`${MARKER} 2`)
    const found = await getActivityLog({ terms, limit: 10, offset: 0 })

    expect(found).toHaveLength(1)
    expect(found[0]?.headline).toBe(`New category “${MARKER} 2”`)
    expect(await countActivityLog(terms)).toBe(1)
  })

  it("pages without repeating an entry, even when timestamps collide", async () => {
    // Written in one statement, so several rows can share a timestamp to the microsecond
    // — the case the id tie-break in the ordering exists for.
    await db.execute(sql`DELETE FROM audit_log WHERE after->>'name' LIKE ${`${MARKER}%`}`)
    await db.execute(sql`
      INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after, at)
      SELECT (SELECT id FROM users WHERE role = 'admin'),
             'category.create', 'category', '99' || i,
             jsonb_build_object('name', ${MARKER} || ' ' || i),
             now()
        FROM generate_series(1, 6) i
    `)

    const terms = searchTerms(MARKER)
    const [first, second] = await Promise.all([
      getActivityLog({ terms, limit: 3, offset: 0 }),
      getActivityLog({ terms, limit: 3, offset: 3 }),
    ])

    const ids = [...first, ...second].map((item) => item.id)
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6)
  })

  it("counts the same set it pages", async () => {
    const terms = searchTerms(MARKER)
    const total = await countActivityLog(terms)
    const all = await getActivityLog({ terms, limit: 100, offset: 0 })

    expect(all).toHaveLength(total)
  })
})
