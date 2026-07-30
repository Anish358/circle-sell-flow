# Circle — category-driven Sell Product flow

A secondhand marketplace where **new product categories and their fields are
configured, not coded**. There is one form renderer; what a category collects
lives in database rows, so adding a category costs an admin a few minutes and an
engineer zero deploys.

Take-home assignment. The architecture write-up lives in
[docs/DECISIONS.md](docs/DECISIONS.md) and is the source for the final README.

## Status

Phase 0 — scaffolding, database plumbing, CI. The data model, form-schema
resolver, seller flow, product detail page and admin console follow.

## Running it locally

Requires Node 20.9+ and Docker.

```bash
npm ci
cp .env.example .env      # defaults point at the Docker Postgres below
npm run db:up             # start Postgres on :54322
npm run db:migrate
npm run dev               # http://localhost:3000
```

## Scripts

| Script                | What it does                                        |
| --------------------- | --------------------------------------------------- |
| `npm run dev`         | Development server                                  |
| `npm run build`       | Production build                                    |
| `npm test`            | Vitest suite                                        |
| `npm run typecheck`   | `tsc --noEmit`                                      |
| `npm run lint`        | ESLint                                              |
| `npm run format`      | Prettier, write                                     |
| `npm run db:up`       | Start local Postgres in Docker                      |
| `npm run db:down`     | Stop it                                             |
| `npm run db:generate` | Generate a migration from the schema (`--name=...`) |
| `npm run db:migrate`  | Apply pending migrations                            |

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
