-- Tenant-scoped data export auditing and disabled-by-default retention policy
-- previews. This migration does not delete any business or audit records.
BEGIN;
CREATE TABLE IF NOT EXISTS data_retention_policies (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('automation_history', 'worker_monitoring', 'email_content', 'crm_notes', 'audit_history')),
  retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 30 AND 3650),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, category), CHECK (category <> 'audit_history' OR retention_days >= 365)
);
ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_retention_policies_admin_read ON data_retention_policies;
CREATE POLICY data_retention_policies_admin_read ON data_retention_policies FOR SELECT TO authenticated
USING (dashboard_has_org_role(organization_id, ARRAY['admin']));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON data_retention_policies FROM authenticated, anon;
GRANT SELECT ON data_retention_policies TO authenticated;

CREATE OR REPLACE FUNCTION initialize_data_retention_policies() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO data_retention_policies (organization_id, category, retention_days) VALUES
    (NEW.id, 'automation_history', 180), (NEW.id, 'worker_monitoring', 90),
    (NEW.id, 'email_content', 365), (NEW.id, 'crm_notes', 730), (NEW.id, 'audit_history', 2555)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS organizations_initialize_data_retention ON organizations;
CREATE TRIGGER organizations_initialize_data_retention AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION initialize_data_retention_policies();
INSERT INTO data_retention_policies (organization_id, category, retention_days)
SELECT organization.id, defaults.category, defaults.retention_days FROM organizations organization
CROSS JOIN (VALUES ('automation_history', 180), ('worker_monitoring', 90), ('email_content', 365), ('crm_notes', 730), ('audit_history', 2555)) AS defaults(category, retention_days)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION dashboard_set_retention_period(target_organization_id UUID, target_category TEXT, target_retention_days INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE previous_days INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id, ARRAY['admin']) THEN RAISE EXCEPTION 'Administrator AAL2 access required'; END IF;
  IF target_category NOT IN ('automation_history', 'worker_monitoring', 'email_content', 'crm_notes', 'audit_history') THEN RAISE EXCEPTION 'Invalid retention category'; END IF;
  IF target_retention_days NOT BETWEEN 30 AND 3650 OR (target_category = 'audit_history' AND target_retention_days < 365) THEN RAISE EXCEPTION 'Invalid retention period'; END IF;
  SELECT retention_days INTO previous_days FROM data_retention_policies WHERE organization_id = target_organization_id AND category = target_category FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retention policy not found'; END IF;
  UPDATE data_retention_policies SET retention_days = target_retention_days, updated_by_user_id = auth.uid(), updated_at = NOW()
  WHERE organization_id = target_organization_id AND category = target_category;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'data.retention.period_changed', 'retention_policy', target_category,
    jsonb_build_object('previous_days', previous_days, 'new_days', target_retention_days, 'enforcement_enabled', FALSE));
END; $$;

CREATE OR REPLACE FUNCTION dashboard_retention_preview(target_organization_id UUID)
RETURNS TABLE(category TEXT, retention_days INTEGER, enabled BOOLEAN, eligible_rows BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id, ARRAY['admin']) THEN RAISE EXCEPTION 'Administrator AAL2 access required'; END IF;
  RETURN QUERY SELECT policy.category, policy.retention_days, policy.enabled,
    CASE policy.category
      WHEN 'automation_history' THEN (SELECT COUNT(*) FROM automation_runs WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days))
      WHEN 'worker_monitoring' THEN (SELECT COUNT(*) FROM automation_worker_cycles WHERE organization_id = target_organization_id AND started_at < NOW() - make_interval(days => policy.retention_days))
      WHEN 'email_content' THEN (SELECT COUNT(*) FROM prospect_replies reply JOIN campaigns campaign ON campaign.id = reply.campaign_id WHERE campaign.organization_id = target_organization_id AND COALESCE(reply.received_at, reply.created_at) < NOW() - make_interval(days => policy.retention_days)) + (SELECT COUNT(*) FROM operator_email_replies WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days))
      WHEN 'crm_notes' THEN (SELECT COUNT(*) FROM crm_contact_notes WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days))
      WHEN 'audit_history' THEN (SELECT COUNT(*) FROM audit_events WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days)) ELSE 0 END::BIGINT
  FROM data_retention_policies policy WHERE policy.organization_id = target_organization_id ORDER BY policy.category;
END; $$;

CREATE OR REPLACE FUNCTION dashboard_record_data_export(target_organization_id UUID, target_dataset TEXT, target_row_count INTEGER, target_truncated BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id, ARRAY['admin']) THEN RAISE EXCEPTION 'Administrator AAL2 access required'; END IF;
  IF target_dataset <> 'organization_bundle' OR target_row_count < 0 THEN RAISE EXCEPTION 'Invalid export request'; END IF;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'data.export.downloaded', 'organization', target_organization_id::TEXT,
    jsonb_build_object('dataset', target_dataset, 'row_count', target_row_count, 'truncated', target_truncated));
END; $$;
REVOKE ALL ON FUNCTION initialize_data_retention_policies() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_set_retention_period(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_retention_preview(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_record_data_export(UUID, TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_retention_period(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_retention_preview(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_record_data_export(UUID, TEXT, INTEGER, BOOLEAN) TO authenticated;
COMMIT;
