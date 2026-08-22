-- Phase 5, slice 1: tenant-wide automation runtime controls.
-- Existing behavior remains enabled by default. An administrator can pause all
-- automation-generated work for one organization without blocking manual replies.

BEGIN;

CREATE TABLE IF NOT EXISTS automation_runtime_controls (
  organization_id   UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  globally_paused   BOOLEAN NOT NULL DEFAULT FALSE,
  pause_reason      TEXT CHECK (pause_reason IS NULL OR char_length(trim(pause_reason)) BETWEEN 3 AND 500),
  paused_at         TIMESTAMPTZ,
  paused_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((globally_paused AND paused_at IS NOT NULL AND pause_reason IS NOT NULL) OR
         (NOT globally_paused AND paused_at IS NULL AND pause_reason IS NULL))
);

INSERT INTO automation_runtime_controls (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

CREATE OR REPLACE FUNCTION initialize_automation_runtime_control()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO automation_runtime_controls (organization_id)
  VALUES (NEW.id)
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_initialize_automation_runtime ON organizations;
CREATE TRIGGER organizations_initialize_automation_runtime
AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION initialize_automation_runtime_control();

DROP TRIGGER IF EXISTS automation_runtime_controls_touch_updated_at ON automation_runtime_controls;
CREATE TRIGGER automation_runtime_controls_touch_updated_at
BEFORE UPDATE ON automation_runtime_controls
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();

ALTER TABLE automation_runtime_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_runtime_controls_member_read ON automation_runtime_controls;
CREATE POLICY automation_runtime_controls_member_read
ON automation_runtime_controls FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON automation_runtime_controls FROM authenticated, anon;
GRANT SELECT ON automation_runtime_controls TO authenticated;

CREATE OR REPLACE FUNCTION dashboard_automation_runtime_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION dashboard_set_automation_pause(
  target_organization_id UUID,
  target_paused BOOLEAN,
  target_reason TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE previous_paused BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id, ARRAY['admin']) THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  IF target_paused IS NULL THEN RAISE EXCEPTION 'Pause state is required'; END IF;
  IF target_paused AND char_length(trim(COALESCE(target_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Pause reason must contain 3 to 500 characters';
  END IF;

  INSERT INTO automation_runtime_controls (organization_id)
  VALUES (target_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT globally_paused INTO previous_paused
  FROM automation_runtime_controls
  WHERE organization_id = target_organization_id
  FOR UPDATE;

  IF previous_paused = target_paused THEN RETURN; END IF;

  UPDATE automation_runtime_controls
  SET globally_paused = target_paused,
      pause_reason = CASE WHEN target_paused THEN trim(target_reason) ELSE NULL END,
      paused_at = CASE WHEN target_paused THEN NOW() ELSE NULL END,
      paused_by_user_id = CASE WHEN target_paused THEN auth.uid() ELSE NULL END
  WHERE organization_id = target_organization_id;

  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (
    target_organization_id,
    auth.uid(),
    CASE WHEN target_paused THEN 'automation.runtime.paused' ELSE 'automation.runtime.resumed' END,
    'automation_runtime',
    target_organization_id::TEXT,
    jsonb_build_object(
      'previous_status', CASE WHEN previous_paused THEN 'paused' ELSE 'running' END,
      'new_status', CASE WHEN target_paused THEN 'paused' ELSE 'running' END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION block_paused_automation_run_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM automation_runtime_controls
    WHERE organization_id = NEW.organization_id AND globally_paused
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS automation_runs_block_while_paused ON automation_runs;
CREATE TRIGGER automation_runs_block_while_paused
BEFORE INSERT ON automation_runs
FOR EACH ROW EXECUTE FUNCTION block_paused_automation_run_insert();

CREATE OR REPLACE FUNCTION claim_reply_automation_run(target_run_id UUID)
RETURNS SETOF automation_runs LANGUAGE SQL SECURITY DEFINER SET search_path = public
AS $$
  UPDATE automation_runs r SET status = 'preparing', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
  WHERE r.id = target_run_id AND r.status = 'queued' AND r.scheduled_for <= NOW()
    AND EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = r.workflow_id AND w.status = 'active')
    AND NOT EXISTS (
      SELECT 1 FROM automation_runtime_controls c
      WHERE c.organization_id = r.organization_id AND c.globally_paused
    )
  RETURNING r.*;
$$;

CREATE OR REPLACE FUNCTION complete_reply_automation_run(target_run_id UUID, reply_body TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target automation_runs%ROWTYPE;
DECLARE new_reply_id UUID;
BEGIN
  SELECT * INTO target FROM automation_runs WHERE id = target_run_id FOR UPDATE;
  IF NOT FOUND OR target.status <> 'preparing' THEN RAISE EXCEPTION 'Automation run is not preparing'; END IF;
  IF char_length(trim(COALESCE(reply_body, ''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Prepared reply must contain 1 to 10000 characters'; END IF;
  IF EXISTS (
    SELECT 1 FROM automation_runtime_controls
    WHERE organization_id = target.organization_id AND globally_paused
  ) OR NOT EXISTS (
    SELECT 1 FROM prospect_replies pr JOIN prospects p ON p.id = pr.prospect_id
    JOIN automation_workflows w ON w.id = target.workflow_id
    WHERE pr.id = target.trigger_ref_id AND p.id = target.prospect_id AND p.status = 'active' AND w.status = 'active'
      AND pr.outreach_send_id IS NOT NULL AND pr.gmail_message_id IS NOT NULL
  ) THEN
    UPDATE automation_runs SET status = 'stopped', completed_at = NOW(), last_error = 'Stop condition matched before draft preparation' WHERE id = target_run_id;
    UPDATE automation_run_steps SET status = 'stopped', completed_at = NOW(), last_error = 'Stop condition matched before draft preparation' WHERE run_id = target_run_id;
    RETURN NULL;
  END IF;

  INSERT INTO operator_email_replies (organization_id, prospect_reply_id, body, created_by_user_id, automation_run_id)
  VALUES (target.organization_id, target.trigger_ref_id, trim(reply_body), NULL, target_run_id)
  RETURNING id INTO new_reply_id;
  UPDATE automation_runs SET status = 'waiting_approval', last_error = NULL WHERE id = target_run_id;
  UPDATE automation_run_steps SET status = 'waiting_approval', started_at = COALESCE(started_at, NOW()), last_error = NULL WHERE run_id = target_run_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target.organization_id, NULL, 'automation.run.waiting_approval', 'automation_run', target_run_id::TEXT,
    jsonb_build_object('workflow_id', target.workflow_id, 'version', target.workflow_version, 'prospect_reply_id', target.trigger_ref_id));
  RETURN new_reply_id;
END;
$$;

CREATE OR REPLACE FUNCTION claim_operator_email_reply(target_reply_id UUID)
RETURNS SETOF operator_email_replies LANGUAGE SQL SECURITY INVOKER SET search_path = public
AS $$
  UPDATE operator_email_replies reply
  SET status = 'sending', attempt_count = attempt_count + 1, updated_at = NOW()
  WHERE reply.id = target_reply_id AND reply.status IN ('queued', 'failed') AND reply.attempt_count < 3
    AND (
      reply.automation_run_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM automation_runs run
        JOIN automation_runtime_controls control ON control.organization_id = run.organization_id
        WHERE run.id = reply.automation_run_id AND control.globally_paused
      )
    )
  RETURNING reply.*;
$$;

REVOKE ALL ON FUNCTION dashboard_automation_runtime_ready() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_set_automation_pause(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION initialize_automation_runtime_control() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION block_paused_automation_run_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_reply_automation_run(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_reply_automation_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_operator_email_reply(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_automation_runtime_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_automation_pause(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_reply_automation_run(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION complete_reply_automation_run(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION claim_operator_email_reply(UUID) TO service_role;

COMMIT;
