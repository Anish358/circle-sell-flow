-- A category's name appears in the form-schema contract, as the breadcrumb and as
-- the "inherited from" label on every field it contributes. Renaming one therefore
-- changes the response body — but the original trigger only fired on re-parenting,
-- so the ETag would keep matching and clients would serve a stale name indefinitely.
--
-- Descendants are included because the rename shows up in their breadcrumbs too,
-- and bump_config_version already walks the subtree.
--
-- Still no recursion: this trigger's own update touches only config_version, which
-- the WHEN clause below ignores.

-- Renamed from bump_on_reparent, which no longer describes what it covers.
CREATE OR REPLACE FUNCTION bump_on_category_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM bump_config_version(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$;

DROP TRIGGER categories_bump_config_version ON categories;

CREATE TRIGGER categories_bump_config_version
  AFTER UPDATE ON categories
  FOR EACH ROW
  WHEN (
    OLD.parent_id IS DISTINCT FROM NEW.parent_id
    OR OLD.name IS DISTINCT FROM NEW.name
  )
  EXECUTE FUNCTION bump_on_category_change();

DROP FUNCTION bump_on_reparent();
