# Setup

Everything below was run on a fresh `git clone` before being written down, on
macOS with Node 20.19 and Docker Desktop. Nothing here needs an account with
anyone.

## Requirements

- **Node 20.9+** (`node --version`)
- **Docker**, for the local Postgres. If you would rather use a Postgres you
  already have, skip `db:up` and point `DATABASE_URL` at it — nothing in the
  schema needs an extension or a Supabase-specific feature.

## Five commands

```bash
npm ci
cp .env.example .env      # defaults already match the Docker Postgres below
npm run db:up             # Postgres 17 on :54322, waits until healthy
npm run db:migrate        # plain SQL migrations, in order
npm run db:seed           # sample categories, fields and 17 listings
npm run dev               # http://localhost:3000
```

`cp .env.example .env` is genuinely step two, not a formality: **`npm run build`
fails without `DATABASE_URL` set**, because the API route modules import the
database client and the client validates its environment at import time. The
variable has to be _present and well-formed_; it does not have to point at a
database that is running — the build never connects, which is deliberate, so a
deploy cannot fail because Postgres is slow or down.

## Sign in

There is no authentication — it is out of scope for the assignment, and faking
it convincingly would have cost a day that went into the registry instead. Use
the **Acting as** control in the header to switch between the seeded accounts:

| Account                | Role   | What it can do                          |
| ---------------------- | ------ | --------------------------------------- |
| `admin@circle.example` | admin  | Everything, including the admin console |
| `priya@example.com`    | seller | Browse and sell (this is the default)   |
| `rahul@example.com`    | seller | Browse and sell                         |

The switcher sets which seeded account you are; it never sets a role. The role
is read from the user row on every request, so the cookie cannot grant a
privilege the account does not have — `/admin` refuses a seller who types the
URL, and every mutation re-checks independently of the page that rendered it.

## Tests

```bash
npm test        # 179 unit tests. No database, no Docker — runs on a bare clone
npm run test:db #  79 integration tests. Needs the migrated, seeded database above
```

They are split on purpose: a reviewer can clone and run `npm test` immediately,
and the tests whose whole substance is a recursive CTE or a Postgres trigger run
against a real Postgres rather than a mock that would prove nothing.

## What each script does

| Script                | What it does                                           |
| --------------------- | ------------------------------------------------------ |
| `npm run dev`         | Development server                                     |
| `npm run build`       | Production build (needs `DATABASE_URL` set, see above) |
| `npm test`            | Unit tests — pure logic, no database needed            |
| `npm run test:db`     | Integration tests — needs a migrated, seeded database  |
| `npm run typecheck`   | `tsc --noEmit`                                         |
| `npm run lint`        | ESLint                                                 |
| `npm run format`      | Prettier, write                                        |
| `npm run db:up`       | Start local Postgres in Docker                         |
| `npm run db:down`     | Stop it                                                |
| `npm run db:reset`    | Drop the volume, recreate, re-run every migration      |
| `npm run db:generate` | Generate a migration from the schema (`--name=...`)    |
| `npm run db:migrate`  | Apply pending migrations                               |
| `npm run db:seed`     | Load the sample registry and listings                  |

## Sample data

`npm run db:seed` is **destructive and re-runnable**: it truncates every table
and reloads, so the database always ends in the same known state. It loads six
categories in two trees, 22 fields, 28 assignments and 17 listings across the three
leaf categories — including one draft, one sold listing, five with hub verifications
and five with photos.

Everything it does is an `INSERT`. There is no DDL anywhere in it, which is the
whole claim the project makes: adding a category is data.

It prints two things worth reading, because they are the design stated as
numbers — how many fields each category inherits rather than declares, and which
fields are shared across categories rather than duplicated per category.

## Deploying

The app runs on Vercel against Supabase Postgres, both in Mumbai (`bom1` /
`ap-south-1`). Two things are worth knowing if you redeploy it:

**Regions must match.** With functions in Virginia and the database in Mumbai, a
single `SELECT now()` took 633 ms against 9 ms locally. `vercel.json` pins
`regions: ["bom1"]`. The check is the second segment of the `x-vercel-id`
response header: `bom1::bom1::…` is right, `bom1::iad1::…` means the edge is in
Mumbai but the compute is not.

**Two connection strings, because they need different pooling modes.** Same host
and user, different ports:

- `DATABASE_URL` → transaction pooler, port **6543** — the running app. Short
  serverless invocations are exactly what it is for. It does not support prepared
  statements, hence `prepare: false` in the client.
- `MIGRATION_DATABASE_URL` → session pooler, port **5432** — migrations and the
  seed only, which need session state a transaction pooler does not keep.

Avoid Supabase's "Direct connection" string for both: it is IPv6-only without a
paid add-on, and Vercel cannot reach it. Locally, one `DATABASE_URL` is enough.

Migrations run as part of the deploy (`vercel-build`), so the deployed schema can
never lag the deployed code. **Sample data does not**, because loading it
truncates every table — that has to be a deliberate act:

```bash
# app/.env.supabase — git-ignored, like every .env except .env.example
DATABASE_URL="…pooler.supabase.com:6543/postgres"
MIGRATION_DATABASE_URL="…pooler.supabase.com:5432/postgres"
```

```bash
npx tsx --env-file=.env.supabase src/db/seed/index.ts
```

A migration alone is not enough to make a feature visible: if the meaning of a
new column lives in seed data, the deployed database needs re-seeding after the
deploy, or the feature looks broken rather than absent.
