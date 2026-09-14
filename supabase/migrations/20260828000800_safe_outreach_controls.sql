-- Phase 3: audited campaign pause/resume and contact-level outreach stops.
-- Existing table policies remain read-only; changes are only available through
-- tenant-validating RPC functions that write their audit event transactionally.

BEGIN;

CREATE OR REPLACE FUNCTION dashboard_outreach_controls_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION dashboard_set_campaign_status(
  target_organization_id UUID,
  target_campaign_id UUID,
  target_status TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE previous_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF target_status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'Invalid campaign status'; END IF;

  SELECT status INTO previous_status FROM campaigns
  WHERE id = target_campaign_id AND organization_id = target_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  IF previous_status = 'completed' THEN RAISE EXCEPTION 'Completed campaigns cannot be changed'; END IF;

  UPDATE campaigns SET status = target_status, updated_at = NOW() WHERE id = target_campaign_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'outreach.campaign.status_changed', 'campaign', target_campaign_id::TEXT,
    jsonb_build_object('previous_status', previous_status, 'new_status', target_status));
END;
$$;

CREATE OR REPLACE FUNCTION dashboard_stop_prospect_outreach(
  target_organization_id UUID,
  target_prospect_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE stopped_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM prospects WHERE id = target_prospect_id AND organization_id = target_organization_id) THEN
    RAISE EXCEPTION 'Prospect not found';
  END IF;

  UPDATE outreach_sends SET status = 'stopped', updated_at = NOW()
  WHERE prospect_id = target_prospect_id AND status = 'scheduled';
  GET DIAGNOSTICS stopped_count = ROW_COUNT;

  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'outreach.prospect.stopped', 'prospect', target_prospect_id::TEXT,
    jsonb_build_object('scheduled_sends_stopped', stopped_count));
  RETURN stopped_count;
END;
$$;

REVOKE ALL ON FUNCTION dashboard_set_campaign_status(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_stop_prospect_outreach(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_outreach_controls_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dashboard_set_campaign_status(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_stop_prospect_outreach(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_outreach_controls_ready() TO authenticated;

COMMIT;
