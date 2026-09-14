-- Phase 5, slice 2: tenant-scoped automation worker heartbeats.
-- The service worker records one cycle row per organization. Browser users may
-- read only their tenant's rows, and monitoring failures never authorize work.

BEGIN;

CREATE TABLE IF NOT EXISTS automation_worker_cycles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cycle_key       UUID NOT NULL,
  worker_name     TEXT NOT NULL CHECK (worker_name IN ('outreach')),
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  failure_code    TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_ms     BIGINT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, cycle_key),
  CHECK ((status = 'running' AND completed_at IS NULL AND duration_ms IS NULL AND failure_code IS NULL) OR
         (status = 'succeeded' AND completed_at IS NOT NULL AND duration_ms IS NOT NULL AND failure_code IS NULL) OR
         (status = 'failed' AND completed_at IS NOT NULL AND duration_ms IS NOT NULL AND failure_code IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_automation_worker_cycles_org_started
  ON automation_worker_cycles (organization_id, started_at DESC);

ALTER TABLE automation_worker_cycles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_worker_cycles_member_read ON automation_worker_cycles;
CREATE POLICY automation_worker_cycles_member_read
ON automation_worker_cycles FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON automation_worker_cycles FROM authenticated, anon;
GRANT SELECT ON automation_worker_cycles TO authenticated;

CREATE OR REPLACE FUNCTION dashboard_automation_worker_health_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION start_automation_worker_cycle(
  target_cycle_key UUID,
  target_worker_name TEXT DEFAULT 'outreach'
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE inserted_count INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF target_cycle_key IS NULL OR target_worker_name IS DISTINCT FROM 'outreach' THEN RAISE EXCEPTION 'Invalid worker cycle'; END IF;

  INSERT INTO automation_worker_cycles (organization_id, cycle_key, worker_name)
  SELECT organization_id, target_cycle_key, target_worker_name
  FROM automation_runtime_controls
  ON CONFLICT (organization_id, cycle_key) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION finish_automation_worker_cycle(
  target_cycle_key UUID,
  target_status TEXT,
  target_failure_code TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE updated_count INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF target_cycle_key IS NULL OR target_status IS NULL OR target_status NOT IN ('succeeded', 'failed') THEN RAISE EXCEPTION 'Invalid worker result'; END IF;
  IF target_status = 'failed' AND COALESCE(target_failure_code, '') !~ '^[A-Za-z0-9_.:-]{1,100}$' THEN
    RAISE EXCEPTION 'Invalid failure code';
  END IF;

  UPDATE automation_worker_cycles
  SET status = target_status,
      failure_code = CASE WHEN target_status = 'failed' THEN target_failure_code ELSE NULL END,
      completed_at = NOW(),
      duration_ms = GREATEST(0, round(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::BIGINT)
  WHERE cycle_key = target_cycle_key AND status = 'running';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION dashboard_automation_worker_health_ready() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION start_automation_worker_cycle(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finish_automation_worker_cycle(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_automation_worker_health_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION start_automation_worker_cycle(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION finish_automation_worker_cycle(UUID, TEXT, TEXT) TO service_role;

COMMIT;
