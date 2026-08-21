-- Audit history must only be written as part of guarded server-side actions.
-- Security-definer operator RPCs continue to append events transactionally;
-- browser roles retain tenant-scoped SELECT access only.

BEGIN;

DROP POLICY IF EXISTS audit_actor_insert ON audit_events;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_events FROM anon;
GRANT SELECT ON audit_events TO authenticated;

COMMENT ON TABLE audit_events IS
  'Append-only operator history. Browser roles may read tenant-scoped events but cannot write them directly.';

COMMIT;
