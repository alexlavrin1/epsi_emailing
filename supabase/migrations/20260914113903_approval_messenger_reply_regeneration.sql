-- Approval messenger: safely regenerate an unsent automated reply in place.
BEGIN;

CREATE OR REPLACE FUNCTION dashboard_regenerate_operator_email_reply(target_reply_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target_reply operator_email_replies%ROWTYPE;
DECLARE target_run automation_runs%ROWTYPE;
BEGIN
  SELECT * INTO target_reply FROM operator_email_replies WHERE id = target_reply_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target_reply.organization_id) THEN
    RAISE EXCEPTION 'Reply draft not found';
  END IF;
  IF target_reply.status NOT IN ('draft', 'failed') THEN RAISE EXCEPTION 'Only unsent replies can be regenerated'; END IF;
  IF target_reply.automation_run_id IS NULL THEN RAISE EXCEPTION 'Manual replies cannot be regenerated'; END IF;

  SELECT * INTO target_run FROM automation_runs WHERE id = target_reply.automation_run_id FOR UPDATE;
  IF NOT FOUND OR target_run.organization_id <> target_reply.organization_id THEN RAISE EXCEPTION 'Automation run not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM automation_workflows WHERE id = target_run.workflow_id AND organization_id = target_run.organization_id AND status = 'active') THEN
    RAISE EXCEPTION 'Reply workflow must be active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM automation_runtime_controls WHERE organization_id = target_run.organization_id AND globally_paused = FALSE) THEN
    RAISE EXCEPTION 'Automation runtime is paused or unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM prospect_replies reply JOIN prospects prospect ON prospect.id = reply.prospect_id
    WHERE reply.id = target_run.trigger_ref_id AND prospect.id = target_run.prospect_id AND prospect.status = 'active'
      AND reply.outreach_send_id IS NOT NULL AND reply.gmail_message_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'Reply context is no longer eligible for automation'; END IF;

  UPDATE automation_runs SET status = 'queued', scheduled_for = NOW(), started_at = NULL, completed_at = NULL, last_error = NULL
  WHERE id = target_run.id;
  UPDATE automation_run_steps SET status = 'queued', scheduled_for = NOW(), started_at = NULL, completed_at = NULL, last_error = NULL
  WHERE run_id = target_run.id;
  UPDATE operator_email_replies SET status = 'draft', attempt_count = 0, queued_by_user_id = NULL, queued_at = NULL, last_error = NULL
  WHERE id = target_reply.id;

  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_reply.organization_id, auth.uid(), 'email.reply.regeneration_queued', 'operator_email_reply', target_reply.id::TEXT,
    jsonb_build_object('automation_run_id', target_run.id, 'workflow_id', target_run.workflow_id, 'version', target_run.workflow_version));
END;
$$;

CREATE OR REPLACE FUNCTION complete_reply_automation_run(target_run_id UUID, reply_body TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target automation_runs%ROWTYPE;
DECLARE reply_id UUID;
BEGIN
  SELECT * INTO target FROM automation_runs WHERE id = target_run_id FOR UPDATE;
  IF NOT FOUND OR target.status <> 'preparing' THEN RAISE EXCEPTION 'Automation run is not preparing'; END IF;
  IF char_length(trim(COALESCE(reply_body, ''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Prepared reply must contain 1 to 10000 characters'; END IF;
  IF EXISTS (SELECT 1 FROM automation_runtime_controls WHERE organization_id = target.organization_id AND globally_paused)
    OR NOT EXISTS (
      SELECT 1 FROM prospect_replies pr JOIN prospects p ON p.id = pr.prospect_id JOIN automation_workflows w ON w.id = target.workflow_id
      WHERE pr.id = target.trigger_ref_id AND p.id = target.prospect_id AND p.status = 'active' AND w.status = 'active'
        AND pr.outreach_send_id IS NOT NULL AND pr.gmail_message_id IS NOT NULL
    ) THEN
    UPDATE automation_runs SET status = 'stopped', completed_at = NOW(), last_error = 'Stop condition matched before draft preparation' WHERE id = target_run_id;
    UPDATE automation_run_steps SET status = 'stopped', completed_at = NOW(), last_error = 'Stop condition matched before draft preparation' WHERE run_id = target_run_id;
    RETURN NULL;
  END IF;

  UPDATE operator_email_replies SET body = trim(reply_body), status = 'draft', attempt_count = 0,
    queued_by_user_id = NULL, queued_at = NULL, last_error = NULL, updated_at = NOW()
  WHERE automation_run_id = target_run_id RETURNING id INTO reply_id;
  IF reply_id IS NULL THEN
    INSERT INTO operator_email_replies (organization_id, prospect_reply_id, body, created_by_user_id, automation_run_id)
    VALUES (target.organization_id, target.trigger_ref_id, trim(reply_body), NULL, target_run_id)
    RETURNING id INTO reply_id;
  END IF;
  UPDATE automation_runs SET status = 'waiting_approval', last_error = NULL WHERE id = target_run_id;
  UPDATE automation_run_steps SET status = 'waiting_approval', started_at = COALESCE(started_at, NOW()), last_error = NULL WHERE run_id = target_run_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target.organization_id, NULL, 'automation.run.waiting_approval', 'automation_run', target_run_id::TEXT,
    jsonb_build_object('workflow_id', target.workflow_id, 'version', target.workflow_version, 'prospect_reply_id', target.trigger_ref_id, 'reply_id', reply_id));
  RETURN reply_id;
END;
$$;

REVOKE ALL ON FUNCTION dashboard_regenerate_operator_email_reply(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_reply_automation_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_regenerate_operator_email_reply(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_reply_automation_run(UUID, TEXT) TO service_role;

COMMIT;
