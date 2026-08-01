# Circle — category-driven Sell Product flow

A secondhand marketplace where **new product categories and their fields are
configured, not coded**. There is one form renderer; what a category collects
lives in database rows, so adding a category costs an admin a few minutes and an
engineer zero deploys.

Take-home assignment. The architecture write-up lives in
[docs/DECISIONS.md](docs/DECISIONS.md) and is the source for the final README.

## Status

End to end: browse listings, pick a category, fill a form generated entirely from
database rows, review, publish, and see the listing on its own server-rendered page.
Validation is generated from the registry and enforced in the browser, in the API, and
again by a Postgres trigger. Drafts survive a refresh, switching category keeps the
answers the new category still collects, and archiving a field removes it from new
listings without changing what existing ones display.

The admin console is in too: category tree, field library, and a per-category assignment
screen with a **live preview of the seller's form** beside it. Adding a category and a field
takes a few minutes through the UI, with no migration and no deploy.

Listings also carry what a Circle hub measured, separately from what the seller claimed.
Mark a field **Hub verifies** on its assignment and it appears on the hub's verification
form — the same `<DynamicForm>`, filtered — and the product page then shows
_"Battery Health 86% ✓ Verified · seller stated 89%"_. The seller's answers are never
overwritten, and the database refuses a verified value that cannot name who recorded it.

Still to come: photo uploads, and buyer-side filters (the `filterable` flag is captured but
no filter UI reads it yet).

## Running it locally

Requires Node 20.9+ and Docker.

```bash
npm ci
cp .env.example .env      # defaults point at the Docker Postgres below
npm run db:up             # start Postgres on :54322
npm run db:migrate
npm run db:seed
npm run dev               # http://localhost:3000
```

## Seeding a deployed database

Migrations run automatically on deploy (`vercel-build`). Sample data does not,
because loading it **truncates every table** — that has to be a deliberate act.

Keep the deployed credentials in a separate, git-ignored env file rather than
editing `.env`, so local development keeps pointing at Docker:

```bash
# app/.env.supabase — ignored by git, like every .env except .env.example
DATABASE_URL="…pooler.supabase.com:6543/postgres"            # transaction pooler
MIGRATION_DATABASE_URL="…pooler.supabase.com:5432/postgres"  # session pooler
```

```bash
npx tsx --env-file=.env.supabase src/db/seed/index.ts
```

The seed uses `MIGRATION_DATABASE_URL` when present: bulk administrative work
belongs on a session-mode connection, for the same reason migrations do.

## Scripts

| Script                | What it does                                          |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Development server                                    |
| `npm run build`       | Production build                                      |
| `npm test`            | Unit tests — pure logic, no database needed           |
| `npm run test:db`     | Integration tests — needs a migrated, seeded database |
| `npm run typecheck`   | `tsc --noEmit`                                        |
| `npm run lint`        | ESLint                                                |
| `npm run format`      | Prettier, write                                       |
| `npm run db:up`       | Start local Postgres in Docker                        |
| `npm run db:down`     | Stop it                                               |
| `npm run db:reset`    | Drop the volume, recreate, re-run all migrations      |
| `npm run db:generate` | Generate a migration from the schema (`--name=...`)   |
| `npm run db:migrate`  | Apply pending migrations                              |
| `npm run db:seed`     | Load sample categories, fields and listings           |

## Layout

```
drizzle/            generated SQL migrations, committed and reviewed
docs/DECISIONS.md   architecture decisions with rejected alternatives
src/app/            routes — browse, sell, admin, API
src/components/     ui/ is shadcn; everything else is app-specific
src/db/             schema, client, migrate and seed scripts
src/lib/            env validation, shared helpers
tests/              cross-cutting tests, including the one-renderer invariant
```

## Stack

Next.js 16 (App Router) · TypeScript · Postgres · Drizzle · Zod · Tailwind and
shadcn/ui · Vitest. Deployed on Vercel against Supabase Postgres.
