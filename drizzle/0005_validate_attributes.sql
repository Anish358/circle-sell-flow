-- The second enforcer.
--
-- The API already validates attributes with a Zod schema generated from the
-- registry. This does the same job again, in SQL, reading the same registry rows —
-- so a writer that bypasses the application (an admin script, a future mobile
-- client, a 2am psql session, an AI-generated endpoint) still cannot store
-- attributes that contradict the configuration.
--
-- Note what it does NOT check: whether required fields are present. Completeness is
-- a property of publishing, not of the row — drafts are deliberately incomplete.
-- This trigger only ensures that whatever *is* stored is well-formed and belongs to
-- the category.
--
-- The one subtlety worth reading carefully is the `submitted` CTE. It considers only
-- keys whose value actually changed, which is what keeps a configuration change from
-- retro-invalidating listings that were valid when written. Archive an option and
-- the listings that chose it stay editable; change that value to the archived option
-- and you are refused. Validation on write, never in retrospect.
--
-- With one exception: re-categorising a listing revalidates every attribute, because
-- the question is no longer "is this value still legal" but "does this category
-- collect this field at all". Without that, moving a handset into Furniture would
-- carry its storage and battery health along unchallenged.

CREATE OR REPLACE FUNCTION validate_listing_attributes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  -- Left as '{}' when every key must be validated: on INSERT, and on a change of
  -- category. Otherwise it holds the previous attributes so unchanged values are
  -- left alone.
  prior jsonb := '{}'::jsonb;
  violation text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.category_id = OLD.category_id THEN
    prior := OLD.attributes;
  END IF;

  WITH RECURSIVE ancestry AS (
    SELECT id, parent_id FROM categories WHERE id = NEW.category_id
    UNION ALL
    SELECT c.id, c.parent_id FROM categories c JOIN ancestry a ON c.id = a.parent_id
  ),
  -- Membership only: any assignment anywhere up the tree means this category
  -- collects the field. Which assignment *won* matters for required-ness and
  -- ordering, neither of which this trigger judges.
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
  submitted AS (
    SELECT e.key, e.value
      FROM jsonb_each(NEW.attributes) e
     WHERE e.value IS DISTINCT FROM (prior -> e.key)
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
  SELECT msg INTO violation FROM violations WHERE msg IS NOT NULL LIMIT 1;

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION 'invalid listing attributes: %', violation
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER listings_validate_attributes
  BEFORE INSERT OR UPDATE OF attributes, category_id ON listings
  FOR EACH ROW EXECUTE FUNCTION validate_listing_attributes();
