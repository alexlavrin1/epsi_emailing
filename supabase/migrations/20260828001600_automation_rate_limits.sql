-- Phase 5, slice 3: tenant-wide automation volume controls.
-- New automation runs are limited by a rolling one-hour window. The runtime
-- control row is locked while counting and inserting so concurrent triggers
-- cannot race past the configured organization limit.

BEGIN;

ALTER TABLE automation_runtime_controls
  ADD COLUMN IF NOT EXISTS hourly_run_limit INTEGER NOT NULL DEFAULT 100
  CHECK (hourly_run_limit BETWEEN 1 AND 1000);

CREATE OR REPLACE FUNCTION dashboard_automation_rate_limits_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION dashboard_set_automation_rate_limit(
  target_organization_id UUID,
  target_hourly_limit INTEGER
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE previous_limit INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id, ARRAY['admin']) THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  IF target_hourly_limit IS NULL OR target_hourly_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Hourly run limit must be between 1 and 1000';
  END IF;

  INSERT INTO automation_runtime_controls (organization_id)
  VALUES (target_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT hourly_run_limit INTO previous_limit
  FROM automation_runtime_controls
  WHERE organization_id = target_organization_id
  FOR UPDATE;

  IF previous_limit = target_hourly_limit THEN RETURN; END IF;

  UPDATE automation_runtime_controls
  SET hourly_run_limit = target_hourly_limit
  WHERE organization_id = target_organization_id;

  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (
    target_organization_id,
    auth.uid(),
    'automation.runtime.limit_changed',
    'automation_runtime',
    target_organization_id::TEXT,
    jsonb_build_object('previous_limit', previous_limit, 'new_limit', target_hourly_limit)
  );
END;
$$;

CREATE OR REPLACE FUNCTION block_paused_automation_run_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE control automation_runtime_controls%ROWTYPE;
DECLARE runs_in_window INTEGER;
BEGIN
  SELECT * INTO control
  FROM automation_runtime_controls
  WHERE organization_id = NEW.organization_id
  FOR UPDATE;

  -- Runtime controls are mandatory for automation execution. Missing tenant
  -- configuration fails closed instead of allowing ungoverned work.
  IF NOT FOUND OR control.globally_paused THEN RETURN NULL; END IF;

  SELECT count(*) INTO runs_in_window
  FROM automation_runs
  WHERE organization_id = NEW.organization_id
    AND created_at >= NOW() - INTERVAL '1 hour';

  IF runs_in_window >= control.hourly_run_limit THEN
    INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
    VALUES (
      NEW.organization_id,
      NULL,
      'automation.run.rate_limited',
      'automation_workflow',
      NEW.workflow_id::TEXT,
      jsonb_build_object(
        'hourly_limit', control.hourly_run_limit,
        'runs_in_window', runs_in_window,
        'trigger_type', NEW.trigger_ref_type
      )
    );
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION dashboard_automation_rate_limits_ready() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_set_automation_rate_limit(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION block_paused_automation_run_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_automation_rate_limits_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_automation_rate_limit(UUID, INTEGER) TO authenticated;

COMMIT;
