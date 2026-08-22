-- Phase 5, slice 6: guarded, idempotent retries for failed draft preparation.
-- Delivery failures keep using the approval queue so an existing approved reply
-- is retried instead of creating a duplicate automation draft.

BEGIN;

ALTER TABLE automation_runs
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0
  CHECK (retry_count BETWEEN 0 AND 3);
ALTER TABLE automation_runs
  ADD COLUMN IF NOT EXISTS last_retried_at TIMESTAMPTZ;
ALTER TABLE automation_runs
  ADD COLUMN IF NOT EXISTS last_retried_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION dashboard_automation_retries_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION dashboard_retry_automation_run(target_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target automation_runs%ROWTYPE;
DECLARE next_retry_count INTEGER;
BEGIN
  SELECT * INTO target FROM automation_runs WHERE id = target_run_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target.organization_id) THEN
    RAISE EXCEPTION 'Automation run not found';
  END IF;
  IF target.status <> 'failed' THEN RAISE EXCEPTION 'Only failed automation runs can be retried'; END IF;
  IF target.retry_count >= 3 THEN RAISE EXCEPTION 'Automation retry limit reached'; END IF;
  IF EXISTS (SELECT 1 FROM operator_email_replies WHERE automation_run_id = target.id) THEN
    RAISE EXCEPTION 'Delivery failures must be retried from the approval queue';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM automation_workflows
    WHERE id = target.workflow_id AND organization_id = target.organization_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'Workflow must be active before retrying'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM automation_runtime_controls
    WHERE organization_id = target.organization_id AND NOT globally_paused
  ) THEN RAISE EXCEPTION 'Automation runtime is paused or unavailable'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM prospect_replies reply
    JOIN prospects prospect ON prospect.id = reply.prospect_id
    WHERE reply.id = target.trigger_ref_id
      AND reply.prospect_id = target.prospect_id
      AND prospect.status = 'active'
      AND reply.outreach_send_id IS NOT NULL
      AND reply.gmail_message_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'Reply context is no longer eligible for automation'; END IF;

  next_retry_count := target.retry_count + 1;
  UPDATE automation_runs
  SET status = 'queued', scheduled_for = NOW(), started_at = NULL, completed_at = NULL,
      last_error = NULL, retry_count = next_retry_count,
      last_retried_at = NOW(), last_retried_by_user_id = auth.uid()
  WHERE id = target.id;
  UPDATE automation_run_steps
  SET status = 'queued', scheduled_for = NOW(), started_at = NULL, completed_at = NULL, last_error = NULL
  WHERE run_id = target.id;

  UPDATE automation_failure_alerts
  SET acknowledged_at = NOW(), acknowledged_by_user_id = auth.uid()
  WHERE organization_id = target.organization_id
    AND source_type = 'automation_run'
    AND source_id = target.id
    AND acknowledged_at IS NULL;

  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (
    target.organization_id,
    auth.uid(),
    'automation.run.retry_queued',
    'automation_run',
    target.id::TEXT,
    jsonb_build_object(
      'previous_status', target.status,
      'retry_count', next_retry_count,
      'workflow_id', target.workflow_id,
      'version', target.workflow_version
    )
  );
  RETURN next_retry_count;
END;
$$;

REVOKE ALL ON FUNCTION dashboard_automation_retries_ready() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_retry_automation_run(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_automation_retries_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_retry_automation_run(UUID) TO authenticated;

COMMIT;
