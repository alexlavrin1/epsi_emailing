-- Supabase projects may grant new public-schema functions directly to browser
-- roles through default privileges. Lock the Phase 4 worker functions to the
-- backend service role explicitly.

BEGIN;

REVOKE ALL ON FUNCTION enqueue_reply_automation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION enqueue_reply_automation(UUID) FROM anon;
REVOKE ALL ON FUNCTION enqueue_reply_automation(UUID) FROM authenticated;

REVOKE ALL ON FUNCTION claim_reply_automation_run(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_reply_automation_run(UUID) FROM anon;
REVOKE ALL ON FUNCTION claim_reply_automation_run(UUID) FROM authenticated;

REVOKE ALL ON FUNCTION complete_reply_automation_run(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_reply_automation_run(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION complete_reply_automation_run(UUID, TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION fail_reply_automation_run(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_reply_automation_run(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION fail_reply_automation_run(UUID, TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION sync_automation_reply_run() FROM PUBLIC;
REVOKE ALL ON FUNCTION sync_automation_reply_run() FROM anon;
REVOKE ALL ON FUNCTION sync_automation_reply_run() FROM authenticated;

GRANT EXECUTE ON FUNCTION enqueue_reply_automation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION claim_reply_automation_run(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION complete_reply_automation_run(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fail_reply_automation_run(UUID, TEXT) TO service_role;

COMMIT;
