-- Phase 5, slice 7: disabled-by-default automatic internal follow-up tasks.
-- This automation never sends externally. It creates at most one CRM task per
-- prospect reply and respects tenant membership plus the global runtime pause.

BEGIN;

ALTER TABLE crm_contact_tasks ALTER COLUMN created_by_user_id DROP NOT NULL;
ALTER TABLE crm_contact_tasks
  ADD COLUMN IF NOT EXISTS automation_source_type TEXT
  CHECK (automation_source_type IS NULL OR automation_source_type = 'prospect_reply_followup');
ALTER TABLE crm_contact_tasks
  ADD COLUMN IF NOT EXISTS automation_source_id UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_contact_tasks_creator_or_automation_check') THEN
    ALTER TABLE crm_contact_tasks ADD CONSTRAINT crm_contact_tasks_creator_or_automation_check
      CHECK (created_by_user_id IS NOT NULL OR (automation_source_type IS NOT NULL AND automation_source_id IS NOT NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contact_tasks_automation_source
  ON crm_contact_tasks (organization_id, automation_source_type, automation_source_id)
  WHERE automation_source_type IS NOT NULL;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON crm_contact_tasks FROM authenticated, anon;

CREATE TABLE IF NOT EXISTS automation_internal_task_controls (
  organization_id      UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled              BOOLEAN NOT NULL DEFAULT FALSE,
  task_title           TEXT NOT NULL DEFAULT 'Review new prospect reply'
                       CHECK (char_length(trim(task_title)) BETWEEN 3 AND 200),
  due_hours            INTEGER NOT NULL DEFAULT 24 CHECK (due_hours BETWEEN 1 AND 168),
  assigned_to_user_id  UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  configured_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT enabled OR assigned_to_user_id IS NOT NULL)
);

INSERT INTO automation_internal_task_controls (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

CREATE OR REPLACE FUNCTION initialize_automation_internal_task_control()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO automation_internal_task_controls (organization_id)
  VALUES (NEW.id)
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_initialize_automation_internal_task ON organizations;
CREATE TRIGGER organizations_initialize_automation_internal_task
AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION initialize_automation_internal_task_control();

DROP TRIGGER IF EXISTS automation_internal_task_controls_touch_updated_at ON automation_internal_task_controls;
CREATE TRIGGER automation_internal_task_controls_touch_updated_at
BEFORE UPDATE ON automation_internal_task_controls
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();

ALTER TABLE automation_internal_task_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_internal_task_controls_member_read ON automation_internal_task_controls;
CREATE POLICY automation_internal_task_controls_member_read
ON automation_internal_task_controls FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON automation_internal_task_controls FROM authenticated, anon;
GRANT SELECT ON automation_internal_task_controls TO authenticated;

CREATE OR REPLACE FUNCTION dashboard_automatic_internal_tasks_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION dashboard_set_automatic_internal_task(
  target_organization_id UUID,
  target_enabled BOOLEAN,
  target_task_title TEXT,
  target_due_hours INTEGER
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE previous automation_internal_task_controls%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id, ARRAY['admin']) THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  IF target_enabled IS NULL THEN RAISE EXCEPTION 'Enabled state is required'; END IF;
  IF char_length(trim(COALESCE(target_task_title, ''))) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'Task title must contain 3 to 200 characters';
  END IF;
  IF target_due_hours IS NULL OR target_due_hours NOT BETWEEN 1 AND 168 THEN
    RAISE EXCEPTION 'Task due time must be between 1 and 168 hours';
  END IF;

  INSERT INTO automation_internal_task_controls (organization_id)
  VALUES (target_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO previous FROM automation_internal_task_controls
  WHERE organization_id = target_organization_id FOR UPDATE;

  IF previous.enabled = target_enabled
     AND previous.task_title = trim(target_task_title)
     AND previous.due_hours = target_due_hours THEN RETURN; END IF;

  UPDATE automation_internal_task_controls
  SET enabled = target_enabled,
      task_title = trim(target_task_title),
      due_hours = target_due_hours,
      assigned_to_user_id = CASE WHEN target_enabled AND NOT previous.enabled THEN auth.uid() ELSE assigned_to_user_id END,
      configured_by_user_id = auth.uid()
  WHERE organization_id = target_organization_id;

  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (
    target_organization_id,
    auth.uid(),
    'automation.internal_task.configured',
    'automation_internal_task',
    target_organization_id::TEXT,
    jsonb_build_object(
      'previous_status', CASE WHEN previous.enabled THEN 'enabled' ELSE 'disabled' END,
      'new_status', CASE WHEN target_enabled THEN 'enabled' ELSE 'disabled' END,
      'previous_due_hours', previous.due_hours,
      'new_due_hours', target_due_hours
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION create_reply_followup_task(target_prospect_reply_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE source RECORD;
DECLARE new_task_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF target_prospect_reply_id IS NULL THEN RETURN NULL; END IF;

  SELECT reply.prospect_id, campaign.organization_id, control.task_title,
         control.due_hours, control.assigned_to_user_id
  INTO source
  FROM prospect_replies reply
  JOIN campaigns campaign ON campaign.id = reply.campaign_id
  JOIN prospects prospect ON prospect.id = reply.prospect_id
  JOIN automation_internal_task_controls control ON control.organization_id = campaign.organization_id
  JOIN automation_runtime_controls runtime ON runtime.organization_id = campaign.organization_id
  JOIN organization_members assignee
    ON assignee.organization_id = campaign.organization_id
   AND assignee.user_id = control.assigned_to_user_id
   AND assignee.status = 'active'
  WHERE reply.id = target_prospect_reply_id
    AND reply.outreach_send_id IS NOT NULL
    AND reply.gmail_message_id IS NOT NULL
    AND prospect.organization_id = campaign.organization_id
    AND prospect.status = 'active'
    AND control.enabled
    AND NOT runtime.globally_paused;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO crm_contact_tasks (
    organization_id, contact_kind, contact_id, title, due_at,
    assigned_to_user_id, created_by_user_id, automation_source_type, automation_source_id
  ) VALUES (
    source.organization_id, 'prospect', source.prospect_id, source.task_title,
    NOW() + make_interval(hours => source.due_hours), source.assigned_to_user_id,
    NULL, 'prospect_reply_followup', target_prospect_reply_id
  )
  ON CONFLICT (organization_id, automation_source_type, automation_source_id)
    WHERE automation_source_type IS NOT NULL DO NOTHING
  RETURNING id INTO new_task_id;
  IF new_task_id IS NULL THEN
    SELECT id INTO new_task_id FROM crm_contact_tasks
    WHERE organization_id = source.organization_id
      AND automation_source_type = 'prospect_reply_followup'
      AND automation_source_id = target_prospect_reply_id;
    RETURN new_task_id;
  END IF;

  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (
    source.organization_id,
    NULL,
    'automation.internal_task.created',
    'task',
    new_task_id::TEXT,
    jsonb_build_object(
      'contact_kind', 'prospect',
      'contact_id', source.prospect_id,
      'prospect_reply_id', target_prospect_reply_id,
      'due_hours', source.due_hours
    )
  );
  RETURN new_task_id;
END;
$$;

REVOKE ALL ON FUNCTION initialize_automation_internal_task_control() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_automatic_internal_tasks_ready() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_set_automatic_internal_task(UUID, BOOLEAN, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_reply_followup_task(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_automatic_internal_tasks_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_automatic_internal_task(UUID, BOOLEAN, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION create_reply_followup_task(UUID) TO service_role;

COMMIT;
