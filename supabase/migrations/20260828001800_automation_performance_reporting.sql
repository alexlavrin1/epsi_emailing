-- Phase 5, slice 5: tenant-scoped automation conversion and performance reporting.
-- Aggregates expose operational counts only; message bodies, recipient details,
-- and provider errors never leave their source tables through this function.

BEGIN;

CREATE OR REPLACE FUNCTION dashboard_automation_reporting_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION dashboard_get_automation_performance(
  target_organization_id UUID,
  target_period_days INTEGER DEFAULT 30
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN
    RAISE EXCEPTION 'Organization membership required';
  END IF;
  IF target_period_days IS NULL OR target_period_days NOT IN (7, 30) THEN
    RAISE EXCEPTION 'Reporting period must be 7 or 30 days';
  END IF;

  WITH period_runs AS MATERIALIZED (
    SELECT id, status, created_at, completed_at
    FROM automation_runs
    WHERE organization_id = target_organization_id
      AND created_at >= NOW() - make_interval(days => target_period_days)
  ), period_replies AS MATERIALIZED (
    SELECT reply.automation_run_id, reply.status, reply.queued_by_user_id
    FROM operator_email_replies reply
    JOIN period_runs run ON run.id = reply.automation_run_id
    WHERE reply.organization_id = target_organization_id
  )
  SELECT jsonb_build_object(
    'period_days', target_period_days,
    'period_started_at', NOW() - make_interval(days => target_period_days),
    'total_runs', (SELECT count(*) FROM period_runs),
    'prepared_drafts', (SELECT count(*) FROM period_replies),
    'approved_drafts', (SELECT count(*) FROM period_replies WHERE queued_by_user_id IS NOT NULL),
    'delivered_replies', (SELECT count(*) FROM period_replies WHERE status = 'sent'),
    'declined_drafts', (SELECT count(*) FROM period_replies WHERE status = 'cancelled'),
    'failed_runs', (SELECT count(*) FROM period_runs WHERE status = 'failed'),
    'active_runs', (SELECT count(*) FROM period_runs WHERE status IN ('queued', 'preparing', 'waiting_approval', 'running')),
    'average_success_seconds', COALESCE((
      SELECT round(avg(EXTRACT(EPOCH FROM (completed_at - created_at))))::BIGINT
      FROM period_runs WHERE status = 'succeeded' AND completed_at IS NOT NULL
    ), 0)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION dashboard_automation_reporting_ready() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_get_automation_performance(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_automation_reporting_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_get_automation_performance(UUID, INTEGER) TO authenticated;

COMMIT;
