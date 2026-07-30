-- Three things the database enforces on its own, because the registry is edited at
-- runtime by non-engineers and application code is not the only writer.
--
--   1. updated_at is maintained by the database, not by whichever client wrote.
--   2. A field's slug and type are immutable — the two changes that would
--      silently corrupt every listing already holding that field's values.
--   3. categories.config_version tracks the *resolved* schema, inheritance
--      included, so a change to a parent invalidates its children's caches too.


-- ─── 1. updated_at ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- audit_log is deliberately absent: it is append-only and stamps its own `at`.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories', 'field_groups', 'fields', 'field_options',
    'category_fields', 'users', 'listings', 'listing_images'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t
    );
  END LOOP;
END;
$$;


-- ─── 2. Immutable identities ─────────────────────────────────────────────────

-- A field's slug is the key inside listings.attributes, and its type is the
-- contract every stored value was validated against. Renaming or retyping in
-- place cannot be a data migration anyone can write: nothing can reinterpret
-- "eight GB" as a number. Both are therefore refused outright — change the label,
-- or create a new field.
CREATE OR REPLACE FUNCTION reject_field_identity_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION
      'fields.slug is immutable (field %, slug %): listings.attributes is keyed by it. Change the label instead.',
      OLD.id, OLD.slug USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION
      'fields.type cannot change in place (field %, % -> %): existing values were validated against the old type. Create a new field and backfill.',
      OLD.id, OLD.type, NEW.type USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER fields_reject_identity_change
  BEFORE UPDATE ON fields
  FOR EACH ROW EXECUTE FUNCTION reject_field_identity_change();

-- Same argument one level down: a listing stores the option's value_slug.
CREATE OR REPLACE FUNCTION reject_option_slug_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.value_slug IS DISTINCT FROM OLD.value_slug THEN
    RAISE EXCEPTION
      'field_options.value_slug is immutable (option %, slug %): listings store it. Change the label instead.',
      OLD.id, OLD.value_slug USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER field_options_reject_slug_change
  BEFORE UPDATE ON field_options
  FOR EACH ROW EXECUTE FUNCTION reject_option_slug_change();


-- ─── 3. config_version ───────────────────────────────────────────────────────

-- Bumps the given categories and every descendant, because a category's resolved
-- field set includes everything its ancestors assign. Changing a parent therefore
-- has to invalidate the whole subtree, not just the row that changed.
CREATE OR REPLACE FUNCTION bump_config_version(seed_ids integer[]) RETURNS void
LANGUAGE sql AS $$
  WITH RECURSIVE subtree AS (
    SELECT id FROM categories WHERE id = ANY(seed_ids)
    UNION
    SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
  )
  UPDATE categories
     SET config_version = config_version + 1
   WHERE id IN (SELECT id FROM subtree);
$$;

-- Assignments: the direct case.
CREATE OR REPLACE FUNCTION bump_on_assignment_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- On UPDATE both rows exist and category_id may differ, so bump whatever we have.
  PERFORM bump_config_version(
    ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.category_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.category_id END
    ]) AS x WHERE x IS NOT NULL)
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER category_fields_bump_config_version
  AFTER INSERT OR UPDATE OR DELETE ON category_fields
  FOR EACH ROW EXECUTE FUNCTION bump_on_assignment_change();

-- A field's definition changed, so every category that assigns it renders
-- differently. `archived_at` counts: archiving removes the field from new forms.
CREATE OR REPLACE FUNCTION bump_on_field_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM bump_config_version(
    ARRAY(SELECT category_id FROM category_fields WHERE field_id = NEW.id)
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER fields_bump_config_version
  AFTER UPDATE OF label, render_as, config, placeholder, help_text, archived_at ON fields
  FOR EACH ROW EXECUTE FUNCTION bump_on_field_change();

-- An option was added, relabelled, reordered or archived: the choices on offer
-- changed everywhere that field is used.
CREATE OR REPLACE FUNCTION bump_on_option_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM bump_config_version(
    ARRAY(
      SELECT category_id FROM category_fields
       WHERE field_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.field_id ELSE NEW.field_id END
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER field_options_bump_config_version
  AFTER INSERT OR UPDATE OR DELETE ON field_options
  FOR EACH ROW EXECUTE FUNCTION bump_on_option_change();

-- Re-parenting silently swaps a category's entire inherited field set — the most
-- consequential single edit available in the admin console.
--
-- No infinite recursion: the WHEN clause is false for the config_version-only
-- update this trigger itself causes.
CREATE OR REPLACE FUNCTION bump_on_reparent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM bump_config_version(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$;

CREATE TRIGGER categories_bump_config_version
  AFTER UPDATE ON categories
  FOR EACH ROW
  WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION bump_on_reparent();

-- Group labels and order are part of the rendered form.
CREATE OR REPLACE FUNCTION bump_on_group_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM bump_config_version(
    ARRAY(SELECT DISTINCT category_id FROM category_fields WHERE group_id = NEW.id)
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER field_groups_bump_config_version
  AFTER UPDATE OF label, sort ON field_groups
  FOR EACH ROW EXECUTE FUNCTION bump_on_group_change();
