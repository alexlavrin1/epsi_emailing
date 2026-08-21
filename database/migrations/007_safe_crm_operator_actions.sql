-- Phase 3: audited lifecycle overrides, contact notes, and follow-up tasks.
-- Browser users receive read access only; all writes pass through validating,
-- transactional RPC functions that append an audit event in the same commit.

BEGIN;

CREATE TABLE IF NOT EXISTS crm_contact_overrides (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_kind       TEXT NOT NULL CHECK (contact_kind IN ('prospect', 'customer')),
  contact_id         UUID NOT NULL,
  lifecycle_stage    TEXT NOT NULL CHECK (lifecycle_stage IN ('prospect', 'interested', 'client', 'at_risk', 'suppressed')),
  updated_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, contact_kind, contact_id)
);

CREATE TABLE IF NOT EXISTS crm_contact_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_kind    TEXT NOT NULL CHECK (contact_kind IN ('prospect', 'customer')),
  contact_id      UUID NOT NULL,
  body            TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 4000),
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_contact_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_kind    TEXT NOT NULL CHECK (contact_kind IN ('prospect', 'customer')),
  contact_id      UUID NOT NULL,
  title           TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  due_at          TIMESTAMPTZ,
  assigned_to_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_notes_subject
  ON crm_contact_notes (organization_id, contact_kind, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_contact_tasks_subject
  ON crm_contact_tasks (organization_id, contact_kind, contact_id, status, due_at);

DROP TRIGGER IF EXISTS crm_contact_overrides_touch_updated_at ON crm_contact_overrides;
CREATE TRIGGER crm_contact_overrides_touch_updated_at BEFORE UPDATE ON crm_contact_overrides
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();
DROP TRIGGER IF EXISTS crm_contact_tasks_touch_updated_at ON crm_contact_tasks;
CREATE TRIGGER crm_contact_tasks_touch_updated_at BEFORE UPDATE ON crm_contact_tasks
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();

ALTER TABLE crm_contact_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contact_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contact_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_contact_overrides_member_read ON crm_contact_overrides;
CREATE POLICY crm_contact_overrides_member_read ON crm_contact_overrides FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS crm_contact_notes_member_read ON crm_contact_notes;
CREATE POLICY crm_contact_notes_member_read ON crm_contact_notes FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS crm_contact_tasks_member_read ON crm_contact_tasks;
CREATE POLICY crm_contact_tasks_member_read ON crm_contact_tasks FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));

CREATE OR REPLACE FUNCTION dashboard_contact_belongs_to_org(
  target_organization_id UUID,
  target_contact_kind TEXT,
  target_contact_id UUID
) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE target_contact_kind
    WHEN 'prospect' THEN EXISTS (
      SELECT 1 FROM prospects WHERE id = target_contact_id AND organization_id = target_organization_id
    )
    WHEN 'customer' THEN EXISTS (
      SELECT 1 FROM crm_customers WHERE id = target_contact_id AND organization_id = target_organization_id
    )
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION dashboard_set_lifecycle_stage(
  target_organization_id UUID,
  target_contact_kind TEXT,
  target_contact_id UUID,
  target_stage TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE previous_stage TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF target_stage NOT IN ('prospect', 'interested', 'client', 'at_risk', 'suppressed') THEN
    RAISE EXCEPTION 'Invalid lifecycle stage';
  END IF;
  IF NOT dashboard_contact_belongs_to_org(target_organization_id, target_contact_kind, target_contact_id) THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;

  SELECT lifecycle_stage INTO previous_stage FROM crm_contact_overrides
  WHERE organization_id = target_organization_id AND contact_kind = target_contact_kind AND contact_id = target_contact_id;

  INSERT INTO crm_contact_overrides (organization_id, contact_kind, contact_id, lifecycle_stage, updated_by_user_id)
  VALUES (target_organization_id, target_contact_kind, target_contact_id, target_stage, auth.uid())
  ON CONFLICT (organization_id, contact_kind, contact_id) DO UPDATE
    SET lifecycle_stage = EXCLUDED.lifecycle_stage, updated_by_user_id = auth.uid(), updated_at = NOW();

  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'crm.lifecycle.changed', target_contact_kind, target_contact_id::TEXT,
    jsonb_build_object('previous_stage', previous_stage, 'new_stage', target_stage));
END;
$$;

CREATE OR REPLACE FUNCTION dashboard_add_contact_note(
  target_organization_id UUID,
  target_contact_kind TEXT,
  target_contact_id UUID,
  note_body TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF char_length(trim(COALESCE(note_body, ''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Note must contain 1 to 4000 characters'; END IF;
  IF NOT dashboard_contact_belongs_to_org(target_organization_id, target_contact_kind, target_contact_id) THEN RAISE EXCEPTION 'Contact not found'; END IF;

  INSERT INTO crm_contact_notes (organization_id, contact_kind, contact_id, body, created_by_user_id)
  VALUES (target_organization_id, target_contact_kind, target_contact_id, trim(note_body), auth.uid()) RETURNING id INTO new_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'crm.note.created', target_contact_kind, target_contact_id::TEXT,
    jsonb_build_object('note_id', new_id));
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION dashboard_create_contact_task(
  target_organization_id UUID,
  target_contact_kind TEXT,
  target_contact_id UUID,
  task_title TEXT,
  task_due_at TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF char_length(trim(COALESCE(task_title, ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Task title must contain 1 to 200 characters'; END IF;
  IF NOT dashboard_contact_belongs_to_org(target_organization_id, target_contact_kind, target_contact_id) THEN RAISE EXCEPTION 'Contact not found'; END IF;

  INSERT INTO crm_contact_tasks (organization_id, contact_kind, contact_id, title, due_at, assigned_to_user_id, created_by_user_id)
  VALUES (target_organization_id, target_contact_kind, target_contact_id, trim(task_title), task_due_at, auth.uid(), auth.uid()) RETURNING id INTO new_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'crm.task.created', target_contact_kind, target_contact_id::TEXT,
    jsonb_build_object('task_id', new_id, 'due_at', task_due_at));
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION dashboard_set_contact_task_status(target_task_id UUID, target_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target_task crm_contact_tasks%ROWTYPE;
BEGIN
  IF target_status NOT IN ('open', 'completed') THEN RAISE EXCEPTION 'Invalid task status'; END IF;
  SELECT * INTO target_task FROM crm_contact_tasks WHERE id = target_task_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target_task.organization_id) THEN RAISE EXCEPTION 'Task not found'; END IF;

  UPDATE crm_contact_tasks SET status = target_status,
    completed_at = CASE WHEN target_status = 'completed' THEN NOW() ELSE NULL END
  WHERE id = target_task_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_task.organization_id, auth.uid(), 'crm.task.status_changed', 'task', target_task_id::TEXT,
    jsonb_build_object('previous_status', target_task.status, 'new_status', target_status,
      'contact_kind', target_task.contact_kind, 'contact_id', target_task.contact_id));
END;
$$;

REVOKE ALL ON FUNCTION dashboard_contact_belongs_to_org(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_set_lifecycle_stage(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_add_contact_note(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_create_contact_task(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_set_contact_task_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dashboard_set_lifecycle_stage(UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_add_contact_note(UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_create_contact_task(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_contact_task_status(UUID, TEXT) TO authenticated;

COMMIT;
