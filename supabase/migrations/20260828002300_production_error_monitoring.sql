-- Privacy-safe production error monitoring for dashboard and server endpoints.
BEGIN;
CREATE TABLE IF NOT EXISTS application_error_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('dashboard', 'outreach_cron', 'payment_recovery_cron', 'stripe_webhook')),
  error_code TEXT NOT NULL CHECK (error_code ~ '^[a-z0-9_.:-]{3,100}$'),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-z0-9_.:-]{3,100}$'),
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ, acknowledged_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, source, fingerprint),
  CHECK ((acknowledged_at IS NULL AND acknowledged_by_user_id IS NULL) OR acknowledged_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_application_error_events_open ON application_error_events (organization_id, last_seen_at DESC) WHERE acknowledged_at IS NULL;
ALTER TABLE application_error_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS application_error_events_member_read ON application_error_events;
CREATE POLICY application_error_events_member_read ON application_error_events FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON application_error_events FROM authenticated, anon;
GRANT SELECT ON application_error_events TO authenticated;

CREATE OR REPLACE FUNCTION upsert_application_error(target_organization_id UUID, target_source TEXT, target_error_code TEXT, target_fingerprint TEXT, target_severity TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event_id UUID;
BEGIN
  IF target_source NOT IN ('dashboard', 'outreach_cron', 'payment_recovery_cron', 'stripe_webhook') OR target_error_code !~ '^[a-z0-9_.:-]{3,100}$' OR target_fingerprint !~ '^[a-z0-9_.:-]{3,100}$' OR target_severity NOT IN ('warning', 'critical') THEN RAISE EXCEPTION 'Invalid monitoring event'; END IF;
  INSERT INTO application_error_events (organization_id, source, error_code, fingerprint, severity)
  VALUES (target_organization_id, target_source, target_error_code, target_fingerprint, target_severity)
  ON CONFLICT (organization_id, source, fingerprint) DO UPDATE SET
    error_code = EXCLUDED.error_code, severity = EXCLUDED.severity,
    occurrence_count = application_error_events.occurrence_count + 1,
    last_seen_at = NOW(), acknowledged_at = NULL, acknowledged_by_user_id = NULL
  RETURNING id INTO event_id;
  RETURN event_id;
END; $$;

CREATE OR REPLACE FUNCTION record_application_error(target_source TEXT, target_error_code TEXT, target_fingerprint TEXT, target_severity TEXT DEFAULT 'critical')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_organization_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Backend service role required'; END IF;
  SELECT id INTO target_organization_id FROM organizations ORDER BY created_at, id LIMIT 1;
  IF target_organization_id IS NULL OR (SELECT COUNT(*) FROM organizations) <> 1 THEN RETURN NULL; END IF;
  RETURN upsert_application_error(target_organization_id, target_source, target_error_code, target_fingerprint, target_severity);
END; $$;

CREATE OR REPLACE FUNCTION dashboard_record_render_error(target_organization_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN upsert_application_error(target_organization_id, 'dashboard', 'dashboard_render_failed', 'dashboard_render_failed', 'critical');
END; $$;

CREATE OR REPLACE FUNCTION dashboard_acknowledge_application_error(target_event_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target application_error_events%ROWTYPE;
BEGIN
  SELECT * INTO target FROM application_error_events WHERE id = target_event_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target.organization_id) THEN RAISE EXCEPTION 'Monitoring event not found'; END IF;
  IF target.acknowledged_at IS NOT NULL THEN RETURN FALSE; END IF;
  UPDATE application_error_events SET acknowledged_at = NOW(), acknowledged_by_user_id = auth.uid() WHERE id = target_event_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target.organization_id, auth.uid(), 'monitoring.error.acknowledged', 'application_error', target.id::TEXT,
    jsonb_build_object('source_type', target.source, 'failure_code', target.error_code, 'occurrence_count', target.occurrence_count));
  RETURN TRUE;
END; $$;

CREATE OR REPLACE FUNCTION dashboard_application_monitoring_ready() RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT auth.uid() IS NOT NULL; $$;
REVOKE ALL ON FUNCTION upsert_application_error(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_application_error(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_record_render_error(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_acknowledge_application_error(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_application_monitoring_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_application_error(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION dashboard_record_render_error(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_acknowledge_application_error(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_application_monitoring_ready() TO authenticated;
COMMIT;
