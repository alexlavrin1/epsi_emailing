-- Audited drag-and-drop lifecycle overrides for prospects, Stripe customers,
-- and existing-client apps. Client-app overrides apply to every contact in the app.
BEGIN;

ALTER TABLE crm_contact_overrides
  DROP CONSTRAINT IF EXISTS crm_contact_overrides_contact_kind_check;
ALTER TABLE crm_contact_overrides
  ADD CONSTRAINT crm_contact_overrides_contact_kind_check
  CHECK (contact_kind IN ('prospect', 'customer', 'client_app'));

ALTER TABLE crm_contact_overrides
  DROP CONSTRAINT IF EXISTS crm_contact_overrides_lifecycle_stage_check;
ALTER TABLE crm_contact_overrides
  ADD CONSTRAINT crm_contact_overrides_lifecycle_stage_check
  CHECK (lifecycle_stage IN ('prospect', 'interested', 'client', 'at_risk', 'churned', 'suppressed'));

CREATE OR REPLACE FUNCTION dashboard_contact_belongs_to_org(
  target_organization_id UUID,
  target_contact_kind TEXT,
  target_contact_id UUID
) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT CASE target_contact_kind
    WHEN 'prospect' THEN EXISTS (
      SELECT 1 FROM prospects WHERE id=target_contact_id AND organization_id=target_organization_id
    )
    WHEN 'customer' THEN EXISTS (
      SELECT 1 FROM crm_customers WHERE id=target_contact_id AND organization_id=target_organization_id
    )
    WHEN 'client_app' THEN EXISTS (
      SELECT 1 FROM client_apps WHERE id=target_contact_id AND organization_id=target_organization_id
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE previous_stage TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF target_stage NOT IN ('prospect', 'interested', 'client', 'at_risk', 'churned', 'suppressed') THEN
    RAISE EXCEPTION 'Invalid lifecycle stage';
  END IF;
  IF NOT dashboard_contact_belongs_to_org(target_organization_id, target_contact_kind, target_contact_id) THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;

  SELECT lifecycle_stage INTO previous_stage
  FROM crm_contact_overrides
  WHERE organization_id=target_organization_id
    AND contact_kind=target_contact_kind
    AND contact_id=target_contact_id;

  INSERT INTO crm_contact_overrides(
    organization_id,contact_kind,contact_id,lifecycle_stage,updated_by_user_id
  ) VALUES (
    target_organization_id,target_contact_kind,target_contact_id,target_stage,auth.uid()
  )
  ON CONFLICT (organization_id,contact_kind,contact_id) DO UPDATE
    SET lifecycle_stage=EXCLUDED.lifecycle_stage,
        updated_by_user_id=auth.uid(),
        updated_at=NOW();

  INSERT INTO audit_events(
    organization_id,actor_user_id,event_type,target_type,target_id,metadata
  ) VALUES (
    target_organization_id,auth.uid(),'crm.lifecycle.changed',target_contact_kind,target_contact_id::TEXT,
    jsonb_build_object('previous_stage',previous_stage,'new_stage',target_stage,'trigger','pipeline_drag_drop')
  );
END;
$$;

REVOKE ALL ON FUNCTION dashboard_contact_belongs_to_org(UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_set_lifecycle_stage(UUID,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_lifecycle_stage(UUID,TEXT,UUID,TEXT) TO authenticated;

COMMIT;
