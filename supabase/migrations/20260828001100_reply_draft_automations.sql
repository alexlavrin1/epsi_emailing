-- Phase 4, slice 1: structured, versioned reply-draft automations.
-- Active workflows may prepare drafts, but external delivery always remains
-- gated by the existing operator approval queue.

BEGIN;

CREATE TABLE IF NOT EXISTS automation_workflows (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 120),
  description        TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  trigger_type       TEXT NOT NULL CHECK (trigger_type IN ('prospect_reply_received')),
  approval_mode      TEXT NOT NULL DEFAULT 'required' CHECK (approval_mode = 'required'),
  delay_minutes      INTEGER NOT NULL DEFAULT 0 CHECK (delay_minutes BETWEEN 0 AND 10080),
  current_version    INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_workflows_one_active_reply
  ON automation_workflows (organization_id, trigger_type)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_automation_workflows_org_updated
  ON automation_workflows (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS automation_workflow_versions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id        UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  version            INTEGER NOT NULL CHECK (version > 0),
  body_template      TEXT NOT NULL CHECK (char_length(trim(body_template)) BETWEEN 1 AND 10000),
  definition         JSONB NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id        UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE RESTRICT,
  workflow_version   INTEGER NOT NULL,
  trigger_ref_type   TEXT NOT NULL CHECK (trigger_ref_type = 'prospect_reply'),
  trigger_ref_id     UUID NOT NULL REFERENCES prospect_replies(id) ON DELETE RESTRICT,
  prospect_id        UUID NOT NULL REFERENCES prospects(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'preparing', 'waiting_approval', 'running', 'succeeded', 'failed', 'stopped', 'cancelled')),
  scheduled_for      TIMESTAMPTZ NOT NULL,
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, trigger_ref_type, trigger_ref_id),
  FOREIGN KEY (workflow_id, workflow_version)
    REFERENCES automation_workflow_versions(workflow_id, version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_due
  ON automation_runs (scheduled_for, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_automation_runs_org_created
  ON automation_runs (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS automation_run_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  step_key          TEXT NOT NULL,
  step_index        INTEGER NOT NULL CHECK (step_index >= 0),
  step_type         TEXT NOT NULL CHECK (step_type IN ('prepare_email_reply')),
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'preparing', 'waiting_approval', 'running', 'succeeded', 'failed', 'stopped', 'cancelled')),
  approval_required BOOLEAN NOT NULL DEFAULT TRUE CHECK (approval_required),
  scheduled_for     TIMESTAMPTZ NOT NULL,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, step_key)
);

ALTER TABLE operator_email_replies
  ADD COLUMN IF NOT EXISTS automation_run_id UUID REFERENCES automation_runs(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_email_replies_automation_run
  ON operator_email_replies (automation_run_id) WHERE automation_run_id IS NOT NULL;
ALTER TABLE operator_email_replies ALTER COLUMN created_by_user_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'operator_email_replies_creator_check') THEN
    ALTER TABLE operator_email_replies ADD CONSTRAINT operator_email_replies_creator_check
      CHECK (created_by_user_id IS NOT NULL OR automation_run_id IS NOT NULL);
  END IF;
END $$;

DROP TRIGGER IF EXISTS automation_workflows_touch_updated_at ON automation_workflows;
CREATE TRIGGER automation_workflows_touch_updated_at BEFORE UPDATE ON automation_workflows
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();
DROP TRIGGER IF EXISTS automation_runs_touch_updated_at ON automation_runs;
CREATE TRIGGER automation_runs_touch_updated_at BEFORE UPDATE ON automation_runs
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();
DROP TRIGGER IF EXISTS automation_run_steps_touch_updated_at ON automation_run_steps;
CREATE TRIGGER automation_run_steps_touch_updated_at BEFORE UPDATE ON automation_run_steps
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();

ALTER TABLE automation_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_run_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_workflows_member_read ON automation_workflows;
CREATE POLICY automation_workflows_member_read ON automation_workflows FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS automation_versions_member_read ON automation_workflow_versions;
CREATE POLICY automation_versions_member_read ON automation_workflow_versions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND dashboard_is_org_member(w.organization_id)));
DROP POLICY IF EXISTS automation_runs_member_read ON automation_runs;
CREATE POLICY automation_runs_member_read ON automation_runs FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS automation_steps_member_read ON automation_run_steps;
CREATE POLICY automation_steps_member_read ON automation_run_steps FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM automation_runs r WHERE r.id = run_id AND dashboard_is_org_member(r.organization_id)));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON automation_workflows, automation_workflow_versions, automation_runs, automation_run_steps FROM authenticated, anon;
GRANT SELECT ON automation_workflows, automation_workflow_versions, automation_runs, automation_run_steps TO authenticated;

CREATE OR REPLACE FUNCTION dashboard_automation_controls_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION dashboard_create_reply_workflow(
  target_organization_id UUID,
  workflow_name TEXT,
  workflow_description TEXT,
  workflow_body_template TEXT,
  workflow_delay_minutes INTEGER
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_id UUID;
DECLARE definition JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id, ARRAY['admin']) THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF char_length(trim(COALESCE(workflow_name, ''))) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'Name must contain 3 to 120 characters'; END IF;
  IF char_length(COALESCE(workflow_description, '')) > 500 THEN RAISE EXCEPTION 'Description is too long'; END IF;
  IF char_length(trim(COALESCE(workflow_body_template, ''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Template must contain 1 to 10000 characters'; END IF;
  IF workflow_delay_minutes NOT BETWEEN 0 AND 10080 THEN RAISE EXCEPTION 'Delay must be between 0 and 10080 minutes'; END IF;

  definition := jsonb_build_object(
    'trigger', jsonb_build_object('type', 'prospect_reply_received'),
    'conditions', jsonb_build_array(jsonb_build_object('field', 'prospect.status', 'operator', 'equals', 'value', 'active')),
    'steps', jsonb_build_array(jsonb_build_object('key', 'prepare_reply', 'type', 'prepare_email_reply', 'approval', 'required', 'delay_minutes', workflow_delay_minutes)),
    'stop_conditions', jsonb_build_array('workflow_paused', 'prospect_inactive', 'reply_context_missing')
  );

  INSERT INTO automation_workflows (organization_id, name, description, trigger_type, delay_minutes, created_by_user_id, updated_by_user_id)
  VALUES (target_organization_id, trim(workflow_name), trim(COALESCE(workflow_description, '')), 'prospect_reply_received', workflow_delay_minutes, auth.uid(), auth.uid())
  RETURNING id INTO new_id;
  INSERT INTO automation_workflow_versions (workflow_id, version, body_template, definition, created_by_user_id)
  VALUES (new_id, 1, trim(workflow_body_template), definition, auth.uid());
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'automation.workflow.created', 'automation_workflow', new_id::TEXT,
    jsonb_build_object('version', 1, 'status', 'draft', 'trigger_type', 'prospect_reply_received'));
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION dashboard_update_reply_workflow(
  target_workflow_id UUID,
  workflow_name TEXT,
  workflow_description TEXT,
  workflow_body_template TEXT,
  workflow_delay_minutes INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target automation_workflows%ROWTYPE;
DECLARE next_version INTEGER;
DECLARE definition JSONB;
BEGIN
  SELECT * INTO target FROM automation_workflows WHERE id = target_workflow_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_has_org_role(target.organization_id, ARRAY['admin']) THEN RAISE EXCEPTION 'Workflow not found'; END IF;
  IF target.status = 'active' THEN RAISE EXCEPTION 'Pause the workflow before editing'; END IF;
  IF char_length(trim(COALESCE(workflow_name, ''))) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'Name must contain 3 to 120 characters'; END IF;
  IF char_length(COALESCE(workflow_description, '')) > 500 THEN RAISE EXCEPTION 'Description is too long'; END IF;
  IF char_length(trim(COALESCE(workflow_body_template, ''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Template must contain 1 to 10000 characters'; END IF;
  IF workflow_delay_minutes NOT BETWEEN 0 AND 10080 THEN RAISE EXCEPTION 'Delay must be between 0 and 10080 minutes'; END IF;

  next_version := target.current_version + 1;
  definition := jsonb_build_object(
    'trigger', jsonb_build_object('type', 'prospect_reply_received'),
    'conditions', jsonb_build_array(jsonb_build_object('field', 'prospect.status', 'operator', 'equals', 'value', 'active')),
    'steps', jsonb_build_array(jsonb_build_object('key', 'prepare_reply', 'type', 'prepare_email_reply', 'approval', 'required', 'delay_minutes', workflow_delay_minutes)),
    'stop_conditions', jsonb_build_array('workflow_paused', 'prospect_inactive', 'reply_context_missing')
  );
  UPDATE automation_workflows SET name = trim(workflow_name), description = trim(COALESCE(workflow_description, '')),
    delay_minutes = workflow_delay_minutes, current_version = next_version, updated_by_user_id = auth.uid()
  WHERE id = target_workflow_id;
  INSERT INTO automation_workflow_versions (workflow_id, version, body_template, definition, created_by_user_id)
  VALUES (target_workflow_id, next_version, trim(workflow_body_template), definition, auth.uid());
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target.organization_id, auth.uid(), 'automation.workflow.version_created', 'automation_workflow', target_workflow_id::TEXT,
    jsonb_build_object('previous_version', target.current_version, 'version', next_version));
  RETURN next_version;
END;
$$;

CREATE OR REPLACE FUNCTION dashboard_set_workflow_status(target_workflow_id UUID, target_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target automation_workflows%ROWTYPE;
BEGIN
  IF target_status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'Invalid workflow status'; END IF;
  SELECT * INTO target FROM automation_workflows WHERE id = target_workflow_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_has_org_role(target.organization_id, ARRAY['admin']) THEN RAISE EXCEPTION 'Workflow not found'; END IF;
  IF target_status = 'active' AND EXISTS (
    SELECT 1 FROM automation_workflows WHERE organization_id = target.organization_id
      AND trigger_type = target.trigger_type AND status = 'active' AND id <> target.id
  ) THEN RAISE EXCEPTION 'Another workflow already handles this trigger'; END IF;
  UPDATE automation_workflows SET status = target_status, updated_by_user_id = auth.uid() WHERE id = target_workflow_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target.organization_id, auth.uid(), 'automation.workflow.status_changed', 'automation_workflow', target_workflow_id::TEXT,
    jsonb_build_object('previous_status', target.status, 'new_status', target_status, 'version', target.current_version));
END;
$$;

CREATE OR REPLACE FUNCTION dashboard_update_email_reply_draft(target_reply_id UUID, reply_body TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target operator_email_replies%ROWTYPE;
BEGIN
  SELECT * INTO target FROM operator_email_replies WHERE id = target_reply_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target.organization_id) THEN RAISE EXCEPTION 'Draft not found'; END IF;
  IF target.status NOT IN ('draft', 'failed') THEN RAISE EXCEPTION 'Only draft or failed replies can be edited'; END IF;
  IF char_length(trim(COALESCE(reply_body, ''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Reply must contain 1 to 10000 characters'; END IF;
  UPDATE operator_email_replies SET body = trim(reply_body), status = 'draft', attempt_count = 0,
    queued_by_user_id = NULL, queued_at = NULL, last_error = NULL WHERE id = target_reply_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target.organization_id, auth.uid(), 'email.reply.draft_updated', 'operator_email_reply', target_reply_id::TEXT,
    jsonb_build_object('automation_run_id', target.automation_run_id));
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_reply_automation(target_prospect_reply_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE source RECORD;
DECLARE workflow automation_workflows%ROWTYPE;
DECLARE new_run_id UUID;
DECLARE queued_count INTEGER := 0;
BEGIN
  SELECT pr.id, pr.prospect_id, pr.outreach_send_id, pr.gmail_message_id, c.organization_id, p.status AS prospect_status
    INTO source
  FROM prospect_replies pr JOIN campaigns c ON c.id = pr.campaign_id JOIN prospects p ON p.id = pr.prospect_id
  WHERE pr.id = target_prospect_reply_id;
  IF NOT FOUND OR source.prospect_status <> 'active' OR source.outreach_send_id IS NULL OR source.gmail_message_id IS NULL THEN RETURN 0; END IF;

  FOR workflow IN SELECT * FROM automation_workflows
    WHERE organization_id = source.organization_id AND trigger_type = 'prospect_reply_received' AND status = 'active'
  LOOP
    new_run_id := NULL;
    INSERT INTO automation_runs (organization_id, workflow_id, workflow_version, trigger_ref_type, trigger_ref_id, prospect_id, scheduled_for)
    VALUES (source.organization_id, workflow.id, workflow.current_version, 'prospect_reply', source.id, source.prospect_id,
      NOW() + make_interval(mins => workflow.delay_minutes))
    ON CONFLICT (workflow_id, trigger_ref_type, trigger_ref_id) DO NOTHING RETURNING id INTO new_run_id;
    IF new_run_id IS NOT NULL THEN
      INSERT INTO automation_run_steps (run_id, step_key, step_index, step_type, scheduled_for)
      VALUES (new_run_id, 'prepare_reply', 0, 'prepare_email_reply', NOW() + make_interval(mins => workflow.delay_minutes));
      INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
      VALUES (source.organization_id, NULL, 'automation.run.queued', 'automation_run', new_run_id::TEXT,
        jsonb_build_object('workflow_id', workflow.id, 'version', workflow.current_version, 'prospect_reply_id', source.id));
      queued_count := queued_count + 1;
    END IF;
  END LOOP;
  RETURN queued_count;
END;
$$;

CREATE OR REPLACE FUNCTION claim_reply_automation_run(target_run_id UUID)
RETURNS SETOF automation_runs LANGUAGE SQL SECURITY DEFINER SET search_path = public
AS $$
  UPDATE automation_runs r SET status = 'preparing', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
  WHERE r.id = target_run_id AND r.status = 'queued' AND r.scheduled_for <= NOW()
    AND EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = r.workflow_id AND w.status = 'active')
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
  IF NOT EXISTS (
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

CREATE OR REPLACE FUNCTION fail_reply_automation_run(target_run_id UUID, failure_message TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE automation_runs SET status = 'failed', completed_at = NOW(), last_error = left(COALESCE(failure_message, 'Unknown automation error'), 1000)
  WHERE id = target_run_id AND status = 'preparing';
  UPDATE automation_run_steps SET status = 'failed', completed_at = NOW(), last_error = left(COALESCE(failure_message, 'Unknown automation error'), 1000)
  WHERE run_id = target_run_id AND status = 'queued';
END;
$$;

CREATE OR REPLACE FUNCTION sync_automation_reply_run()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE run_status TEXT;
BEGIN
  IF NEW.automation_run_id IS NULL THEN RETURN NEW; END IF;
  run_status := CASE NEW.status
    WHEN 'draft' THEN 'waiting_approval'
    WHEN 'queued' THEN 'running'
    WHEN 'sending' THEN 'running'
    WHEN 'sent' THEN 'succeeded'
    WHEN 'failed' THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE NULL END;
  IF run_status IS NULL THEN RETURN NEW; END IF;
  UPDATE automation_runs SET status = run_status,
    completed_at = CASE WHEN run_status IN ('succeeded', 'failed', 'cancelled') THEN NOW() ELSE NULL END,
    last_error = CASE WHEN run_status = 'failed' THEN NEW.last_error ELSE NULL END
  WHERE id = NEW.automation_run_id;
  UPDATE automation_run_steps SET status = run_status,
    completed_at = CASE WHEN run_status IN ('succeeded', 'failed', 'cancelled') THEN NOW() ELSE NULL END,
    last_error = CASE WHEN run_status = 'failed' THEN NEW.last_error ELSE NULL END
  WHERE run_id = NEW.automation_run_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operator_reply_sync_automation_run ON operator_email_replies;
CREATE TRIGGER operator_reply_sync_automation_run AFTER UPDATE OF status, body ON operator_email_replies
FOR EACH ROW EXECUTE FUNCTION sync_automation_reply_run();

REVOKE ALL ON FUNCTION dashboard_automation_controls_ready() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_create_reply_workflow(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_update_reply_workflow(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_set_workflow_status(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_update_email_reply_draft(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enqueue_reply_automation(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_reply_automation_run(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_reply_automation_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_reply_automation_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_automation_reply_run() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_automation_controls_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_create_reply_workflow(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_update_reply_workflow(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_workflow_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_update_email_reply_draft(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION enqueue_reply_automation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION claim_reply_automation_run(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION complete_reply_automation_run(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fail_reply_automation_run(UUID, TEXT) TO service_role;

COMMIT;
