# Decision log

Appended to as decisions are made, so the README is written from a record rather
than from memory. Each entry: what was chosen, what was rejected, and why.

---

## The problem, in one line

Make the shape of the data itself data. One form renderer that knows nothing
about any particular product; the knowledge of what a given category collects
lives in database rows. Adding a category costs an admin five minutes and an
engineer zero deploys.

The harder half, which the brief does not state: the schema becomes mutable at
runtime, by non-engineers, while data already exists against older versions of
it. Most of the difficult decisions below descend from that.

---

## 1. Two decisions that are usually conflated

**How field _definitions_ are stored** and **how a listing's _values_ are stored**
are separate questions. Only the first one determines extensibility.

- **Definitions → normalised relational tables.** A field library plus a
  many-to-many assignment to categories.
- **Values → a `jsonb` column on `listings`, keyed by immutable field slug.**

The brief's own bullets point at the first: "create, edit, and organize listing
**fields**" is one capability, "configure which fields **belong to each
category**" is another. Fields are therefore not owned by a category — the three
example categories in the brief share five fields between them, and defining RAM
twice would already be a modelling bug.

The split that makes the rest fall out:

- the **field** owns identity and type — a field's type is fixed forever;
- the **assignment row** owns everything contextual — required, order, group,
  default, help text, visibility condition, filterable.

So one Battery Health field can be required in one category and optional in
another without duplication.

---

## 2. Storing values: `jsonb`, with the integrity bought back

Rejected alternatives, each for a specific reason:

| Option                         | Why not                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wide table of nullable columns | A migration plus a deploy per field — fails the brief's only hard requirement                                                                              |
| One table per category         | Most expensive option; cross-category reads become UNIONs over N tables of unknown shape                                                                   |
| EAV                            | Genuinely stronger integrity and better planner statistics, but pays a pivot in every read path and N-row writes — for filtering this brief never asks for |
| `jsonb` + EAV projection       | The scaling exit path, not the starting point                                                                                                              |

`jsonb` was chosen because the brief has no filtering requirement (the homepage
needs only common columns), because it is substantially less code in every read
path, and because it keeps one validated object flowing form → API → database →
detail page.

`jsonb` is only defensible with three hardenings, without which it is laziness
rather than judgement:

1. **Immutable `slug` as the key, mutable `label` for display.** Renaming a field
   must never touch a listing row. Slug input is disabled after creation.
2. **One validation definition, two enforcers.** Validation is generated from the
   registry and enforced both in the API (Zod) and by a Postgres trigger, so the
   database refuses malformed attributes independently of application code.
3. **Registry-aware writes.** Unknown keys rejected; keys must be active fields
   assigned to that category; select values must be live options; values coerced
   to the field's declared type.

Note on the usual objection: the folklore that "EAV has no type safety and
queries from hell" is backwards. Typed value columns plus a composite foreign key
make wrong data physically unstorable, and its filters are ordinary btree
predicates with real statistics. The honest statement is that EAV buys integrity
and query statistics at the cost of read ergonomics — and that we chose `jsonb`
and bought the integrity back with a trigger.

**Exit path** when faceted search with counts becomes a primary read pattern:
expression/generated columns on hot keys → an EAV projection table maintained by
trigger → an external search index. The registry never changes and neither does
the seller flow.

---

## 3. `type` and `render_as` are different things

Radio versus dropdown is not a type. `single_select` is a storage and validation
contract; whether it renders as radios, a dropdown or chips is presentation.
Modelling them separately halves the validation code and makes "make that a radio
group" a one-field toggle rather than a new type with its own validator.

---

## 4. Common versus category-specific

Common attributes (title, description, price, condition, city, seller, status,
timestamps, images) live in typed columns on `listings`. The rule:

> If the platform's own code needs to sort, filter or price on it, it is a column.
> If only humans read it, it is data.

Money is stored in integer minor units (paise), never a float. Purchase dates are
`date`; `created_at` is `timestamptz`.

---

## 5. Stack

Next.js 16 (App Router) + TypeScript + Postgres + Drizzle + Zod + Tailwind and
shadcn/ui, deployed on Vercel; Vitest for tests.

- **Next.js over a separate API + SPA** — the detail page is the SEO-bearing page
  of a marketplace, so server rendering is a product argument, not a preference.
- **Drizzle over Prisma** — migrations are plain reviewable SQL, and this schema
  needs hand-written constraints, triggers and a recursive CTE that an ORM's
  abstraction would fight.
- **Zod** because the same generated schema has to run in the browser and on the
  server; one definition, two enforcers.
- **Postgres integer identity keys for registry tables, `uuid` for listings.**
  Registry rows are internal, small, and debugged by hand in `psql`, where
  readable integers help. A listing id is public, so a sequential one would leak
  volume.

---

## 6. Phase 0 setup decisions

- **Local Postgres in Docker, Supabase in deployment.** Nothing in the schema
  depends on Supabase-specific extensions, so the two are interchangeable through
  `DATABASE_URL`.
- **Two connection strings in deployment, one locally.** The app runs on a
  transaction-mode pooler, which suits short-lived serverless invocations but
  supports neither prepared statements (hence `prepare: false` in the client) nor
  session state. Migrations therefore use a session-mode connection via
  `MIGRATION_DATABASE_URL`. Supabase's direct connection is avoided on both: it is
  IPv6-only without a paid add-on, and the serverless host cannot reach it.
- **Migrations run as part of the deploy build** (`vercel-build`), so the deployed
  schema can never lag the deployed code, and a bad migration fails the deploy
  instead of half-breaking the running app.
- **Migrations run through a script (`src/db/migrate.ts`), not the Drizzle Kit
  CLI**, so the same code path runs locally, in CI, and against the deployed
  database.
- **`gin (attributes jsonb_ops)`, not `jsonb_path_ops`.** The smaller
  `jsonb_path_ops` index does not support key-existence operators (`?`, `?|`,
  `?&`), and the "is this field still in use?" check is `attributes ? 'slug'`.
  Choosing the faster index would silently turn that check into a sequential scan.
- **Environment variables validated at startup** (`src/lib/env.ts`) so a missing
  `DATABASE_URL` fails with one clear message rather than inside a query.
- **`noUncheckedIndexedAccess` on.** The registry hands us records and arrays
  keyed by runtime data; unchecked index access is exactly the bug class this
  design is most exposed to.
- **CI runs migrations against an empty Postgres on every push.** Formatting,
  lint, types, migrations, tests, build — in that order.
- **The one-renderer invariant is enforced by a test**
  (`tests/no-hardcoded-categories.test.ts`) that fails the build if any category
  name appears in `src/` outside sample data. The brief states the prohibition
  ("avoid creating separate hard-coded forms for individual categories"); this is
  the mechanical proof it holds. It caught a doc comment on its first run.
- **No `react-hook-form`.** The current shadcn registry ships form primitives
  built on Base UI without it, and a schema-driven renderer needs direct control
  over error and `aria-*` wiring anyway. Revisit if hand-rolled state management
  in the dynamic form grows past a screenful.

---

## 7. Phase 1 data-model decisions

### Slugs are kebab-case everywhere, including inside `attributes`

One format, one regex, one shared helper, enforced by a check constraint on every
slug column. Field slugs double as `attributes` keys, so `{"battery-health": 89}`
rather than `battery_health`.

The usual objection is that hyphenated keys are awkward in JavaScript
(`attributes["battery-health"]` rather than `attributes.battery_health`). It does
not apply here: application code never names a field, because naming one would
break the single-renderer invariant. Every access is already
`attributes[field.slug]`. Meanwhile kebab-case is what URLs want, which matters for
shareable filter links.

### The database refuses the two changes that would corrupt data

Two invariants are usually written down and then broken by whichever client
forgets them. Both are triggers instead:

- **A field's `slug` is immutable.** It is the key every stored value lives under;
  renaming it orphans them. Change the `label`, which is display-only and free.
- **A field's `type` cannot change in place.** No migration can reinterpret
  `"eight GB"` as a number. Create a new field and backfill.

Both raise a message that says what to do instead. Option `value_slug` is immutable
for the same reason one level down. This matters more than it might look: the
registry is edited at runtime by non-engineers, and in a codebase where several
clients and pipelines write to the same tables, application-level policy is not a
boundary. Verified by attempting all of them — plus nine other invalid writes — and
confirming Postgres rejects each one.

### `config_version` is maintained by trigger, and bumps the whole subtree

Because a category's resolved schema includes everything its ancestors assign, a
change to a parent has to invalidate its descendants too. `bump_config_version`
walks downward with a recursive CTE and is called from triggers on assignments,
field definitions, options, group labels and re-parenting.

It is targeted, not blanket: relabelling a field bumps only the categories that
assign it. This is what makes ETag caching of the form-schema endpoint safe, and
what lets a draft detect that the schema moved while the seller was typing.

### Composite dimensions are three fields in a group, not one value

A sofa's dimensions are `length-cm`, `width-cm` and `height-cm` sharing a
"Dimensions" group. A single composite value would read more elegantly and would
make "sofas under 200cm wide" impossible to express as an ordinary predicate.

### Field reuse forces one shared vocabulary — the honest cost

Because Brand is one field assigned to a parent category, its option list is the
union of every brand any descendant might use. A handset's brand dropdown
therefore contains laptop manufacturers.

This is the real trade-off of a shared library, and the escape hatch is to create
separate fields when the vocabularies genuinely diverge — accepting that they then
stop being one thing to maintain. Assignment overrides cover policy and
presentation; they deliberately cannot narrow an option list, because that would
make the stored value's meaning depend on which category read it.

### Smaller calls

- **A minimal `users` table exists from the start.** `listings.seller_id` and every
  authorization check need it, and adding a non-null owner column to existing rows
  later is far more painful than having the table now. Authentication itself is out
  of scope.
- **Integer identity keys for registry tables, `uuid` for listings.** Registry rows
  are internal, small, and debugged by hand in `psql`, where readable integers
  help. A listing id is public, so a sequential one would leak volume.
- **`listing_images` is a table, and `sort = 0` is the primary image.** Order and
  primacy are things we query and reorder. One ordering rule beats an `is_primary`
  flag that two rows can both claim.
- **Detach and archive are different verbs.** Detaching removes an assignment row;
  archiving sets `archived_at` on the field itself and leaves every listing's
  values renderable. The field foreign key is `restrict`, so a field in use cannot
  be deleted even by hand.
- **The seed truncates and re-inserts.** A demo database is disposable, and an
  idempotent seed is one less thing to reason about. One sample listing is a
  deliberately incomplete draft, because drafts save without passing full
  validation and only publishing demands it.

---

## 8. Deliberate omissions (to state in the README, not to silently skip)

Duplicate detection by perceptual hash, AI condition grading, model → spec
autofill, field-level drop-off analytics, i18n and unit systems, HEIC decoding and
EXIF rotation.
