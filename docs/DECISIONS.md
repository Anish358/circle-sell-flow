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

## 8. Phase 2 — the resolver, the contract, and the one renderer

### One call returns everything needed to render a form

`GET /api/categories/:slug/form-schema` returns groups in order, fields in order,
each field's type, presentation, options, validation config, default, visibility
rule, help text and which category it was inherited from — plus the category's
breadcrumb and `config_version`. The renderer makes no follow-up requests and has
no second source of truth.

Deliberately **not** in the contract: title, description, price, condition, city.
Those are typed columns, so they are an ordinary hand-written form section. The
contract covers only what varies by category, which is the same line drawn in §4.

### Inheritance is `DISTINCT ON (field_id) ORDER BY field_id, distance`

A recursive CTE walks from the category up to the root, collecting every ancestor's
assignments. Ordering by distance and taking the first row per field implements
**nearest ancestor wins** in one clause: a category's own assignment beats its
parent's, which beats its grandparent's.

Two queries total, not N+1 — options are aggregated per field in a lateral join, so
a category with forty fields still costs two round trips.

Verified against a real database: the sample data resolves a handset's form to
twelve fields of which only six are declared on it, with one field's `required`
overriding the ancestor's, and the same library field resolving as required in one
category and optional in another.

An ancestor being deactivated does **not** strip its descendants' fields. It
removes the ancestor from the picker; the fields it contributes are still part of
what its children collect. Only the requested category's own status decides whether
it can be sold in.

### The form-schema endpoint validates, it does not cache for a window

`Cache-Control: public, max-age=0, must-revalidate` with an ETag of
`"<slug>-v<config_version>"`. The common case is a 304 with an empty body; a config
change is visible on the very next request.

A stale window (`s-maxage=60`) would be cheaper and wrong: the admin console
renders a live preview of this exact response while an admin edits, so any delay
would show up as the tool appearing broken.

This is also what made the `config_version` gap worth fixing — a category's name
appears in the contract, so migration `0003` extends the bump trigger to renames.
Without it the ETag would keep matching and clients would serve a stale name
indefinitely.

### `chips` are radios, not a new control

Single-select chips render as a `RadioGroup` with the radio visually hidden and the
label styled as the chip. Keyboard navigation, arrow-key semantics and screen-reader
announcements come for free, and moving a field between "dropdown" and "chips" is a
presentation change with no behavioural cost. Multi-select chips are checkboxes by
the same trick.

That is `type` versus `render_as` paying for itself: four input components cover all
seven types and all nine presentations, because components are grouped by _value
shape_, not by appearance.

### Accessibility lives in one component

`FieldShell` owns the label, the required marker, help text, the error message and
the `aria-describedby` / `aria-invalid` / `aria-required` wiring, with ids derived
from the field slug so they cannot drift apart. Groups of controls get a
`fieldset` and `legend`, because one `<label>` cannot describe several inputs.

Generated forms are exactly where accessibility fails systematically — nobody
remembers the twentieth field. Centralising it means a field an admin invents next
year is accessible without anyone thinking about it.

### `DynamicForm` is controlled

It takes values and an `onChange` rather than owning state, so the same component
serves the seller flow, the admin console's live preview, and the hub verification
screen. Three surfaces, one renderer.

### Unit tests and integration tests are separate commands

`npm test` is pure logic and needs no database, so a reviewer can clone and run it.
`npm run test:db` reads from a seeded Postgres and covers the resolver, whose
substance is SQL — a mocked version of it would only prove the mock works. CI runs
both.

### Proof the claim holds

A brand-new category and a brand-new field were added with six `INSERT` statements
and no other change of any kind. A complete, correct form appeared at
`/sell?category=…`: eleven fields, seven inherited from two levels of ancestors,
with the new field's unit suffix and help text rendered. No migration, no deploy, no
code.

---

## 9. Phase 3 — validation, in three places, from one definition

### One generator, three enforcers

`buildAttributesSchema` compiles a category's resolved schema into a Zod schema. The
API route imports it; the browser form imports the same function. There is no
second hand-written validator to drift.

The third enforcer is a **Postgres trigger** (`0005_validate_attributes.sql`) that
validates `attributes` against the same registry rows, in SQL. It is not a duplicate
of the _rules_ — the rules live in `fields` and `field_options`, and both enforcers
read them — it is a duplicate of the _enforcement_, which is the point. Validation
that lives only in the API protects only the paths that go through the API, and this
schema will be written to by an admin console, a seed script, and whatever comes
next.

Proven by attempting nine writes in `psql`, entirely bypassing the application. All
nine were refused: an attribute belonging to another category, one belonging to no
field at all, a number stored as a string, a boolean as a number, a malformed date,
a select value that is not an option, an option's _label_ where its slug belongs,
a multi-select given a bare string, and a multi-select containing one bogus element.

### The trigger validates on write, never in retrospect

It considers only keys whose value actually **changed**. That single clause is what
keeps a configuration change from retro-invalidating listings that were valid when
written: archive an option and the listings that chose it stay editable, because
their value did not change. Try to newly _select_ that archived option and you are
refused.

With one exception — **re-categorising a listing revalidates every attribute**,
because the question is no longer "is this value still legal" but "does this
category collect this field at all". Without that exception, moving a handset into
Furniture would carry its storage and battery health along unchallenged. That was a
real bug found by testing the trigger, not by reasoning about it.

The trigger deliberately does **not** check required-ness. Completeness is a
property of publishing, not of a row: drafts are supposed to be incomplete.

### Empty, absent, and zero are three different things

Decided once, in `coerceValue`:

- `undefined`, `null` and `""` all mean "not answered", and a text field of nothing
  but whitespace is trimmed into that category — otherwise `"   "` satisfies
  "required";
- `false` and `0` are answers, not absences;
- `[]` from a multi-select is an answer — "none of these" — and is distinguishable
  from never having seen the field;
- `"1,20,000"` is a number, because Indian digit grouping is what a seller types;
- `NaN` and `Infinity` are rejected, since both round-trip through JSON as `null`.

Anything that resolves to unanswered is **omitted** from the stored object rather
than stored as an explicit `null`, so absence stays absence in the jsonb document.

A wrinkle worth recording: coercion has to wrap Zod's `.optional()`, not sit inside
it. `.optional()` inspects the _raw_ input, so a `null` normalised to `undefined`
inside the inner schema is still treated as present and fails its type check. Two
tests failed on exactly this before it was fixed.

### Two validation modes, one schema

`mode: "draft"` skips required-field checks; `"publish"` enforces them. A draft may
be incomplete but may not be _malformed_ — it can lack a model number, but it cannot
store "eighty" where a number belongs. Publishing is what demands a complete answer.

### Configuration is validated too

An admin editing the registry is editing a schema, and a schema can be
self-defeating in ways no single value check would catch. `validateResolvedSchema`
rejects, at save time: a minimum above its maximum, a maximum length below its
minimum, a non-positive step, a presentation the type cannot use, a select with no
options, a default that violates its own field's rules, a default absent from the
option list, a required select whose options have all been archived, a condition
referencing a field the category does not collect, a condition against an option
that no longer exists, contradictory `all` conditions on one field, **visibility
cycles**, and **required fields behind conditions that can never be true**.

That last one is the hardest failure to diagnose from the seller's side, because
nothing looks wrong — the form simply cannot be submitted, forever.

Full satisfiability of arbitrary conditions is not attempted, and is not claimed. The
subset checked is the one that occurs in practice: impossible comparisons, and
unreachability propagated along chains to a fixpoint.

### The write path, in order

`POST /api/listings` does exactly this: parse a narrow body → resolve the schema →
**strip hidden values** → validate → insert. Stripping before validating is
deliberate; required-ness is judged against the state actually submitted, not
against the configuration in the abstract.

The request body is a `strictObject` that has no `status`, `sellerId`, `slug` or
`schemaVersion` in it. Those come from the session and the registry. A field a
client can set is a field a client can lie about.

- **Idempotency.** A double-tapped submit on a flaky connection sends the request
  twice. A client-supplied key plus a unique constraint turns the second into a
  lookup returning 200 rather than a second listing. Verified sequentially and with
  four concurrent requests: one row each time.
- **Slugs.** Two people selling an "iPhone 13" is the normal case. The first gets the
  clean slug; later ones get a short random suffix. A counter (`-2`, `-3`) reads
  better but needs a lock to be correct under concurrency.
- **Stale forms.** The client sends the `config_version` it rendered against. It is
  never trusted for validation, which always runs against the current schema, but a
  mismatch lets the response say "this form changed while you were filling it in"
  instead of presenting unexplained errors.
- **Money** crosses the boundary in rupees and is stored in paise, converted in one
  place.

### Drizzle wraps driver errors

Recoverable conflicts are identified by constraint name, and Drizzle wraps the
Postgres error in a plain `Error` — so `code` and `constraint_name` live on `.cause`,
not on the error itself. Checking the top-level object silently never matches, which
turned a slug collision into a 500. `uniqueViolation()` walks the cause chain, in one
place, so no call site has to know this.

### Authentication is a stand-in, with the right shape

`getCurrentUser()` resolves a seeded account rather than reading a session, because
authentication is out of scope. What matters is that identity is established
server-side and never read from a request body — so `seller_id`, `role` and `status`
are not client-settable, and replacing this with a real session lookup changes
nothing else.

### Testing a system with no fixed schema

Table-driven over field _types_ and rule shapes, never over product categories:
those cases hold for any category anyone configures later. 118 unit tests plus 26
integration tests against a real Postgres, covering per-type valid/invalid/coerced
values, empty semantics, unknown-key rejection, hidden-value stripping,
required-if, draft versus publish, every configuration rule, cycle detection,
idempotency, slug collisions, and the trigger refusing writes that never touch the
API.

---

## 10. Phase 4 — the seller flow

### Category is a gate, then four steps

**Basics → Details → Condition & price → Review.** The category lives in the URL,
because the form cannot exist before it is known. Photos will slot in between Basics
and Details once uploads exist; the steps are a list, so that costs one entry.

Each step validates only its own answers when the seller moves forward — demanding
answers they have not reached yet is worse than letting them find out at the end. On
submit, every step is re-validated **in order**, so the seller is returned to the
earliest problem rather than the last one found.

### The step is in the URL

`history.pushState`, so Back goes back a step instead of leaving the form — the
commonest way to lose a half-written listing on a mobile browser. `pushState` rather
than a router navigation, so there is no server round trip and no risk of remounting
the form and discarding what has been typed. A `popstate` listener keeps state and
URL in agreement.

### Drafts are in `localStorage`, and that is a stated limit

No round trip per keystroke, works offline, cannot leak one seller's draft to another.
What it gives up is drafts that follow you between devices — the natural next step, and
one the API already supports, since `POST /api/listings` with `publish: false` stores a
draft row today.

The stored payload records the `config_version` it was written against, so a draft
saved before an admin changed the form is recognised and the seller is told, rather
than having stale answers silently replayed into a schema that no longer matches.

### Switching category keeps the answers that still apply

Fill in a handset, switch to a laptop, and Brand, Model, Storage, RAM and Battery
Health come across; the seller is told what was kept and what does not apply. Verified
in a real browser: six answers carried, with the laptop's own help text and
required-ness now in force on the shared Battery Health field.

This is not string matching on similar-looking names. RAM is **one field**, so an
answer to it is meaningful in every category that assigns it — the carry-over falls
out of the shared library rather than being a feature bolted on top of it.

### Verified by driving a real browser

A script attaches to headless Chromium over the DevTools Protocol — no new
dependencies — and clicks through the flow at 390px, because a screenshot of a static
page cannot show that a multi-step form works. It confirmed, end to end:

- the conditional field appears when warranty is answered Yes and **disappears** when
  changed to No;
- the review step shows option **labels** rather than the slugs stored underneath,
  `89 %` with its configured unit, and `₹32,999` with Indian digit grouping;
- the review omits the hidden warranty field, because it will not be stored;
- publishing succeeds, and a refresh mid-form restores both the values and the step.

### Three bugs it found that no amount of reading would have

- **A hydration mismatch.** Seeding form state from `localStorage` in a `useState`
  initialiser means the server renders a pristine form and the client renders a
  restored one. React resolves that by discarding the client tree. Restoring now
  happens in a post-mount effect. This is why `set-state-in-effect` is disabled at
  exactly one place, with the reasoning written next to it: the rule targets state
  derived from props, and this is the opposite case.
- **Broken button semantics on every link-styled button.** Base UI's `Button` assumes
  it renders a real `<button>` and loses native semantics when handed an anchor. Fixed
  once in a `ButtonLink` component rather than seven times, and it now cannot be
  forgotten.
- **A Node module in the browser bundle.** The category picker became a client
  component and imported `@/lib/categories`, which imports the Postgres driver. The
  module is now split: `categories/tree.ts` holds the shape and the pure functions,
  `categories/index.ts` holds the queries. The client/server boundary is a real
  constraint on module layout, not just on component annotations.

### The one-renderer guard caught its own author

The invariant test flagged seven lines of _prose_ — comments saying "on a phone"
meaning a mobile browser, and a placeholder example naming a sofa. The guard is
deliberately blunt: it matches category names anywhere in `src/`, including comments.

Rewording four comments and one placeholder was the right response; relaxing the
regex to ignore comments would have made the README's claim weaker in exchange for
convenience. The placeholder is better for it too — a shared field should not carry
an example from one category.

---

## 11. Phase 5 — browse and the product page

### Two resolvers, because they answer different questions

The form resolver answers **"what should this category ask for now?"**, so it returns
live, assigned fields only. The display resolver answers **"what does this listing
hold?"** — a question about the past.

The difference only becomes visible once the configuration has moved on from the
listing, and then it matters a great deal. A listing may carry values for fields that
have since been archived, or detached from its category, or whose chosen option no
longer exists. None of them may vanish from the page, so the display lookup is driven
by the slugs present in the row, keyed by slug, and deliberately **ignores
`archived_at`** on both fields and options.

Anything no longer part of the category is shown under "Additional details" with a
line explaining what it is, rather than silently dropped or silently mixed in with
current fields. Verified end to end: archiving a field, detaching another, and
archiving a chosen option removed all three from the sell form while the existing
listing kept rendering every answer — including the retired option's **label**, not
its slug.

### The homepage reads no attributes at all

Cards need title, price, condition, city and category — all typed columns. No pivot, no
join per listing, no N+1, and the busiest page in the app never resolves a schema. This
is the concrete payoff of the storage decision in §2, and the reason EAV's read cost
would have been paid here for a filtering feature the brief never asks for.

### Keyset pagination, not `OFFSET`

On a marketplace, new listings arrive while someone is reading page one. `OFFSET`
silently duplicates and skips rows as the set shifts underneath the reader. The cursor
is `(created_at, slug)`, because `created_at` alone does not break ties
deterministically and a page boundary landing inside a tie is exactly how a row gets
shown twice. The cursor is base64url and opaque, so its shape can change without
breaking a bookmarked URL, and a tampered one falls back to page one instead of
erroring.

### JSON-LD is the one place React does not protect you

React escapes everything it renders into JSX, which is why seller text needs no thought
anywhere else in the app. It does **not** escape the contents of a `<script>` tag — that
content is raw by design and has to go through `dangerouslySetInnerHTML`. A listing
titled `</script><script>…` would close the tag early and execute.

`JSON.stringify` alone is not enough: it leaves `<`, `>` and `&` untouched because they
are legal inside a JSON string. They are escaped as `\uXXXX`, which is identical to any
JSON parser and inert to an HTML tokeniser. U+2028 and U+2029 are escaped too — legal in
JSON, but line terminators in JavaScript, so an unescaped one is a syntax error in the
browser.

Five tests cover it, including one asserting the output still parses back to the
original value, because escaping that changed meaning would be a different bug. Writing
those literal separators into the source broke the build's parser, which is a neat
demonstration of the problem being defended against.

`additionalProperty` is built from the configured **prominent** fields, so the
structured data gains a category's new fields automatically. The same configuration
drives the form, the page and what search engines are told.

### A draft was publicly readable

The first version of the detail page only 404'd on `removed`, so anyone with the URL
could read someone else's unpublished draft. Now `active` and `sold` are public,
`removed` is gone for everyone, and a `draft` is visible only to its own seller — which
also keeps the "View listing" link working after saving one.

A 404 rather than a 403, because telling a stranger that a listing exists but is hidden
is itself a small leak. Proven by reassigning the seeded draft to a different seller and
watching it become a 404.

### Photo uploads are not built, and the empty state is designed

Uploads need object storage, a signed-upload route and MIME sniffing; that is a
self-contained piece of work rather than a polish item, so it is a stated gap. What is
built is the whole rendering path: gallery, primary image, and a fallback.

The fallback is deliberately a designed empty state tinted from the listing's slug, not
a grey box or a broken image icon. A grid of missing images reads as a broken page; a
grid of consistent placeholders reads as a marketplace waiting for photos.

`<img>` rather than `next/image`, with the lint rule disabled and the reason recorded:
these URLs are seller-supplied and of unknown origin, and `next/image` requires every
host to be allow-listed in config up front, which cannot be done for arbitrary user
input. Once uploads land and images come from one known bucket, it should become
`next/image` for exactly the optimisation the warning is pointing at.

---

## 12. Phase 6 — the admin console

### The role check is in every action, not just the layout

The admin layout refuses non-admins, but that is **not** the security boundary. A server
action is its own callable endpoint and does not run the layout that rendered its form, so
a layout-only gate would protect the view and leave every mutation open. Every action is
wrapped in `withAdmin`, which means an unwrapped one stands out on sight.

The console also has an "acting as" switcher, so the check can be _seen_ working: act as a
seller and it refuses you by name, act as the admin and it opens. Note what the cookie
holds — an email, never a role. The role is always read from the user row, so the cookie
cannot grant a privilege the account does not have. That is the same property a real
session id would need, which is why swapping the stand-in for real authentication changes
nothing else.

### The live preview is the real form

Beside the assignment list, the category editor renders `DynamicForm` — the same component
the seller flow uses, reading the same resolved contract. Not a mock-up, which is the whole
point: a hand-drawn preview would be a second implementation to keep in step, and it would
eventually lie.

It is interactive rather than a static picture, because conditional fields are the one
thing an admin cannot verify by reading the configuration. Answering "yes" to a warranty
question and watching the expiry date appear is the only honest check.

### Inherited fields are shown, not hidden

An admin seeing six fields in the editor and twelve in the seller flow, with no way to
reconcile them, would make inheritance a claim the UI never backs up. So inherited fields
appear greyed, labelled with the category they came from, each offering "Override here" —
which simply creates an assignment on this category and lets the resolver's
nearest-ancestor rule make the local row win.

### Every destructive action states its blast radius first

"Are you sure?" is unanswerable without numbers, so archiving a field says how many
categories stop collecting it, how many listings keep their value, and that nothing is
deleted — the part people fear and the part that is not true here.

Detaching and archiving are deliberately worded as different things, because they are:
detaching removes one category's assignment and leaves the field for everyone else;
archiving retires it everywhere. Two verbs, two blast radii, two confirmations.

### Assignment edits are validated against the resolved schema

Not against the row being edited. A cycle needs two rules, a dead required field needs a
chain, and a condition on a missing field depends on what the category inherits — none of
which is visible from one row. Since the resolver reads from the database, there is no way
to ask "what would the schema be if I did this?" without doing it, so an edit that produces
an invalid schema is applied and then rolled back with the reason returned.

### Reorder is buttons, not drag-and-drop

Two admins dragging at once is a lost-update race needing fractional ranking or a
transaction that rewrites every sibling. A pair of buttons needs neither, is operable by
keyboard and screen reader, and swaps in one transaction so it cannot half-apply. The
trade-off is worse for reordering forty items at once, which is not something anyone does
to a category tree.

### Activity log

The registry decides what sellers are asked and what listings may contain, so editing it is
as consequential as a deploy — and a deploy has a commit history. Every mutation records
actor, action, entity and the before/after rows. The view shows only the keys that
_changed_, because a full row dump makes the one thing that changed impossible to find.

### Proof the whole claim holds, through the UI

Driven end to end in a real browser, with a clean console:

1. acting as a seller, `/admin` refuses by name;
2. switch to the admin account — the console opens;
3. create a **brand-new field** ("Cellular", boolean, with help text) in the library form,
   which shows its permanent derived key as you type;
4. create a **brand-new category** ("Tablet") under an existing parent, landing straight in
   its editor, which reports **9 fields collected, 7 of them inherited**;
5. assign the new field and a shared one — the preview updates beside it;
6. open `/sell?category=tablet` and the seller form offers all nine fields, the new one
   included;
7. the activity log shows `field.create` and `category.create`.

No migration, no deploy, no code change. That is the assignment's central requirement,
demonstrated through the interface it asks for rather than through SQL.

### The one-renderer guard fired again

It rejected an `e.g. Tablet` placeholder in the category-creation form. Reworded rather than
exempted — the guard has now caught its own author twice, which is roughly the point of
having it.

---

## 13. Deliberate omissions (to state in the README, not to silently skip)

- **Photo uploads.** The rendering path is complete — gallery, primary image, designed
  fallback — but there is no upload. It needs object storage, a signed-upload route and
  MIME sniffing rather than extension trust, which is a self-contained piece of work.
  HEIC from an iPhone and EXIF rotation belong with it.
- **Duplicate detection** by perceptual hash, and **AI condition grading**.
- **Model → spec autofill**, where choosing a known model pre-fills its storage options.
- **Field-level drop-off analytics**, which is what would actually tell an admin that a
  field they added is costing them listings.
- **Internationalisation and unit systems.** `unit` is a display string today, not a
  convertible quantity.
- **Buyer-side facets.** The `filterable` flag is captured on every assignment and
  carried through the form-schema contract, so the configuration to drive them already
  exists; what is missing is the filter UI and the counting strategy. See the scaling
  exit path in §2 — counts over `jsonb` need an expression index per key, which is the
  first thing that would change.
