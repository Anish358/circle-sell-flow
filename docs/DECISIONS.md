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

An "acting as" switcher makes the check _visible_. Note what the cookie holds — an email,
never a role. The role is always read from the user row, so the cookie cannot grant a
privilege the account does not have. That is the same property a real session id would
need, which is why swapping the stand-in for real authentication changes nothing else.

### The switcher belongs in the global header, and the nav is role-aware

It first sat inside the admin console, which was the wrong place twice over. A control that
lives behind the role check cannot demonstrate the role check; and appearing only on admin
screens, unlabelled, it read as an account menu that a marketplace had no business offering.

It is now in the site header on every page, labelled "(demo)", and the nav responds to it:
a seller is offered "Sell an item", an administrator is offered "Admin" as well. Switching
account changes the header in place — the Admin link appears and disappears — which
demonstrates the whole authorization story in about a second, without anyone having to
find a refusal page.

Three things that keeps honest:

- **Hiding a link is not authorization.** `/admin` still refuses on the server, and every
  mutation still re-checks inside `withAdmin`. The refusal page still exists and is still
  reachable by typing the URL, because that is exactly what an attacker would do. The nav
  decides what is worth showing; it decides nothing about what is allowed.
- **The nav never claims a rule the code does not enforce.** An administrator keeps seeing
  "Sell an item", because nothing in the API stops an admin listing something. Hiding it
  would have the interface assert a restriction that does not exist — the same class of
  error as a form that validates one way and an API another.
- **Something has to resolve "who is this" regardless.** `seller_id` comes from the session
  rather than the request body, the product page hides other people's drafts, and 7b's
  `verified_by` records who vouched. Removing the switcher would not remove that identity,
  only fix it to one hard-coded account and make all three untestable through the UI.

The default actor is a seller, deliberately: the first thing a reviewer sees is the state
in which the console is not offered.

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

### Re-parenting previews the swap, rather than confirming it

Moving a category is the most consequential single edit in the console and the only one
whose effect is invisible from the thing being edited. The category's own assignments do
not change at all; its entire _inherited_ set is replaced. A category can gain or lose
most of the questions a seller meets, and nothing on the row being dragged says so.

An "are you sure?" here is a question nobody can answer, so the dialog answers it first:
pick a destination and it computes the two resolved field sets and shows the difference —
what the category starts collecting, what it stops collecting, and how many live listings
hold a value for a departing field.

Three decisions inside that:

- **The preview is read-only and runs on every change of the destination**, not on submit.
  `getReparentImpact` derives the prospective set from hypothetical ancestry rather than
  writing and rolling back the way the assignment actions have to. That is what lets an
  admin try a move, see it is worse than they thought, and pick something else. A warning
  that appears only at submit arrives after the decision is made.
- **Descendants are never offered.** `reparentCategory` walks the tree and rejects a cycle
  server-side — it must, since a check constraint can only catch a category being its own
  parent, not a longer loop. But the dropdown is built from the tree already on the page
  with the subtree excluded, so the ordinary path never reaches that error. Guard in the
  action, absence in the UI.
- **"Stops collecting" says what does _not_ happen.** Nothing is deleted; listings keep
  every value they hold and the product page moves them under "Additional details". The
  wording has to carry that, because "stops collecting 5 fields" alone reads as data loss
  and would make an admin refuse a safe move.

The arithmetic is pinned by integration tests rather than by the dialog: equivalent
parents report no change, a deeper move reports only gains, a move to the top level
reports the losses and the affected-listing count, a listing holding five departing fields
is counted once, and the category's own assignments never appear as lost.

---

## 13. Performance — the function was on the wrong continent

The deployed app felt sluggish on every navigation from the very first click. Measured
rather than guessed, against an identical local run:

| Route                                   | Local | Deployed | Ratio |
| --------------------------------------- | ----- | -------- | ----- |
| `/api/health` — a single `select now()` | 9ms   | 633ms    | 70×   |
| `/` — one query                         | 44ms  | 761ms    | 17×   |
| `/sell?category=…` — two queries        | 41ms  | 1353ms   | 33×   |

Two things in that table identify the cause. 633ms to run `select now()` cannot be the
query, so it is almost entirely network. And the cost scales with the _number of queries a
page issues_ rather than with how much work they do — the signature of round-trip latency.

The response headers confirmed it: `x-vercel-id: bom1::iad1::…`. The request arrives at the
Mumbai edge, but the function **executes in `iad1` (Virginia)**, while the Supabase project
is in `ap-south-1` (Mumbai). Every query crossed the planet and came back, roughly 200ms
each, and a cold invocation spends several of those on the TCP and TLS handshake before the
first query even runs.

Fixed at three levels, largest first:

1. **Run the function next to the database.** `vercel.json` pins the region to `bom1`, so
   the round trip falls from ~200ms to single digits. For a marketplace whose sellers and
   data are both in India, compute belonging in Mumbai is the right answer on its own
   merits, not a workaround.
2. **Stop paying for round trips that were never needed.** The form-schema resolver issued
   its two queries _sequentially_ even though neither reads the other's result — both start
   from the same slug. They are now issued together. The listing detail query folded its
   images in as a json aggregate instead of a second trip, and the admin editor's category
   lookup and schema resolution now run in parallel.
3. **Nothing cached yet, deliberately.** Caching would have masked the latency rather than
   removed it, and would have made the admin's live preview a correctness question. With
   compute and data co-located the remaining per-query cost is a few milliseconds, so
   caching becomes an optimisation to reach for if measurement still calls for it — not a
   patch over a misplaced function.

The general lesson worth keeping: latency multiplies by the number of sequential round
trips, so "how many times does this page talk to the database, and does it have to wait
between them?" is a more useful question than "is this query fast?". Both answers came from
measurement — the header that named the region was the whole diagnosis.

Cold starts remain: the first request after an idle period still pays for booting the
function and opening a fresh connection. That is inherent to serverless on this plan and is
not something the code can fix.

### The sequel: it was not only slow, it was hanging

Moving the function to Mumbai fixed the latency and uncovered a worse fault underneath.
The deployment logs showed `Vercel Runtime Timeout Error: Task timed out after 300 seconds`
on `/` and `/admin/categories`, a 504, and a failed homepage query — on pages that answer
in 40ms against a local database.

Two causes, and they compounded.

**Connections were never released.** A serverless instance is _frozen_ after it responds,
not torn down, and postgres.js leaves an idle connection open indefinitely because
`idle_timeout` defaults to unset. So every frozen instance kept holding a slot in Supabase's
pooler that it was not using. Enough concurrent invocations and every slot belonged to a
sleeping instance; new requests then waited for a slot that would never free, and since
`connect_timeout` was also unset they waited until the platform killed them at 300 seconds.
The client now sets `idle_timeout` so slots are handed back, `connect_timeout` so a request
that cannot get one fails in seconds rather than five minutes, and `max_lifetime` so a
long-warm instance does not hold one forever.

**A page of links was a page of full renders.** Next prefetches links entering the viewport,
and for a _dynamic_ route it prefetches down to the nearest `loading` boundary. There was no
`loading.tsx` anywhere, so nothing stopped it: every listing card scrolling into view
prefetched a complete product page, server render and queries included. One homepage visit
became a dozen page renders — which is what filled the pooler in the first place.

Adding `loading.tsx` to each dynamic route fixes it at the framework's own seam rather than
by turning prefetching off. Prefetch now stops at the boundary and fetches the shell, and
the same file gives a click immediate visual feedback instead of a page that appears to do
nothing — the symptom originally reported.

Worth naming the shape of this: the region problem was making a slow thing slower, and the
connection problem was making a broken thing invisible. The first was found by measuring,
the second only by reading the deployment logs. Neither showed up locally, because a
database on the same machine hides both a missing idle timeout and a dozen redundant
renders.

### A correction to the above: `idle_timeout` cannot do what I first claimed

`idle_timeout` and `max_lifetime` are client-side timers, and **timers do not run in a frozen
instance**. They reclaim a connection from an instance that is still awake, which is worth
having, but they cannot reclaim one from an instance that is asleep — which is precisely the
case that fills the pooler. Reclaiming those is the pooler's job, not the client's. The first
version of this section over-credited them.

What actually holds the line is therefore elsewhere, and the ordering matters:

- **Manufacture fewer instances.** The `loading.tsx` boundaries removed roughly a dozen page
  renders per homepage visit. That was the mechanism creating instances faster than anything
  could recycle them, and it is the real fix.
- **Never wait forever.** `connect_timeout` on the client and `maxDuration = 20` on every
  route that touches the database mean a request which cannot get a connection fails in
  seconds. Previously it held a function slot for five minutes, which is how a single stuck
  request took later ones down with it — the difference between one slow page and an
  unavailable site.
- **Make failure visible.** An `error.tsx` boundary, because without one a page whose data
  never arrives sits on its loading skeleton forever and nobody can tell "slow" from
  "broken". That was exactly the reported symptom. Its message is deliberately generic:
  `error.message` from a server component can carry a connection string.
- **One less round trip per connection.** postgres.js runs a type-introspection query on
  every new connection by default; `fetch_types: false` removes it, which matters when
  connections are being opened often.

On the observability side: the memory graph looked alarming and was not. Postgres deliberately
fills available RAM with cache and buffers, so "433MB used" was mostly cache with the actual
working set near 130MB, and the line was flat across the hour — no leak. The number worth
watching was the error count on the Postgres panel, not the memory chart. Reading a metric as
a symptom because it is large is a good way to fix the wrong thing.

### A second correction: removing `idle_timeout` again

The failure persisted, with a sharper shape: fine on first load, broken on the next one after
a pause, and reproducible by switching accounts in the admin console. Driving that exact
sequence against a local database — three switch rounds and four back-to-back reloads — passed
every time with a clean console, which ruled out the logic and pointed squarely at the
connection.

`idle_timeout` was the likely culprit, and it was mine. A frozen instance cannot run its
timers, so the 20-second timer fires _immediately_ on thaw — potentially closing the socket at
the moment the incoming request is writing a query to it. A request that loses that race waits
on a dead socket. It only happens on a reused instance after a pause, which is precisely the
reported symptom.

Since the setting could never do the job it was added for, and could plausibly cause this one,
it is gone along with `max_lifetime`. Reclaiming connections from sleeping instances belongs
to the pooler, which has a server-side client timeout for it.

Two further reductions, aimed at needing fewer connections rather than surviving their
absence:

- **`getCurrentUser` is deduplicated per request** with React's `cache`. It is called by the
  admin layout, by every `requireAdmin` inside an action, and by the product page's
  draft-visibility check — so one admin render made three identical round trips for the same
  row. On a function holding a single connection those serialise, and each is another chance
  to be the request that cannot get one.
- **One `revalidatePath` instead of three.** Every mutation called it for `/admin`, `/sell`
  and `/`, but `"/"` with `"layout"` already covers everything beneath it. The other two were
  repeating the same invalidation.

What this sequence is really an example of: a fix reasoned from a plausible mechanism, shipped,
and then found to be both ineffective and harmful. The tell was that it could not work in
principle — timers in a frozen process — which was visible before shipping it and should have
stopped it. Local reproduction is what separated "our code is wrong" from "our environment is
wrong", and it was worth doing before changing anything a second time.

### The resolution: one connection, shared by every request the instance was serving

The failure outlived both corrections above, and by the end it had four reproductions rather
than one: refresh `/admin/categories` twice, switch accounts in the actor switcher, create a
category, reorder a category with the arrows. All four behaved identically — a long pause, the
error boundary, and **the write had succeeded anyway**. Navigate away and back and the new
category was there, the reorder had happened, the account had switched. "Try again" on the
error boundary failed every time; "Back to listings" always worked.

**The observation that mattered was available from the first day and went unused for three: the
actor switcher performs no database write at all.** It sets a cookie and calls
`revalidatePath`. If the flow with no query fails the same way as the flow with a transaction,
the mutations are not implicated — the shared path is, and the only shared path is the
re-render that follows the revalidation.

**The root cause.** `src/db/index.ts` exports a module-scope postgres.js client, and that
client was configured `max: 1`. Vercel's Fluid Compute runs **several requests concurrently in
one instance** rather than one request per instance, and every one of them imports that module
and receives the same client. So concurrent queries — from different requests, and from the
layout and page of a single re-render, which React renders as siblings — were written onto one
socket through Supabase's **transaction-mode** pooler, which expects one query at a time per
client connection because that is how it decides which server connection a statement belongs
to. postgres.js has no query timeout, so when that socket stopped making progress, every later
query on the instance queued behind it indefinitely, and the instance stayed warm and kept
accepting requests. A poisoned instance: which is exactly why retrying failed while navigating
worked, since the retry returned to the same instance and the navigation could land on another.

None of it can reproduce locally. There is no pooler, and there is one request at a time.

**How it was finally found, which is the part worth keeping.** For three days the investigation
read Supabase's Postgres logs and inferred the application's behaviour from them. The failing
layer was the application, and its own function logs stated the cause outright in three fields:

- three admin requests with `durationMs` of exactly `20000` — the `maxDuration` kill — and **no
  corresponding Postgres error of any kind**, proving their queries never reached the database
  and were sitting in a client-side queue;
- `concurrency: 2` and `concurrency: 3` on precisely those requests;
- two of them sharing one `instanceId`.

Read the logs of the layer that is failing before inferring from the logs of the layer it talks
to. Everything above this paragraph is what inference cost.

**What it was not**, each disproved rather than argued away:

- _Not pooler exhaustion._ `pg_stat_activity` showed eight backends on an idle database, all of
  them Supabase's own — none belonging to the application. The theory that drove two earlier
  fixes was never true.
- _Not starved free-tier compute._ `EXPLAIN (ANALYZE, BUFFERS)` on the statement that had been
  cancelled after two minutes: **0.123 ms**, six shared buffer hits. No amount of CPU contention
  turns that into a timeout.
- _Not the SQL._ Same measurement.

**One genuinely separate fault surfaced on the way, and it was real.** The Postgres log recorded
`process … still waiting for AccessExclusiveLock on relation 17631` — and `17631::regclass`
resolved to `users`, `17676` to `audit_log`. `TRUNCATE` takes an `AccessExclusiveLock`, and the
seed truncates `users`: a seed run against a database that was serving traffic. Postgres's lock
queue is FIFO, so while that `TRUNCATE` waited for one reader to finish, **every later reader
queued behind it**, including trivial ones. A script whose job is loading sample data took the
site down.

What turned that blip into a four-minute outage was an inversion nobody had looked at:

| Who gives up           | After |
| ---------------------- | ----- |
| Vercel (`maxDuration`) | 20 s  |
| `statement_timeout`    | 120 s |
| `lock_timeout`         | never |

Read in that order it is self-sustaining. A blocked query waits indefinitely for its lock;
Vercel kills the function at 20 s; the database, which has no idea anyone left, goes on
executing the abandoned statement — still holding its locks — for another hundred seconds. Those
orphans are what the next exclusive request waits on, which parks the next wave of readers.
**The database must give up before the client abandons it**, and it was doing the opposite.

**And one self-inflicted outage worth recording**, because the lesson is not about databases.
A deploy failed while prerendering `/admin/audit` — the one page that reads the database and
uses no request-time API of its own, so the build rendered it to discover whether it was static,
that render queried Postgres, and a slow database failed the **build**. Vercel binds environment
variables to a deployment at build time, so the failed deploy left the _previous_ deployment
live, still holding the _previous_ database password after a rotation. Every page then hit the
error boundary. A build must never depend on the database being reachable, let alone fast.

**The five changes, each defensible independently of the diagnosis:**

1. **`max: 10`** (from 1). Sized for the runtime's concurrency model — several requests per
   instance, each render querying in parallel — rather than for one request. The original
   reasoning was slot scarcity, and the arithmetic does not hold: what is scarce is Supavisor's
   pool of _server_ connections, which it manages itself and which are occupied only while a
   statement executes. Client connections into Supavisor are cheap; multiplexing them is the
   entire reason it exists.
2. **`0007_connection_timeouts.sql`** — `lock_timeout=3s` < `statement_timeout=10s` <
   `maxDuration=20s`. Set on the role rather than the database, so Supabase's own backups and
   maintenance keep their own patience, and via `current_user` because the role is `postgres` on
   Supabase and `circle` in the local container.
3. **`dynamic = "force-dynamic"` on the admin layout.** Verified by building with the database
   pointed at a dead port: the build now passes, so no database can fail a deploy again.
4. **`prefetch={false}`** on the site header and the admin nav. Both header links appear on every
   page and both are database-backed renders, so every visit anywhere speculatively ran several
   of the heaviest renders in the app for a navigation that usually never happened.
5. **`SET LOCAL lock_timeout = '3s'` before the seed's `TRUNCATE`**, so a seed fails fast instead
   of parking a live site. The operational rule it encodes: never run the truncating seed against
   a database that is serving traffic.

Generalising, since three of the four faults in this section share a shape: **a fact that is true
locally and false in deployment will not be found by reasoning, only by measuring the deployed
system.** One request per instance, no pooler between the client and Postgres, a database on the
same machine — every one of those is a local truth that the deployment quietly does not share,
and each produced a bug that was invisible in development and obvious in the logs.

---

---

## 14. Row-level security is on, with no policies

Supabase serves a REST API over the same database, reachable by anyone holding the project's
anon key — a key designed to be shipped to browsers, and therefore not a secret. With RLS
off, that API would read and write `listings`, `fields` and `category_fields` from outside
the application entirely. Every guarantee the validation trigger provides would still hold
(it is in the database), but authorization, draft privacy and the admin role check would not:
none of them would be in the path.

RLS is now enabled on all nine tables **with no policies at all**, which denies everything to
the roles that API uses. The application is unaffected because it connects as the table owner,
and an owner bypasses RLS.

The absence of policies is the design, not an oversight: deny-by-default is correct until
something legitimately needs to read through that API, at which point it gets a policy scoped
to exactly that. Verified by applying the migration to an empty database and confirming both
that RLS reports enabled on every table and that all 166 tests still pass.

---

## 15. Seller-claimed versus hub-verified attributes

Circle takes possession of every item between listing and delivery. For part of its
life a listing therefore holds two answers to the same question — what the seller said,
and what the hub measured — and the interesting product decision is what to do with the
second one.

### Two documents, never an overwrite

`listings.verified_attributes` is a second `jsonb` object with the same shape and the
same slug keys as `attributes`. The seller's claim is never touched.

The tempting alternative — correct the listing in place and log the old value — is
worse in the way that matters: it destroys the comparison. "89% verified, seller stated
92%" tells a buyer something that neither number alone does, and it is the only
presentation that stays honest when the two disagree. Overwriting silently converts a
disagreement into a platform assertion.

The product page leads with the measurement and shows the claim beneath it wherever
they differ. `additionalProperty` in the JSON-LD publishes the measured value too,
because structured data is a claim made to third parties and should carry the
best-evidenced answer available.

### Provenance is a constraint, not a column you hope gets filled

```sql
CHECK ((verified_at IS NULL AND verified_by IS NULL AND verified_attributes = '{}')
       OR (verified_at IS NOT NULL AND verified_by IS NOT NULL))
```

A verified value that cannot name who recorded it and when is just a claim in a
stronger typeface — the exact thing this feature exists to replace. There is no third
state, `verified_by` is `ON DELETE RESTRICT` so deleting an account cannot anonymise a
measurement, and clearing a verification returns the row to wholly unverified rather
than leaving a badge over an empty record.

### `verifiable` is on the assignment, like everything else contextual

What a hub can measure differs by category: battery health on a device, yes; the
seller's account of why they are selling, no. So it joins `required`, `sort`,
`prominent` and `filterable` on `category_fields` and inherits down the tree by the
same nearest-ancestor rule. Marking a field "Hub verifies" in the category editor is
what makes it appear on the verification form — no deploy, exactly as for the sell form.

### The third surface, and why it cost almost nothing

The hub's screen renders `<DynamicForm>`. Not a similar component: the same one the
seller fills in and the same one the category editor previews. The verification schema
is the seller's resolved schema passed through one pure function, and the whole feature
needed no new form code, no new validator and no new storage shape.

That is the strongest single piece of evidence for the original design. A capability
nobody planned for turned out to be a filter over rows that already existed.

Two subtleties in that filter, both in `verifiableFields`:

- **Visibility is resolved against the seller's answers, then discarded.** A warranty
  expiry the seller was never asked for is not a measurement the hub can take. Having
  decided that once, the surviving fields carry no `visibleWhen` — their conditions may
  point at fields the hub is not asked about, and a condition on an absent field
  evaluates to hidden, which would hide the very field just admitted.
- **The seller's obligations do not carry across.** `required` and `defaultValue` are
  stripped: a partial verification is a normal outcome, and a default would be the
  platform asserting a measurement nobody took. For the same reason the inputs start
  empty rather than pre-filled with the claim — pre-filling turns verification into a
  click-through.

### The write path is the sell path

`recordVerification` coerces, validates and rejects unknown keys through
`validateAttributes`, in `draft` mode. One generator, now four enforcers.

It adds one check of its own: only fields the winning assignment marks `verifiable` are
accepted, so a console bug cannot reach a category's whole attribute set through this
route. `verified_*` is not settable from a seller request either — `createListingSchema`
is a `strictObject`, so those keys are a 400 rather than something quietly ignored.

### What the trigger checks, and what it deliberately does not

Migration 0008 lifts the attribute check into `listing_attribute_violation(...)` and
runs `verified_attributes` through the identical function: active field, collected by
this category, type match, live option. One definition rather than two that drift.

It does **not** check the `verifiable` flag. That is policy belonging to the winning
assignment, in the same family as `required`, and this trigger has never judged policy —
only well-formedness and membership. Encoding it would also mean un-marking a field as
verifiable retro-invalidates every listing already verified on it, which is the
retrospective validation the design refuses everywhere else. Policy is enforced on write
by the application, where inheritance and conditional visibility are available to
evaluate it against.

### A rendering decision the screenshots forced

The queue first showed "_n_ of _m_ checked". Un-mark a field as verifiable after a
verification and that reads "5 of 4" — honest data rendered as a bug. It now shows
"_n_ checked" with "_m_ left" only when there is something left, which stays true in
every state the configuration can reach.

---

## 16. Deliberate omissions (to state in the README, not to silently skip)

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
- **Facet counts** — "RAM · 8 GB (12)". Deliberately skipped, with the reasoning and
  the exact scaling path in §17.

---

## 17. Phase 7c — buyer-side facets

The configuration now pays for itself twice. An admin ticks **Filterable** on an
assignment and a filter appears on browse: same field library, same option lists, same
slugs, no second definition of what a category collects, no code. A category invented
after the filter panel was written arrives with working filters, because the panel is
handed facets built from the resolved schema and knows nothing about what they mean —
the same argument as the one form renderer, applied to the buyer's side.

### A facet is not a form input

`render_as` answers "how does a seller give this answer" — one of N, as chips or a
dropdown. A buyer wants the opposite shape: **8 GB _or_ 12 GB**. So presentation does
not carry over. Every option-bearing field becomes the same checkbox group whatever its
widget, and a boolean becomes a two-option group rather than a switch, because "either"
has to be expressible and a switch cannot say it. Numbers and dates become a pair of
bounds.

Text and textarea get no facet at all. Containment cannot express "contains the word",
and a substring scan over `jsonb` has no index to help it — that is a search feature
wearing a facet's clothes, and shipping it as a facet would be the first quietly
unscalable thing in the app.

### The URL is the state

Nothing in the panel holds a copy of what is selected. Every control reads the query
string and every change writes a new one, so a filtered view is shareable,
bookmarkable, survives a reload and moves under the back button — and the server and
the browser cannot disagree about what is filtered, because there is only one answer
and it is in the address bar. `useOptimistic` keeps that honest and still instant: a
tick applies to the displayed query immediately and reconciles when the server render
lands.

Two consequences worth stating. The chips that remove a filter are plain server-rendered
links, so undoing a filter costs no JavaScript. And every filter change drops the
cursor: a keyset cursor points into the previous result set, so carrying it over lands
the buyer on an empty page immediately after ticking a box.

### The URL is untrusted input — validated against the registry, then dropped

Filters go through the same registry check as a write: a parameter naming a field that
is not filterable for this category, or an option that no longer exists, never becomes
a predicate. What differs is the response. A write with an unknown key is a bug and
earns a 400; a shared link whose option was archived last week is an ordinary fact of a
mutable registry, and the right answer is to apply the rest of the filter rather than
show an error page. So writes reject and reads drop, deliberately.

The parameters are namespaced `f.<slug>` and slugs are `^[a-z0-9]+(-[a-z0-9]+)*$`, so
neither the dot nor the comma separating multiple values can appear inside one, and a
facet parameter can never collide with `category` or `after`.

### Equality is containment, which is why the index choice mattered

`attributes @> '{"ram":"8gb"}'` rather than `attributes->>'ram' = '8gb'`: containment is
what the GIN index can answer. Several values within one facet are ORed as separate
containments so each stays indexable; separate facets are ANDed.

The multi-select case is the one that earns the storage decision. A listing holds
`{"accessories": ["charger", "cable"]}`, and `@> '{"accessories":["cable"]}'` is true of
it — containment reaches inside the array. "Includes a charger" needs no different
operator from "is 8 GB", no unnesting, and no second index.

Ranges are the honest exception: `min`/`max` reads the key out and compares it, which
the GIN index cannot serve. At this size it is instant; the fix at scale is an
expression index on the hot key, which is also what gives the planner statistics it
otherwise does not have inside `jsonb`. The comparison is wrapped in a `CASE` on
`jsonb_typeof` rather than a guarding `AND`, because Postgres does not promise to
evaluate the guard first and a cast that meets an unexpected value raises — which would
take the browse page down with a 500 instead of quietly not matching.

Browsing a tier walks the category tree **downward** — the mirror of the resolver's
upward walk, and for the same reason. Fields are inherited from ancestors, so a tier's
listings live in its descendants: "Electronics" reaches the handsets and laptops two
levels below, or it shows nothing at all. Deactivated descendants stay included:
deactivating a category stops new listings, it does not retire the ones already sold in
good faith.

### Counts are deliberately absent

"RAM · 8 GB (12)" is the single most useful thing missing from this panel, and it is
missing on purpose. Counting per option over `jsonb` means either a scan per facet
value or an expression index per key. At demo scale a scan is instant, which is exactly
what makes it the wrong thing to ship: it would look finished and fail at the first
real catalogue, and nothing in the UI would say so.

The path, in the order it would actually be taken:

1. **Expression indexes on hot keys** — `((attributes->>'ram'))`, one per key that
   people actually filter by. Carries its own statistics, so it fixes plan quality as
   well as speed, and makes a `GROUP BY` over one key cheap.
2. **An EAV projection table maintained by trigger** — `(listing_id, field_slug, value)`,
   written alongside the `jsonb`. Counts become an ordinary grouped query with real
   statistics; the registry and the seller flow do not change at all. This is the exit
   path §2 named, arrived at from the read side rather than the write side.
3. **An external search index** when facets, free text and relevance have to be one
   query rather than three.

The interesting thing about that ladder is that none of its rungs touch the
configuration model. The registry, the resolver, the form and the write path are
identical in all three worlds — which is the argument that the `jsonb` choice was a
storage decision and not an architectural one.

### A cursor bug the facet tests found

Testing that a filtered view pages correctly failed on the second page, with a filter
that plainly matched three rows returning one. The cause was in existing code, not the
filters: the cursor round-tripped `created_at` through a JavaScript `Date`, which holds
milliseconds where a Postgres `timestamptz` holds microseconds. The truncated bound
sorts _below_ every row it was meant to tie with, so the moment several listings shared
a timestamp — a seed, an import, a busy second — the next page came back empty. Ties are
precisely what a tie-break exists for, so the bug lived in the one case the code was
written to handle.

It is now a row comparison, `(created_at, slug) < (cursor_at::timestamptz, cursor_slug)`,
with the timestamp kept as text end to end. One predicate that matches the
`(created_at DESC, slug DESC)` ordering, which the planner can drive straight off an
index, and no lossy parse in the middle.
