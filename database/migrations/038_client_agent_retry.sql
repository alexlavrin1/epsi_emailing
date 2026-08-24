BEGIN;

CREATE OR REPLACE FUNCTION dashboard_retry_client_playbook_agent_draft(target_draft_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  target client_playbook_drafts%ROWTYPE;
  prior_failure_code TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO target
  FROM client_playbook_drafts
  WHERE id=target_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT dashboard_is_org_member(target.organization_id) THEN
    RAISE EXCEPTION 'Client draft not found';
  END IF;
  IF target.status<>'draft' OR target.agent_status<>'failed' THEN
    RAISE EXCEPTION 'Only a failed open AI draft can be retried';
  END IF;

  prior_failure_code:=target.agent_failure_code;
  DELETE FROM client_playbook_draft_sources WHERE draft_id=target.id;
  UPDATE client_playbook_drafts
  SET agent_status='pending',
      agent_attempt_count=0,
      agent_claimed_at=NULL,
      agent_generated_at=NULL,
      agent_model=NULL,
      agent_response_id=NULL,
      agent_failure_code=NULL,
      agent_context_sha256=NULL,
      agent_context_warnings='{}'::TEXT[],
      generation_mode='template'
  WHERE id=target.id;

  INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata)
  VALUES(target.organization_id,auth.uid(),'client.playbook.agent_draft_retry_queued','client_playbook_draft',target.id::TEXT,jsonb_build_object('previous_failure_code',prior_failure_code,'status','pending'));
END;
$$;

REVOKE ALL ON FUNCTION dashboard_retry_client_playbook_agent_draft(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION dashboard_retry_client_playbook_agent_draft(UUID) TO authenticated;

COMMIT;
