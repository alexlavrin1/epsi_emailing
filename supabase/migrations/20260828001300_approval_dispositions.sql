-- Phase 4, slice 2: explicit approval-queue dispositions.
-- Operators may skip a prepared reply or cancel it, but cannot mutate the
-- underlying tables directly. Both decisions close the draft without sending
-- and append an audit event in the same transaction.

BEGIN;

CREATE OR REPLACE FUNCTION dashboard_dispose_email_reply(
  target_reply_id UUID,
  target_decision TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target_reply operator_email_replies%ROWTYPE;
DECLARE resulting_run_status TEXT;
BEGIN
  IF target_decision IS NULL OR target_decision NOT IN ('skip', 'cancel') THEN
    RAISE EXCEPTION 'Invalid reply disposition';
  END IF;

  SELECT * INTO target_reply
  FROM operator_email_replies
  WHERE id = target_reply_id
  FOR UPDATE;

  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target_reply.organization_id) THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;
  IF target_reply.status NOT IN ('draft', 'failed') THEN
    RAISE EXCEPTION 'Only draft or failed replies can be closed';
  END IF;

  UPDATE operator_email_replies
  SET status = 'cancelled', queued_by_user_id = NULL, queued_at = NULL,
      last_error = NULL
  WHERE id = target_reply_id;

  IF target_reply.automation_run_id IS NOT NULL THEN
    resulting_run_status := CASE WHEN target_decision = 'skip' THEN 'stopped' ELSE 'cancelled' END;
    UPDATE automation_runs
    SET status = resulting_run_status, completed_at = NOW(), last_error = NULL
    WHERE id = target_reply.automation_run_id
      AND organization_id = target_reply.organization_id
      AND status IN ('waiting_approval', 'failed', 'cancelled');
    UPDATE automation_run_steps
    SET status = resulting_run_status, completed_at = NOW(), last_error = NULL
    WHERE run_id = target_reply.automation_run_id
      AND status IN ('waiting_approval', 'failed', 'cancelled');
  END IF;

  INSERT INTO audit_events (
    organization_id, actor_user_id, event_type, target_type, target_id, metadata
  ) VALUES (
    target_reply.organization_id,
    auth.uid(),
    CASE WHEN target_decision = 'skip' THEN 'email.reply.skipped' ELSE 'email.reply.cancelled' END,
    'operator_email_reply',
    target_reply_id::TEXT,
    jsonb_build_object(
      'previous_status', target_reply.status,
      'prospect_reply_id', target_reply.prospect_reply_id,
      'automation_run_id', target_reply.automation_run_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION dashboard_dispose_email_reply(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_dispose_email_reply(UUID, TEXT) TO authenticated;

COMMIT;
