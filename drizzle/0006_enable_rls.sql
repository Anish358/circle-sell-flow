-- Row-level security on every table, with no policies.
--
-- This is a real hole, not a dashboard warning to silence. Supabase exposes a REST API over
-- the same database, reachable by anyone holding the project's anon key — a key that is
-- designed to be shipped to browsers and is therefore not a secret. With RLS off, that API
-- would happily read and write `listings`, `fields` and `category_fields` from outside the
-- application entirely, which would make every guarantee the validation trigger provides
-- irrelevant: nothing would have to come through our code at all.
--
-- Enabling RLS with **no policies** denies everything to the roles that API uses
-- (`anon` and `authenticated`). The application is unaffected: it connects as the table
-- owner, and an owner bypasses RLS. So this closes the API door without touching ours.
--
-- Policies get added the day something legitimately needs to read through that API. Until
-- then, "deny by default" is the correct posture and the absence of policies is the point,
-- not an oversight.

ALTER TABLE categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_groups    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fields          ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_options   ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_images  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;
