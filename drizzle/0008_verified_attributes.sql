-- Seller-claimed versus hub-verified attributes.
--
-- The platform takes possession of the item between listing and delivery, so for
-- part of its life a listing holds two answers to the same question: what the
-- seller said, and what the hub measured. Storing only one of them loses
-- information a buyer wants — "89%, verified" is worth more than "89%", and
-- "89% verified, seller said 92%" is worth more than either.
--
-- So the seller's claim is never overwritten. `verified_attributes` is a second
-- document with the same shape and the same keys, and the product page renders
-- the two together.
--
-- Provenance is part of the data, not decoration: a verified value that cannot
-- say who recorded it and when is exactly the sort of unfalsifiable claim this
-- feature exists to replace. The check constraint below makes that structural.

ALTER TABLE listings
  ADD COLUMN verified_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN verified_at timestamptz,
  -- `restrict`, not `set null`: deleting the account that recorded a verification
  -- must not silently turn an attributed measurement into an anonymous one.
  ADD COLUMN verified_by uuid REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE listings
  ADD CONSTRAINT listings_verified_attributes_is_object
    CHECK (jsonb_typeof(verified_attributes) = 'object'),

  -- Either wholly unverified, or verified with both a time and an actor. There is
  -- no third state, and in particular no verified value floating free of who
  -- stood behind it.
  ADD CONSTRAINT listings_verified_provenance CHECK (
    (verified_at IS NULL AND verified_by IS NULL AND verified_attributes = '{}'::jsonb)
    OR (verified_at IS NOT NULL AND verified_by IS NOT NULL)
  );

-- Which fields the hub is equipped to check is a per-category decision, exactly
-- like `required` and `prominent`: battery health is measurable on a device and
-- meaningless on a couch. It therefore belongs on the assignment, not the field.
ALTER TABLE category_fields
  ADD COLUMN verifiable boolean NOT NULL DEFAULT false;

-- The verification queue reads only the unverified ones, newest first.
CREATE INDEX listings_unverified_idx ON listings (created_at DESC)
  WHERE verified_at IS NULL;


-- ─── The second enforcer, extended ───────────────────────────────────────────
--
-- `verified_attributes` gets exactly the same treatment `attributes` already had:
-- keys must be active fields collected by the category, values must match the
-- declared type, and select values must be live options. The check was a single
-- statement inside the trigger; it becomes a function so both documents are
-- validated by one definition rather than two that can drift.
--
-- What it deliberately does not check is the `verifiable` flag itself. That is a
-- policy of the winning assignment, in the same family as `required` — and this
-- trigger has never judged policy, only well-formedness and membership. Policy is
-- enforced on write by the application, where it can be evaluated against the
-- resolved schema with inheritance and conditional visibility applied. Encoding it
-- here would also mean un-marking a field as verifiable retro-invalidates every
-- listing already verified on it, which is the retrospective validation this
-- design refuses everywhere else.

CREATE OR REPLACE FUNCTION listing_attribute_violation(
  target_category_id integer,
  submitted_attributes jsonb,
  prior_attributes jsonb
) RETURNS text
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE ancestry AS (
    SELECT id, parent_id FROM categories WHERE id = target_category_id
    UNION ALL
    SELECT c.id, c.parent_id FROM categories c JOIN ancestry a ON c.id = a.parent_id
  ),
  -- Membership only: any assignment anywhere up the tree means this category
  -- collects the field. Which assignment *won* matters for required-ness and
  -- ordering, neither of which this judges.
  resolved AS (
    SELECT DISTINCT cf.field_id
      FROM ancestry a
      JOIN category_fields cf ON cf.category_id = a.id
  ),
  allowed AS (
    SELECT f.id, f.slug, f.type
      FROM resolved r
      JOIN fields f ON f.id = r.field_id
     WHERE f.archived_at IS NULL
  ),
  -- Only keys whose value actually changed, which is what keeps a configuration
  -- change from retro-invalidating rows that were valid when written.
  submitted AS (
    SELECT e.key, e.value
      FROM jsonb_each(submitted_attributes) e
     WHERE e.value IS DISTINCT FROM (prior_attributes -> e.key)
  ),
  violations AS (
    SELECT CASE
      WHEN a.slug IS NULL THEN
        format('attribute "%s" is not an active field collected by this category', s.key)

      WHEN a.type IN ('text', 'textarea') AND jsonb_typeof(s.value) <> 'string' THEN
        format('attribute "%s" must be a string, got %s', s.key, jsonb_typeof(s.value))

      WHEN a.type = 'number' AND jsonb_typeof(s.value) <> 'number' THEN
        format('attribute "%s" must be a number, got %s', s.key, jsonb_typeof(s.value))

      WHEN a.type = 'boolean' AND jsonb_typeof(s.value) <> 'boolean' THEN
        format('attribute "%s" must be a boolean, got %s', s.key, jsonb_typeof(s.value))

      WHEN a.type = 'date' AND (
             jsonb_typeof(s.value) <> 'string'
             OR (s.value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           ) THEN
        format('attribute "%s" must be a YYYY-MM-DD date', s.key)

      -- Select values must be a *live* option of that exact field. This is the
      -- referential integrity a foreign key would give us if the value lived in a
      -- column instead of a jsonb document.
      WHEN a.type = 'single_select' AND (
             jsonb_typeof(s.value) <> 'string'
             OR NOT EXISTS (
                  SELECT 1 FROM field_options o
                   WHERE o.field_id = a.id
                     AND o.archived_at IS NULL
                     AND o.value_slug = s.value #>> '{}'
                )
           ) THEN
        format('attribute "%s" is not a live option of that field', s.key)

      WHEN a.type = 'multi_select' AND (
             jsonb_typeof(s.value) <> 'array'
             OR EXISTS (
                  SELECT 1 FROM jsonb_array_elements(s.value) el
                   WHERE jsonb_typeof(el) <> 'string'
                      OR NOT EXISTS (
                           SELECT 1 FROM field_options o
                            WHERE o.field_id = a.id
                              AND o.archived_at IS NULL
                              AND o.value_slug = el #>> '{}'
                         )
                )
           ) THEN
        format('attribute "%s" must be an array of live option slugs', s.key)

      ELSE NULL
    END AS msg
    FROM submitted s
    LEFT JOIN allowed a ON a.slug = s.key
  )
  SELECT msg FROM violations WHERE msg IS NOT NULL LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION validate_listing_attributes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  -- Left as '{}' when every key must be revalidated: on INSERT, and on a change of
  -- category, where the question stops being "is this value still legal" and
  -- becomes "does this category collect this field at all".
  prior jsonb := '{}'::jsonb;
  prior_verified jsonb := '{}'::jsonb;
  violation text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.category_id = OLD.category_id THEN
    prior := OLD.attributes;
    prior_verified := OLD.verified_attributes;
  END IF;

  violation := listing_attribute_violation(NEW.category_id, NEW.attributes, prior);
  IF violation IS NOT NULL THEN
    RAISE EXCEPTION 'invalid listing attributes: %', violation
      USING ERRCODE = 'check_violation';
  END IF;

  violation := listing_attribute_violation(
    NEW.category_id, NEW.verified_attributes, prior_verified
  );
  IF violation IS NOT NULL THEN
    RAISE EXCEPTION 'invalid verified attributes: %', violation
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER listings_validate_attributes ON listings;

CREATE TRIGGER listings_validate_attributes
  BEFORE INSERT OR UPDATE OF attributes, verified_attributes, category_id ON listings
  FOR EACH ROW EXECUTE FUNCTION validate_listing_attributes();
