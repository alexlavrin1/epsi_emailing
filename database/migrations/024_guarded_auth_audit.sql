-- Authentication events need a fixed, guarded function because direct browser
-- inserts into the append-only audit log were revoked in migration 010.
BEGIN;
CREATE OR REPLACE FUNCTION dashboard_record_auth_event(target_event_type TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_organization_id UUID;
BEGIN
  IF auth.uid() IS NULL OR target_event_type NOT IN ('auth.login.succeeded', 'auth.logout', 'auth.password.updated', 'auth.mfa.verified') THEN RAISE EXCEPTION 'Invalid authentication event'; END IF;
  SELECT organization_id INTO target_organization_id FROM organization_members
  WHERE user_id = auth.uid() AND status = 'active' ORDER BY created_at, id LIMIT 1;
  IF target_organization_id IS NULL THEN RETURN FALSE; END IF;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, metadata)
  VALUES (target_organization_id, auth.uid(), target_event_type,
    jsonb_build_object('channel', CASE target_event_type WHEN 'auth.password.updated' THEN 'dashboard_recovery' WHEN 'auth.mfa.verified' THEN 'dashboard_mfa' ELSE 'dashboard' END));
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION dashboard_record_auth_event(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_record_auth_event(TEXT) TO authenticated;
COMMIT;
