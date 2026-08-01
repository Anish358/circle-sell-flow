# Edge cases

A schema that non-engineers can edit at runtime, while data already exists against
older versions of it, has a long tail of cases that quietly corrupt data or produce
forms nobody can submit. This is that tail, worked through deliberately rather than
discovered later: **39 handled, 2 deferred with a reason.** Each line says what the
case is, what the system does, and where to look.

Nothing here is silent. A case that was skipped says so and says why.

---

## A. The lifecycle of an editable schema

**1. Deleting a field that has values.** There is no hard-delete path anywhere.
`setFieldArchived` sets `archived_at`; the form resolver filters archived fields out
of new forms and the display resolver deliberately does not, so existing listings keep
rendering them. The archive confirmation states the blast radius first — how many
categories stop collecting it, how many listings keep their value — from
`getFieldUsage`. `blast-radius.db.test.ts`, `display.db.test.ts`.

**2. Renaming a field or an option.** Free, and provably so: values reference
immutable slugs and option slugs, and `label` is display-only. `updateField` and
`updateFieldOption` accept a label and nothing else, and the slug is refused by a
trigger as well as being absent from the form. `field-options.db.test.ts` renames an
option and asserts the listing row is untouched while the page shows the new label.

**3. Changing a field's type.** Forbidden. Nothing can reinterpret `"eight GB"` as a
number, so the answer is a new field and an optional backfill — the discipline a real
migration system imposes. Not present in `updateField`'s input, and independently
refused by an immutability trigger so a hand-written `UPDATE` cannot do it either.

**4. Removing a dropdown option that listings use.** Archive it. The resolver's
lateral join filters `archived_at IS NULL` so nobody new can choose it; the display
query deliberately does not, so a listing keeps rendering the label it was given.
`getOptionUsage` counts holders first, including inside multi-select arrays.

**5. Making a field required when listings already exist.** Existing listings are
**never** re-validated and never become invalid — validation happens on write, and a
configuration change does not reach backwards. Because that is reassuring but
invisible, the Required toggle states the count before writing anything: _"4 of 7
existing listings have no answer. Those listings stay live and stay valid."_
Completeness is then **derived on read** by `missingRequiredFields` — never stored,
never a status, never a reason to hide a listing — and shown on the product page to
its owner only, worded differently for a draft than for a published listing.
`completeness.test.ts`.

**6. Detaching is not archiving.** Two verbs, two blast radii, two confirmations in
different words. `detachField` removes one category's assignment and leaves the field
in the library; the values already stored keep appearing under "Additional details".
Detaching also re-validates the category's resolved schema, because it can break a
sibling field's visibility condition.

**7. Config versioning.** `categories.config_version` is bumped by a trigger across
the whole subtree, not by application code, so any writer bumps it. It drives the
form-schema `ETag` and is recorded on each listing as `schema_version`.

**8. Audit log.** `recordAudit` on every mutation, rendered at `/admin/audit`, with
actor, action, entity and a before/after document. For a re-categorisation, the
`before` document is the only surviving copy of the answers the move removed.

## B. Validation

**9. One definition, several enforcers.** `buildAttributesSchema` generates the Zod
schema from the registry and is imported by the browser form and by the API; a
Postgres trigger reading the same registry rows in SQL is the third enforcer. There is
no hand-written second validator anywhere, which is the only way three enforcers stay
in agreement.

**10. Rejecting the unknown.** `z.strictObject` over exactly the resolved fields, so
unknown keys are rejected rather than ignored — and the key count is bounded by the
schema itself. Mass assignment is handled by omission: `status`, `seller_id`, `slug`,
`schema_version` and the `verified_*` columns are absent from `createListingSchema`
and come from the session or the registry. The trigger rejects unknown keys
independently.

**11. Coercion and empty semantics.** Decided once, centrally: one `coerceValue` and
one `isBlank` in `validation.ts`. `""`, `null` and absent all mean unanswered; `[]`
from a multi-select is an answer; `"8,000"` in Indian digit grouping parses; `NaN` and
`Infinity` are refused because they round-trip through JSON as `null`.
`validation.test.ts`, `input-schema.test.ts`.

**12. Validating the validation config itself.** An admin can otherwise save a field
no seller can satisfy. `validateFieldDefinition` rejects `min > max`,
`maxLength < minLength`, a negative length, a non-positive step, an illegal
type-to-presentation pairing, a select with no options, options on a type that cannot
have them, and a **step that cannot reach the stated maximum** (0–100 in threes stops
at 99, and the browser then refuses the maximum the label promises — compared
float-safely rather than with a modulo). `validateResolvedSchema` additionally rejects
a default value the field itself would reject.

**13. Dead fields.** A required field behind a condition that can never be true is a
form nobody can submit, and nothing else would catch it. `findUnsatisfiable` runs to a
fixpoint — a field behind an unreachable field is itself unreachable — and a required
one raises `dead_required_field`, rolling the assignment back.

**14. The schema moved while the seller was typing.** The form sends the
`config_version` it rendered. The API never validates against it — validation is
always against the current schema — but returns `schemaChanged`, so the flow can say
the form changed rather than dumping bare errors. A restored draft written against an
older version says so too.

## C. Conditional fields

**15. One predicate, both sides.** `visibility.ts` holds one rule shape and one
evaluator, imported by the renderer to show and hide, and by the write path to decide
required-ness and stripping. A second copy of this logic is how a form ends up
disagreeing with the API that receives it.

**16. Stripping hidden values.** Answer "under warranty: yes", fill the expiry, then
change to "no": without stripping, the row asserts both that there is no warranty and
that it expires next March. `stripHiddenValues` runs server-side before validation on
every write, because the client is bypassable. `visibility.test.ts`.

**17. Required-if.** A hidden field is never required, however its assignment is
configured; requirement is judged against the state actually submitted.
`isEffectivelyRequired` is used by the form, the write path and the completeness
derivation, so all three agree by construction.

**18. Cycles.** A shows B shows A saves cleanly and hides both fields forever.
`findCycles` walks the visibility graph depth-first and reports the loop itself, at
config-save time. The evaluator is independently written not to hang on one.

**19. Defaults on hidden fields.** A configured default seeds the form, and stripping
runs on submit — so a default for a field that ended up hidden can never become a
stored answer to a question nobody was asked.

**20. Chains.** C depends on B depends on A. `computeVisibleFields` iterates to a
fixpoint and a condition on a hidden field always fails, so hiding A cascades to C
without the cascade being special-cased.

## D. The category graph

**21. Inheritance conflicts.** Parent and child both assigning the same field is
resolved by **nearest ancestor wins** — `DISTINCT ON (cf.field_id) ORDER BY
cf.field_id, a.distance`. The sample data exercises it: Purchase Date is optional on
Electronics and required on Mobile Phone. `resolve.db.test.ts`.

**22. Re-parenting a category.** The one edit whose effect is invisible from the row
being edited: the category's own assignments do not change, yet its inherited set is
swapped wholesale. The move dialog previews which fields would arrive, which would
leave, and how many live listings hold a value for a departing one — re-running on
every change of destination, so an admin can explore and change their mind. Cycles are
refused server-side and never offered in the list.

**23. Re-categorising a listing.** Its attributes may not exist in the new category.
The choice here is **drop with explicit confirmation**, and it was made by the schema
before any UI existed: the attribute trigger revalidates _every_ key when
`category_id` changes, precisely so a handset moved into Furniture cannot keep
asserting a battery health. `/admin/listings` previews every value that will not
survive — with its formatted value — and every value that will; shared fields survive
for free, because Purchase Date is one field assigned to both roots. The audit row
keeps what was removed. `listings.db.test.ts`.

**24. Deleting a category with listings.** There is no delete action, and the foreign
key is `onDelete: "restrict"`, so the database refuses it too. Deactivation is the
offered verb: it stops new listings without hiding the ones already sold in good
faith.

**25. Switching category mid-draft.** Shared library fields survive the move —
answering RAM for a handset and switching to Laptop keeps the answer, because it is
the _same field_, not two coincidentally similar ones. `carryOverValues` returns kept
and dropped separately so the seller is told what is about to be lost rather than
having it vanish.

**26. Field reuse forces one shared type.** One category wanting RAM as a select and
another as a free-entry number cannot be one field: assignment overrides cover policy
and presentation, never type. Stated rather than solved, because the alternative is
two fields with one meaning and a split filter. See DECISIONS §7.

## E. Data hygiene

**27. Money.** `price_paise bigint`, never a float; a `CHECK` for `> 0` and a sane
upper bound; currency explicit and constrained to `^[A-Z]{3}$`; rupees converted to
paise in exactly one place, on write.

**28. Dates.** A purchase date is a calendar `date` with no timezone; `created_at` is
`timestamptz`. Future purchase dates are rejected by a per-field `maxToday` flag, and
battery health is clamped 0–100 by that field's own config rather than by a global
rule about numbers. Hub timestamps render in `Asia/Kolkata`; a calendar date is
formatted as UTC so it cannot drift by a day.

**29. Text.** Title bounds are `char_length` in a `CHECK`, so they count characters
rather than bytes and emoji behave; `btrim` in the same constraint rejects
whitespace-only titles that a naive `NOT NULL` would accept; descriptions keep their
paragraphs with `whitespace-pre-line`; cards truncate with `line-clamp-2` so a ragged
grid cannot read as broken.

**30. XSS, including the non-obvious hole.** React escapes JSX, which is why seller
text needs no thought anywhere else — but it does **not** escape the contents of a
`<script type="application/ld+json">` tag, so a listing titled `</script><script>…`
would execute. `serialiseForScriptTag` escapes `<`, `>`, `&`, U+2028 and U+2029 as
unicode sequences: equivalent JSON for any parser, impossible early `</script>`.
`json-ld.test.ts` feeds it a title that tries exactly that.

**31. Images — deferred (uploads).** The rendering half is complete and exercised by
the sample data: ordering by `sort`, the primary image as `sort = 0` rather than a
flag two rows could both claim, alt text, and a designed placeholder for listings with
no photo. What is missing is the upload path — object storage, a signed-upload route,
MIME sniffing rather than extension trust, dimension and size caps, and HEIC/EXIF
handling. Self-contained work, stated here rather than half-built.

**32. Old-slug redirects — deferred, because the case cannot arise.** Slugs are unique
and stable, and there is no listing-edit path at all, so no title change can orphan a
URL. Collisions on create are handled with a random suffix rather than a counter,
which would need a lock to be correct when two sellers submit the same title at once.
When editing lands, the rule is: keep the slug, or keep the old one and 301.

## F. Operations, concurrency, security

**33. Reorder concurrency.** Two admins reordering at once is a lost-update race.
Reordering is buttons rather than drag-and-drop, and the swap is two updates in one
transaction so it cannot half-apply — which also makes it keyboard- and
screen-reader-operable as a side effect.

**34. Idempotent creation.** A double-tapped submit on a flaky mobile connection sends
the same request twice. A client-supplied idempotency key with a unique constraint
behind it turns the second into a lookup: the pre-check handles the common case, the
constraint handles the genuine race, and the loser resolves to the winner's row. A
replay returns 200 rather than 201, so "nothing new was created" is visible in the
status line. `create.db.test.ts`.

**35. Authorization boundaries.** `requireAdmin()` runs inside every mutation and
every read exported from a `"use server"` module — not only in the layout, because a
server action is its own callable endpoint and does not run the layout that rendered
its form. The role is read from the user row on every request, never from the cookie.
Drafts are visible only to their seller and return 404 rather than 403, since telling
a stranger that a listing exists but is hidden is itself a small leak.

**36. The hot endpoint.** The form-schema endpoint is fetched on every open of the
sell flow and changes rarely, so it is validated by `ETag` — `slug-vN`, keyed on
`config_version` — with `max-age=0, must-revalidate` so a config change is visible on
the very next request. A stale window would be wrong here: the admin console renders
a live preview of this exact response while someone is editing.

**37. Draft lifecycle, two validation modes.** One generated schema, two modes:
`draft` skips required-ness, `publish` enforces it. The database trigger deliberately
never checks required-ness at all, because completeness is a property of publishing
rather than of a row.

**38. Pagination stability.** Keyset rather than `OFFSET`, because on a marketplace
new listings arrive constantly and an offset silently duplicates and skips rows. The
tie-break was subtly broken until the facet tests caught it: the cursor round-tripped
`created_at` through a JavaScript `Date` (milliseconds) where Postgres holds
microseconds, so the truncated bound sorted _below_ every row it was meant to tie
with and the second page came back empty whenever timestamps matched — exactly the
case the tie-break exists for. It is now a row comparison,
`(created_at, slug) < (cursor::timestamptz, slug)`, with the timestamp kept as text
end to end. `facets.db.test.ts` asserts the two pages reassemble into the unpaged
result.

**39. N+1 on the busiest page.** Cards read common columns only — nothing on browse
touches `attributes` unless the buyer filters — and the primary image is a correlated
subquery rather than a join that would multiply rows and need de-duplicating. One
query per page, and no form schema resolved.

## G. Generated UI and testing

**40. Accessibility of generated forms.** This is where generated UI fails
systematically, because nobody remembers the twentieth field type. All of it lives in
one `FieldShell`, so every field — including ones an admin invents next year — gets it
for free: `label`/`for` on single controls, `fieldset`/`legend` for radio and checkbox
groups, `aria-describedby` linking help text and errors, `aria-invalid`, errors as
`role="alert"` so they are announced when they appear, "required" announced rather
than left as a bare asterisk, and focus moved to the error summary on a failed submit.

**41. Testing a system with no fixed schema.** Tests are table-driven over field
**types**, not categories — asserting "Mobile Phone renders correctly" would be
testing the sample data, and the whole claim is that no code knows what a Mobile Phone
is. The rest cover the logic that is genuinely tricky: conditional visibility,
required-if, hidden-value stripping, cycle rejection, unknown-key rejection, config
validation, archive-in-use, orphaned values after a config change, idempotent
creation, and facet parsing. Plus one mechanical guard: a test that walks `src/` and
fails the build if a category name appears in application code, which is the brief's
own prohibition enforced rather than asserted. It has fired twice on real code, which
is the argument for it being a test rather than a note.

## Also swept

**Rate limiting.** Listing creation is limited to 10 per minute per seller by a
sliding-window limiter keyed on the session's seller id, returning 429 with
`Retry-After`, checked before the body is read so a flood costs nothing. Honest about
what it is: in-memory, therefore per-instance on serverless — a safety valve against a
retry loop, not a control against a determined attacker. The same shape moves to Redis
by changing one file. `rate-limit.test.ts`.

**States.** Loading skeletons on every route that queries; one root error boundary
that shows a digest rather than a message, because a server-side error can carry a
connection string; empty states for both "nothing listed yet" and "nothing matches
these filters"; and a custom 404 that is deliberately silent about _why_, since
`notFound()` is also what somebody else's draft returns.

One detail worth stating rather than leaving to be discovered: a missing listing
responds **200**, not 404. That is documented framework behaviour — the response is
streamed, so headers are committed before `notFound()` runs, and Next injects
`<meta name="robots" content="noindex">` into the 404 HTML instead (present on a
missing listing, absent on a real one). Indexation is therefore prevented, though some
crawlers will log it as a soft 404. A hard status needs an existence check ahead of the
body, which means a database lookup on the hot path for a compliance nicety — so it is
deliberately not done.

**Sample data.** 17 listings across all three leaf categories — 7 handsets, 5 laptops,
5 sofas — spread over conditions, cities and price bands, and chosen so every facet
actually partitions the set: four storage tiers, six RAM sizes, battery health from 78
to 100, four sofa materials, pet-friendly on both sides. One draft and one sold
listing, so the states that are hidden from browse are visible to someone looking for
them, and five with hub verifications so the claimed-versus-measured display has
something to show. Five carry line-art SVGs, one of them two images to exercise the
gallery; the rest keep the designed placeholder, because that is a real state worth
seeing. No invented photography and no invented metrics.
