-- Phase 5, slice 4: actionable, tenant-scoped automation failure alerts.
-- Alerts are derived inside Postgres when a run or monitored worker cycle first
-- enters a failed state. Only sanitized codes and record identifiers are copied.

BEGIN;

CREATE TABLE IF NOT EXISTS automation_failure_alerts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type             TEXT NOT NULL CHECK (source_type IN ('automation_run', 'worker_cycle')),
  source_id               UUID NOT NULL,
  workflow_id             UUID REFERENCES automation_workflows(id),
  severity                TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  failure_code            TEXT NOT NULL CHECK (failure_code ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  acknowledged_at         TIMESTAMPTZ,
  acknowledged_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, source_type, source_id),
  CHECK ((source_type = 'automation_run' AND workflow_id IS NOT NULL) OR
         (source_type = 'worker_cycle' AND workflow_id IS NULL)),
  CHECK ((acknowledged_at IS NULL AND acknowledged_by_user_id IS NULL) OR acknowledged_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_automation_failure_alerts_open
  ON automation_failure_alerts (organization_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

ALTER TABLE automation_failure_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_failure_alerts_member_read ON automation_failure_alerts;
CREATE POLICY automation_failure_alerts_member_read
ON automation_failure_alerts FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON automation_failure_alerts FROM authenticated, anon;
GRANT SELECT ON automation_failure_alerts TO authenticated;

CREATE OR REPLACE FUNCTION create_automation_run_failure_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed' THEN
    INSERT INTO automation_failure_alerts (
      organization_id, source_type, source_id, workflow_id, severity, failure_code, created_at
    ) VALUES (
      NEW.organization_id, 'automation_run', NEW.id, NEW.workflow_id, 'warning', 'automation_run_failed',
      COALESCE(NEW.completed_at, NOW())
    ) ON CONFLICT (organization_id, source_type, source_id) DO UPDATE
      SET severity = EXCLUDED.severity,
          failure_code = EXCLUDED.failure_code,
          acknowledged_at = NULL,
          acknowledged_by_user_id = NULL,
          created_at = EXCLUDED.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS automation_runs_create_failure_alert ON automation_runs;
CREATE TRIGGER automation_runs_create_failure_alert
AFTER UPDATE OF status ON automation_runs
FOR EACH ROW EXECUTE FUNCTION create_automation_run_failure_alert();

CREATE OR REPLACE FUNCTION create_automation_worker_failure_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed' THEN
    INSERT INTO automation_failure_alerts (
      organization_id, source_type, source_id, workflow_id, severity, failure_code, created_at
    ) VALUES (
      NEW.organization_id, 'worker_cycle', NEW.id, NULL, 'critical', COALESCE(NEW.failure_code, 'worker_error'),
      COALESCE(NEW.completed_at, NOW())
    ) ON CONFLICT (organization_id, source_type, source_id) DO UPDATE
      SET severity = EXCLUDED.severity,
          failure_code = EXCLUDED.failure_code,
          acknowledged_at = NULL,
          acknowledged_by_user_id = NULL,
          created_at = EXCLUDED.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS automation_worker_cycles_create_failure_alert ON automation_worker_cycles;
CREATE TRIGGER automation_worker_cycles_create_failure_alert
AFTER UPDATE OF status ON automation_worker_cycles
FOR EACH ROW EXECUTE FUNCTION create_automation_worker_failure_alert();

-- Seed recent failures so the first dashboard view does not ignore active issues.
INSERT INTO automation_failure_alerts (
  organization_id, source_type, source_id, workflow_id, severity, failure_code, created_at
)
SELECT organization_id, 'automation_run', id, workflow_id, 'warning', 'automation_run_failed', COALESCE(completed_at, created_at)
FROM automation_runs
WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '30 days'
ON CONFLICT (organization_id, source_type, source_id) DO NOTHING;

INSERT INTO automation_failure_alerts (
  organization_id, source_type, source_id, workflow_id, severity, failure_code, created_at
)
SELECT organization_id, 'worker_cycle', id, NULL, 'critical', COALESCE(failure_code, 'worker_error'), COALESCE(completed_at, created_at)
FROM automation_worker_cycles
WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '30 days'
ON CONFLICT (organization_id, source_type, source_id) DO NOTHING;

CREATE OR REPLACE FUNCTION dashboard_automation_failure_alerts_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION dashboard_acknowledge_automation_alert(target_alert_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target automation_failure_alerts%ROWTYPE;
BEGIN
  SELECT * INTO target FROM automation_failure_alerts WHERE id = target_alert_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target.organization_id) THEN
    RAISE EXCEPTION 'Automation alert not found';
  END IF;
  IF target.acknowledged_at IS NOT NULL THEN RETURN FALSE; END IF;

  UPDATE automation_failure_alerts
  SET acknowledged_at = NOW(), acknowledged_by_user_id = auth.uid()
  WHERE id = target_alert_id;

  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (
    target.organization_id,
    auth.uid(),
    'automation.alert.acknowledged',
    'automation_failure_alert',
    target_alert_id::TEXT,
    jsonb_build_object(
      'source_type', target.source_type,
      'source_id', target.source_id,
      'failure_code', target.failure_code,
      'workflow_id', target.workflow_id
    )
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION create_automation_run_failure_alert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_automation_worker_failure_alert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_automation_failure_alerts_ready() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_acknowledge_automation_alert(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_automation_failure_alerts_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_acknowledge_automation_alert(UUID) TO authenticated;

COMMIT;
