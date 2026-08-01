-- The database must give up before the client abandons it.
--
-- The failure this fixes was not a slow query. A `SELECT` that plans and executes in 0.1 ms
-- was cancelled after two minutes, because it was queued behind a request for an exclusive
-- lock — and Postgres's lock queue is FIFO, so one pending exclusive request parks every
-- later reader behind it, however trivial those readers are.
--
-- What turned that blip into an outage was the ordering of the three patience settings:
--
--     Vercel function (maxDuration)     20s
--     statement_timeout                120s   -- the inherited database default
--     lock_timeout                    never
--
-- Read it in that order and the cycle is obvious. A blocked query waits indefinitely for its
-- lock. Vercel kills the function at 20s and the client socket dies. The database, which has
-- no idea anyone left, goes on executing the abandoned statement — still holding its locks —
-- for another hundred seconds. Those orphans are what the next exclusive request waits on,
-- which parks the next wave of readers, which are in turn abandoned at 20s. The pileup
-- sustains itself long after whatever started it has gone.
--
-- Reversing the order breaks it. A query that cannot get its lock in 3 seconds fails instead
-- of queueing; every statement is dead by 10 seconds, comfortably before the function is
-- killed at 20; and a transaction orphaned by a frozen serverless instance is reaped rather
-- than holding locks until someone notices. The failure becomes one visible error on one
-- request, which is what a lock conflict should cost.
--
-- Set on the role, not the database: a database-wide statement_timeout would also apply to
-- Supabase's own maintenance and backups, which are entitled to take longer than ten seconds.
-- `current_user` rather than a literal name, because the role is `postgres` on Supabase and
-- `circle` in the local container.
--
-- Role settings apply from the next session onward, so this migration is not governed by
-- what it sets. A future migration that genuinely needs longer should say so for itself with
-- `SET LOCAL statement_timeout = 0`.

DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I SET lock_timeout = %L', current_user, '3s');
  EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', current_user, '10s');
  EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', current_user, '15s');
END
$$;
